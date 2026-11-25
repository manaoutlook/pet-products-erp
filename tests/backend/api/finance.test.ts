import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import {
  customerProfiles,
  inventory,
  invoicePayments,
  invoices,
  products,
  userStoreAssignments,
  vatCompanies,
} from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData } from '../../helpers/test-db';
import { createSale } from '../../../server/sales';
import { recordPayment, voidPayment } from '../../../server/payments';
import { cashBookLedger, customerStatementLedger } from '../../../server/ledger';
import { vietnamDayOf } from '../../../shared/vietnam-day';
import {
  FinanceError,
  createFinanceEntry,
  createFinancePartner,
  deleteFinancePartner,
  financeSummary,
  getFinanceEntry,
  listFinanceEntries,
  listFinancePartners,
  updateFinanceEntry,
  updateFinancePartner,
  voidFinanceEntry,
} from '../../../server/finance';

/**
 * Financial accounts - the manual money book next to the invoice receipts.
 *
 * These tests pin the promises the report makes to the owner:
 *
 *   - an expense is a debit and other income is a credit, and the ledger totals cover every
 *     matching row, not just the page on screen;
 *   - receipt money is read from `invoice_payments` at report time, so voiding a receipt removes
 *     it from income with no reconciliation step;
 *   - a partly paid invoice is called out separately from money that is not yet due;
 *   - nothing is deleted: a wrong entry is voided and keeps who/when/why;
 *   - a partner can never withdraw more than they put in, and a deposit cannot be voided after the
 *     money has already been taken out.
 */
describe('financial accounts', () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let ciCompany: typeof vatCompanies.$inferSelect;
  // The report speaks in Vietnamese days (UTC+7), so the tests must too: at 06:30 local the UTC
  // date is still yesterday.
  const today = () => vietnamDayOf(new Date());

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    data = await seedTestData();

    await db.insert(userStoreAssignments).values({
      userId: data.users.admin.id,
      storeId: data.stores.store1.id,
    });

    await db.insert(inventory).values({
      productId: data.products.product.id,
      storeId: data.stores.store1.id,
      inventoryType: 'STORE',
      quantity: 50,
    });

    // 100,000 VND a unit keeps the arithmetic readable: 2 units = 200,000 excl. VAT.
    await db
      .update(products)
      .set({ price: '100000.00' })
      .where(eq(products.id, data.products.product.id));

    const [ci] = await db
      .insert(vatCompanies)
      .values({
        code: 'CI',
        name: 'Conqueror International',
        taxId: '0301234567',
        address: '1 Conqueror Street, Ho Chi Minh City',
      })
      .returning();
    ciCompany = ci;
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  /** Any entry type, defaulting to a 500,000 rent expense due today. */
  const postEntry = (overrides: Partial<Parameters<typeof createFinanceEntry>[0]> = {}) =>
    createFinanceEntry({
      entryType: 'expense',
      category: 'Rent',
      description: 'Shop rent',
      amount: 500000,
      entryDate: today(),
      createdByUserId: data.users.admin.id,
      ...overrides,
    });

  /** A VAT sale of 2 units: 200,000 + 10% = 220,000. */
  const sellTwoUnits = (amountPaidNow?: number) =>
    createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 2 }],
      paymentMethod: 'CASH',
      transactionType: 'STORE_SALE',
      withVat: true,
      vatCompanyId: ciCompany.id,
      buyer: {
        name: 'Beta Buyer Co.',
        companyName: 'Beta Buyer Co.',
        taxId: '0309999999',
        address: '9 Buyer Street, Hanoi',
        phone: '0900000000',
      },
      amountPaidNow,
    });

  it('records an expense as a debit and totals the whole ledger, not just one page', async () => {
    const entry = await postEntry();
    await postEntry({ amount: 250000, description: 'Electricity', category: 'Utilities' });

    expect(entry.entryNumber).toMatch(/^FIN-\d{8}-\d{4}$/);
    expect(entry.direction).toBe('debit');
    expect(entry.directionLabel).toBe('Debit');
    expect(entry.status).toBe('posted');
    expect(entry.voided).toBe(false);
    expect(entry.amount).toBe(500000);
    expect(entry.createdByUser?.id).toBe(data.users.admin.id);

    // One row per page, but the totals still describe both rows.
    const page = await listFinanceEntries({ limit: 1 });
    expect(page.entries).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.totals.credits).toBe(0);
    expect(page.totals.debits).toBe(750000);
    expect(page.totals.net).toBe(-750000);

    const summary = await financeSummary({ from: today(), to: today() });
    expect(summary.expenses.total).toBe(750000);
    expect(summary.expenses.count).toBe(2);
    expect(summary.expenses.byCategory[0]).toEqual({
      category: 'Rent',
      amount: 500000,
      count: 1,
    });
    expect(summary.netProfit).toBe(-750000);
    // Rent and electricity left the till, so cash is negative until something comes in.
    expect(summary.cashPosition).toBe(-750000);
  });

  it('treats other income as a credit and groups it by category', async () => {
    await postEntry({
      entryType: 'income',
      category: 'Other income',
      description: 'Scrap cardboard sold',
      amount: 300000,
    });

    const book = await listFinanceEntries({ entryType: 'income' });
    expect(book.totals.credits).toBe(300000);
    expect(book.totals.net).toBe(300000);

    const summary = await financeSummary({ from: today(), to: today() });
    expect(summary.income.otherIncome).toBe(300000);
    expect(summary.income.receipts).toBe(0);
    expect(summary.income.total).toBe(300000);
    expect(summary.income.byCategory).toEqual([
      { category: 'Other income', amount: 300000, automatic: false },
    ]);
  });

  it('merges invoice receipts into income and separates partly paid receivables', async () => {
    const sale = await sellTwoUnits(100000);
    expect(sale).toBeDefined();

    const patient = await financeSummary({ from: today(), to: today() });
    expect(patient.income.receipts).toBe(100000);
    expect(patient.income.receiptsCount).toBe(1);
    expect(patient.income.byCategory[0]).toEqual({
      category: 'Customer receipts',
      amount: 100000,
      automatic: true,
    });

    // The 120,000 still owed is called out on its own line, not hidden in "unpaid".
    expect(patient.receivables.invoiceCount).toBe(1);
    expect(patient.receivables.totalOutstanding).toBe(120000);
    expect(patient.receivables.partiallyPaidCount).toBe(1);
    expect(patient.receivables.partiallyPaidAmount).toBe(120000);
    expect(patient.receivables.unpaidCount).toBe(0);

    const invoice = await db.query.invoices.findFirst();
    const settled = await recordPayment({
      invoiceId: invoice!.id,
      amount: 120000,
      paymentMethod: 'CASH',
      userId: data.users.admin.id,
      storeId: data.stores.store1.id,
    });
    expect(settled.invoice.status).toBe('paid');

    const paid = await financeSummary({ from: today(), to: today() });
    expect(paid.income.receipts).toBe(220000);
    expect(paid.receivables.invoiceCount).toBe(0);
    expect(paid.receivables.partiallyPaidAmount).toBe(0);
  });

  it('drops a voided receipt out of income without touching the finance entries', async () => {
    await sellTwoUnits();

    const [payment] = await db.select().from(invoicePayments);
    await voidPayment({
      paymentId: payment.id,
      userId: data.users.admin.id,
      reason: 'Receipt typed against the wrong invoice',
    });

    const summary = await financeSummary({ from: today(), to: today() });
    expect(summary.income.receipts).toBe(0);
    expect(summary.income.receiptsCount).toBe(0);
  });

  it('voids an entry instead of deleting it and removes it from the totals', async () => {
    const entry = await postEntry();

    const voided = await voidFinanceEntry({
      entryId: entry.id,
      voidedByUserId: data.users.admin.id,
      reason: 'Duplicated rent bill',
    });

    expect(voided.status).toBe('voided');
    expect(voided.voided).toBe(true);
    expect(voided.voidReason).toBe('Duplicated rent bill');
    expect(voided.voidedByUser?.id).toBe(data.users.admin.id);
    expect(voided.voidedAt).toBeInstanceOf(Date);

    // The row survives, so the history is intact...
    const kept = await getFinanceEntry(entry.id);
    expect(kept.entryNumber).toBe(entry.entryNumber);
    expect(kept.amount).toBe(500000);

    // ...but posted-only totals ignore it.
    const book = await listFinanceEntries();
    expect(book.total).toBe(1);
    expect(book.totals.debits).toBe(0);

    const summary = await financeSummary({ from: today(), to: today() });
    expect(summary.expenses.total).toBe(0);

    await expect(
      voidFinanceEntry({
        entryId: entry.id,
        voidedByUserId: data.users.admin.id,
        reason: 'again',
      })
    ).rejects.toBeInstanceOf(FinanceError);
  });

  it('edits a posted entry in place and moves the totals with it', async () => {
    const entry = await postEntry();
    await postEntry({ amount: 250000, description: 'Electricity', category: 'Utilities' });

    const updated = await updateFinanceEntry({
      entryId: entry.id,
      entryType: 'income',
      category: 'Other income',
      description: 'Scrap metal sale',
      amount: 750000,
      entryDate: today(),
      paymentMethod: 'BANK_TRANSFER',
      reference: 'SCRAP-1',
      notes: 'Sold the old shelving',
    });

    // Same row, same number - an edit never creates a second entry.
    expect(updated.id).toBe(entry.id);
    expect(updated.entryNumber).toBe(entry.entryNumber);
    expect(updated.entryType).toBe('income');
    expect(updated.direction).toBe('credit');
    expect(updated.directionLabel).toBe('Credit');
    expect(updated.amount).toBe(750000);
    expect(updated.category).toBe('Other income');
    expect(updated.description).toBe('Scrap metal sale');
    expect(updated.paymentMethod).toBe('BANK_TRANSFER');
    expect(updated.reference).toBe('SCRAP-1');
    expect(updated.notes).toBe('Sold the old shelving');

    const book = await listFinanceEntries();
    expect(book.total).toBe(2);
    expect(book.totals.debits).toBe(250000);
    expect(book.totals.credits).toBe(750000);

    const summary = await financeSummary({ from: today(), to: today() });
    expect(summary.expenses.total).toBe(250000);
    expect(summary.income.otherIncome).toBe(750000);
  });

  it('refuses to edit a voided entry, a missing one, or an unfinished one', async () => {
    const entry = await postEntry();
    await voidFinanceEntry({
      entryId: entry.id,
      voidedByUserId: data.users.admin.id,
      reason: 'Typed twice',
    });

    const voided = await updateFinanceEntry({
      entryId: entry.id,
      entryType: 'expense',
      category: 'Rent',
      description: 'Corrected rent',
      amount: 400000,
      entryDate: today(),
    }).catch((error) => error);

    expect(voided).toBeInstanceOf(FinanceError);
    expect((voided as FinanceError).status).toBe(409);

    const missing = await updateFinanceEntry({
      entryId: 999999,
      entryType: 'expense',
      category: 'Rent',
      description: 'Nothing here',
      amount: 400000,
      entryDate: today(),
    }).catch((error) => error);

    expect(missing).toBeInstanceOf(FinanceError);
    expect((missing as FinanceError).status).toBe(404);

    // The same validation the create route uses, so an edit cannot store what a POST would reject.
    const blank = await postEntry({ description: 'Second rent bill' });
    await expect(
      updateFinanceEntry({
        entryId: blank.id,
        entryType: 'expense',
        category: 'Rent',
        description: '   ',
        amount: 400000,
        entryDate: today(),
      })
    ).rejects.toBeInstanceOf(FinanceError);

    const untouched = await getFinanceEntry(blank.id);
    expect(untouched.description).toBe('Second rent bill');
    expect(untouched.amount).toBe(500000);
  });

  it('weighs a partner edit against the balance without double-counting its own amount', async () => {
    const partner = await createFinancePartner({
      name: 'Le Van Gop',
      createdByUserId: data.users.admin.id,
    });

    await postEntry({
      entryType: 'partner_deposit',
      category: 'Partner capital',
      description: 'Initial capital',
      amount: 5000000,
      partnerId: partner.id,
      fundingKind: 'capital',
    });

    const withdrawal = await postEntry({
      entryType: 'partner_withdrawal',
      category: 'Partner withdrawal',
      description: 'Draw for personal use',
      amount: 1000000,
      partnerId: partner.id,
      fundingKind: 'capital',
    });

    // 5,000,000 in, 1,000,000 out leaves 4,000,000 - but this row is being rewritten, so the
    // whole 5,000,000 is available to it.
    const raised = await updateFinanceEntry({
      entryId: withdrawal.id,
      entryType: 'partner_withdrawal',
      category: 'Partner withdrawal',
      description: 'Draw for the shop deposit',
      amount: 5000000,
      entryDate: today(),
      partnerId: partner.id,
      fundingKind: 'capital',
    });
    expect(raised.amount).toBe(5000000);

    let partners = await listFinancePartners();
    expect(partners.partners[0].balance).toBe(0);

    // One dong past the deposit is still refused.
    const tooMuch = await updateFinanceEntry({
      entryId: withdrawal.id,
      entryType: 'partner_withdrawal',
      category: 'Partner withdrawal',
      description: 'One withdrawal too many',
      amount: 5000001,
      entryDate: today(),
      partnerId: partner.id,
      fundingKind: 'capital',
    }).catch((error) => error);
    expect(tooMuch).toBeInstanceOf(FinanceError);
    expect((tooMuch as FinanceError).status).toBe(409);

    // Shrinking a deposit below what was already taken out is refused too.
    const deposit = (await listFinanceEntries({ entryType: 'partner_deposit' })).entries[0];
    const depositTooSmall = await updateFinanceEntry({
      entryId: deposit.id,
      entryType: 'partner_deposit',
      category: 'Partner capital',
      description: 'Initial capital',
      amount: 1000000,
      entryDate: today(),
      partnerId: partner.id,
      fundingKind: 'capital',
    }).catch((error) => error);
    expect(depositTooSmall).toBeInstanceOf(FinanceError);
    expect((depositTooSmall as FinanceError).status).toBe(409);

    partners = await listFinancePartners();
    expect(partners.partners[0].deposits).toBe(5000000);
    expect(partners.partners[0].withdrawals).toBe(5000000);
    expect(partners.partners[0].balance).toBe(0);
  });

  it('refuses a partner withdrawal larger than the money they have in the company', async () => {
    const partner = await createFinancePartner({
      name: 'Nguyen Van Gop',
      createdByUserId: data.users.admin.id,
    });

    await postEntry({
      entryType: 'partner_deposit',
      category: 'Partner capital',
      description: 'Initial capital',
      amount: 5000000,
      partnerId: partner.id,
      fundingKind: 'capital',
    });

    const withdrawal = await postEntry({
      entryType: 'partner_withdrawal',
      category: 'Partner withdrawal',
      description: 'Draw for personal use',
      amount: 1000000,
      partnerId: partner.id,
      fundingKind: 'capital',
    });
    expect(withdrawal.direction).toBe('debit');
    expect(withdrawal.partner?.name).toBe('Nguyen Van Gop');

    const tooMuch = await postEntry({
      entryType: 'partner_withdrawal',
      category: 'Partner withdrawal',
      description: 'One withdrawal too many',
      amount: 4000001,
      partnerId: partner.id,
      fundingKind: 'capital',
    }).catch((error) => error);

    expect(tooMuch).toBeInstanceOf(FinanceError);
    expect((tooMuch as FinanceError).status).toBe(409);
    expect((tooMuch as FinanceError).suggestion).toBeTruthy();

    const partners = await listFinancePartners();
    expect(partners.partners).toHaveLength(1);
    expect(partners.partners[0].deposits).toBe(5000000);
    expect(partners.partners[0].withdrawals).toBe(1000000);
    expect(partners.partners[0].balance).toBe(4000000);
    expect(partners.totals.balance).toBe(4000000);

    const summary = await financeSummary({ from: today(), to: today() });
    expect(summary.capital.deposits).toBe(5000000);
    expect(summary.capital.withdrawals).toBe(1000000);
    expect(summary.capital.balance).toBe(4000000);
    expect(summary.capital.byFundingKind).toEqual([
      { fundingKind: 'capital', deposits: 5000000, withdrawals: 1000000, balance: 4000000 },
    ]);
    expect(summary.capital.period).toEqual({
      deposits: 5000000,
      withdrawals: 1000000,
      net: 4000000,
    });
  });

  it('keeps the partner balance whole when the report is narrowed to a month with no partner money', async () => {
    /*
     * "Partner money held" is a balance, not a period total. On 25 Nov 2026 this report showed
     * 15,159,919 held next to "0 in · 0 out", because the deposits were dated June/July and only
     * the hint was range-scoped. Narrowing the range must not make a balance look like zero; the
     * range's own movements belong in `capital.period`.
     */
    const partner = await createFinancePartner({
      name: 'Do Thi Balance',
      createdByUserId: data.users.admin.id,
    });

    await postEntry({
      entryType: 'partner_deposit',
      category: 'Partner capital',
      description: 'Capital put in in January',
      amount: 5000000,
      entryDate: '2026-01-10',
      partnerId: partner.id,
      fundingKind: 'capital',
    });
    await postEntry({
      entryType: 'partner_withdrawal',
      category: 'Partner withdrawal',
      description: 'Taken back in February',
      amount: 1000000,
      entryDate: '2026-02-10',
      partnerId: partner.id,
      fundingKind: 'capital',
    });
    await postEntry({
      entryType: 'expense',
      category: 'Rent',
      description: 'March rent',
      amount: 300000,
      entryDate: '2026-03-05',
    });

    const summary = await financeSummary({ from: '2026-03-01', to: '2026-03-31' });

    // The partners did not move a dong in March...
    expect(summary.capital.period).toEqual({ deposits: 0, withdrawals: 0, net: 0 });

    // ...so their balance must match the Partners tab, not the empty March window.
    expect(summary.capital.deposits).toBe(5000000);
    expect(summary.capital.withdrawals).toBe(1000000);
    expect(summary.capital.net).toBe(4000000);
    expect(summary.capital.balance).toBe(4000000);
    expect(summary.capital.byPartner).toEqual([
      {
        partnerId: partner.id,
        name: 'Do Thi Balance',
        deposits: 5000000,
        withdrawals: 1000000,
        balance: 4000000,
      },
    ]);

    // Cash position stays a period figure: only March's expense counts.
    expect(summary.cashPosition).toBe(-300000);
  });

  it('refuses to void a deposit the partner has already withdrawn against', async () => {
    const partner = await createFinancePartner({
      name: 'Tran Thi Gop',
      createdByUserId: data.users.admin.id,
    });

    const deposit = await postEntry({
      entryType: 'partner_deposit',
      category: 'Partner capital',
      description: 'Loan to the shop',
      amount: 1000000,
      partnerId: partner.id,
      fundingKind: 'loan',
    });

    const withdrawal = await postEntry({
      entryType: 'partner_withdrawal',
      category: 'Partner withdrawal',
      description: 'Loan repaid',
      amount: 800000,
      partnerId: partner.id,
      fundingKind: 'loan',
    });

    await expect(
      voidFinanceEntry({
        entryId: deposit.id,
        voidedByUserId: data.users.admin.id,
        reason: 'Typed twice',
      })
    ).rejects.toBeInstanceOf(FinanceError);

    // Void the withdrawal first, then the deposit is safe to void and the balance is zero.
    await voidFinanceEntry({
      entryId: withdrawal.id,
      voidedByUserId: data.users.admin.id,
      reason: 'Loan repayment was cancelled',
    });
    const voidedDeposit = await voidFinanceEntry({
      entryId: deposit.id,
      voidedByUserId: data.users.admin.id,
      reason: 'Typed twice',
    });
    expect(voidedDeposit.status).toBe('voided');

    const partners = await listFinancePartners();
    expect(partners.partners[0].balance).toBe(0);
  });

  it('renames a partner without moving their money', async () => {
    const partner = await createFinancePartner({
      name: 'Le Van Gop',
      phone: '0909000111',
      createdByUserId: data.users.admin.id,
    });

    await postEntry({
      entryType: 'partner_deposit',
      category: 'Partner capital',
      description: 'Initial capital',
      amount: 5000000,
      partnerId: partner.id,
      fundingKind: 'capital',
    });

    const renamed = await updateFinancePartner({
      partnerId: partner.id,
      name: 'Le Van Gop (HCMC)',
      phone: '0909000222',
      notes: 'Capital partner',
    });

    // Only the label moves: the deposit is still theirs and still counts.
    expect(renamed.name).toBe('Le Van Gop (HCMC)');
    expect(renamed.phone).toBe('0909000222');
    expect(renamed.notes).toBe('Capital partner');
    expect(renamed.deposits).toBe(5000000);
    expect(renamed.withdrawals).toBe(0);
    expect(renamed.balance).toBe(5000000);

    const partners = await listFinancePartners();
    expect(partners.partners).toHaveLength(1);
    expect(partners.partners[0].name).toBe('Le Van Gop (HCMC)');
    expect(partners.totals.balance).toBe(5000000);

    // The name stays unique, exactly like adding one.
    await createFinancePartner({ name: 'Nguyen Van B', createdByUserId: data.users.admin.id });
    const clash = await updateFinancePartner({
      partnerId: partner.id,
      name: 'Nguyen Van B',
    }).catch((error) => error);
    expect(clash).toBeInstanceOf(FinanceError);
    expect((clash as FinanceError).status).toBe(409);

    const missing = await updateFinancePartner({ partnerId: 999999, name: 'Nobody' }).catch(
      (error) => error
    );
    expect(missing).toBeInstanceOf(FinanceError);
    expect((missing as FinanceError).status).toBe(404);
  });

  it('deletes a partner only once their money has left the company', async () => {
    const partner = await createFinancePartner({
      name: 'Pham Thi Gop',
      createdByUserId: data.users.admin.id,
    });

    const deposit = await postEntry({
      entryType: 'partner_deposit',
      category: 'Partner capital',
      description: 'Initial capital',
      amount: 3000000,
      partnerId: partner.id,
      fundingKind: 'capital',
    });

    // 3,000,000 of theirs is still in the company, so deleting them would silently write it off.
    const refused = await deleteFinancePartner(partner.id).catch((error) => error);
    expect(refused).toBeInstanceOf(FinanceError);
    expect((refused as FinanceError).status).toBe(409);
    expect((refused as FinanceError).message).toContain('still has money in the company');
    expect((await listFinancePartners()).partners).toHaveLength(1);

    // Voiding the deposit takes the money out of every total; the partner can then go, and the
    // voided row goes with them - it still points at the partner through `partner_id`.
    await voidFinanceEntry({
      entryId: deposit.id,
      voidedByUserId: data.users.admin.id,
      reason: 'Typed twice',
    });

    const deleted = await deleteFinancePartner(partner.id);
    expect(deleted.name).toBe('Pham Thi Gop');
    expect(deleted.deletedEntries).toEqual([deposit.entryNumber]);

    const partners = await listFinancePartners();
    expect(partners.partners).toHaveLength(0);
    expect(partners.totals.balance).toBe(0);
    expect((await listFinanceEntries()).entries).toHaveLength(0);

    const missing = await deleteFinancePartner(partner.id).catch((error) => error);
    expect(missing).toBeInstanceOf(FinanceError);
    expect((missing as FinanceError).status).toBe(404);
  });

  it('rejects an entry without a category, a description or a real date', async () => {
    await expect(postEntry({ category: '   ' })).rejects.toBeInstanceOf(FinanceError);
    await expect(postEntry({ description: '  ' })).rejects.toBeInstanceOf(FinanceError);
    await expect(postEntry({ entryDate: '2026-02-31' })).rejects.toBeInstanceOf(FinanceError);
    await expect(postEntry({ amount: 0 })).rejects.toBeInstanceOf(FinanceError);
    // Only partner entries may name a partner.
    await expect(postEntry({ partnerId: 1 })).rejects.toBeInstanceOf(FinanceError);

    const book = await listFinanceEntries();
    expect(book.total).toBe(0);
  });

  it('filters the ledger by search term and shows voided entries when asked', async () => {
    const rent = await postEntry({ reference: 'INV-LANDLORD-9' });
    await postEntry({ entryType: 'income', category: 'Other income', description: 'Scrap sale' });

    const byReference = await listFinanceEntries({ search: 'landlord' });
    expect(byReference.entries).toHaveLength(1);
    expect(byReference.entries[0].id).toBe(rent.id);

    await voidFinanceEntry({
      entryId: rent.id,
      voidedByUserId: data.users.admin.id,
      reason: 'Wrong month',
    });

    const voided = await listFinanceEntries({ status: 'voided' });
    expect(voided.entries).toHaveLength(1);
    expect(voided.totals.debits).toBe(0);

    const posted = await listFinanceEntries({ status: 'posted' });
    expect(posted.entries).toHaveLength(1);
    expect(posted.totals.credits).toBe(500000);
  });

  /**
   * The printable sheets. Both are read models - they read the same rows the report reads, so
   * these tests check the promises made on paper: an opening balance that carries history in, a
   * closing figure that equals the real balance, voided rows printed but not counted, and a
   * customer statement whose closing line is what the customer still owes.
   */
  describe('ledger printing', () => {
    const dayOffset = (days: number) => {
      const date = new Date(`${today()}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };

    it('carries the opening balance into the cash book and leaves voided rows out of it', async () => {
      await postEntry({ amount: 70000, entryDate: dayOffset(-1), description: 'Yesterday rent' });
      await postEntry({
        entryType: 'income',
        category: 'Other income',
        description: 'Scrap sale',
        amount: 100000,
      });
      const mistake = await postEntry({ amount: 40000, description: 'Typed twice' });
      await voidFinanceEntry({
        entryId: mistake.id,
        voidedByUserId: data.users.admin.id,
        reason: 'Duplicate',
      });

      const book = await cashBookLedger({ from: today(), to: today() });

      // Yesterday's 70,000 expense is the opening figure, not a line of this period.
      expect(book.openingBalance).toBe(-70000);
      expect(book.lines).toHaveLength(2);

      expect(book.totals.debit).toBe(100000);
      // The 40,000 entry is printed but voided, so it moves nothing.
      expect(book.totals.credit).toBe(0);
      expect(book.totals.count).toBe(1);
      expect(book.totals.printed).toBe(2);
      // -70,000 opening + 100,000 in.
      expect(book.totals.closing).toBe(30000);

      // The voided row is still printed with its amount intact, marked as voided.
      const printedVoid = book.lines.find((line) => line.docNumber === mistake.entryNumber);
      expect(printedVoid).toBeDefined();
      expect(printedVoid!.status).toBe('voided');
      expect(printedVoid!.credit).toBe(40000);

      // Widen the window and the previous day's expense becomes a posted line.
      const wide = await cashBookLedger({ from: dayOffset(-1), to: today() });
      expect(wide.openingBalance).toBe(0);
      expect(wide.totals.credit).toBe(70000);
      expect(wide.totals.closing).toBe(30000);
    });

    it('charges invoices, credits partial payments and closes on the outstanding balance', async () => {
      const [customer] = await db
        .insert(customerProfiles)
        .values({
          contactPerson: 'Ms Lan',
          mobileNumber: '+84900000001',
          email: 'lan@acme-retail.test',
          address: '12 Acme Street, Ho Chi Minh City',
          companyName: 'Acme Retail',
          customerType: 'B2B',
        })
        .returning();

      const sale = await createSale({
        userId: data.users.admin.id,
        items: [{ productId: data.products.product.id, quantity: 2 }],
        paymentMethod: 'CASH',
        transactionType: 'STORE_SALE',
        withVat: true,
        vatCompanyId: ciCompany.id,
        customerProfileId: customer.id,
        buyer: { name: 'Acme Retail', phone: '0900000001' },
        amountPaidNow: 100000,
      });
      expect(sale).toBeDefined();

      const statement = await customerStatementLedger(customer.id, {
        from: today(),
        to: today(),
      });

      expect(statement.party?.name).toBe('Acme Retail');
      expect(statement.columnLabels).toEqual({
        debit: 'Charged',
        credit: 'Paid',
        balance: 'Outstanding',
      });

      expect(statement.lines).toHaveLength(2);
      expect(statement.lines[0].docType).toBe('Invoice');
      expect(statement.lines[0].debit).toBe(220000);
      expect(statement.lines[1].docType).toBe('Receipt');
      expect(statement.lines[1].credit).toBe(100000);

      expect(statement.openingBalance).toBe(0);
      expect(statement.totals.closing).toBe(120000);
    });

    it('carries an earlier invoice and payment into the statement opening figure', async () => {
      const [customer] = await db
        .insert(customerProfiles)
        .values({
          contactPerson: 'Mr Tuan',
          mobileNumber: '+84900000002',
          email: 'tuan@old-debt.test',
          address: '48 Old Debt Street, Hanoi',
          companyName: 'Old Debt Co.',
          customerType: 'B2B',
        })
        .returning();

      await createSale({
        userId: data.users.admin.id,
        items: [{ productId: data.products.product.id, quantity: 2 }],
        paymentMethod: 'CASH',
        transactionType: 'STORE_SALE',
        withVat: true,
        vatCompanyId: ciCompany.id,
        customerProfileId: customer.id,
        buyer: { name: 'Old Debt Co.', phone: '0900000002' },
        amountPaidNow: 100000,
      });

      // Move the whole document into last period: issued 40 days ago, paid 39 days ago.
      const [invoice] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.customerProfileId, customer.id));
      await db
        .update(invoices)
        .set({ issuedAt: new Date(Date.now() - 40 * 86400000) })
        .where(eq(invoices.id, invoice.id));
      await db
        .update(invoicePayments)
        .set({ paidAt: new Date(Date.now() - 39 * 86400000) })
        .where(eq(invoicePayments.invoiceId, invoice.id));

      const statement = await customerStatementLedger(customer.id, {
        from: today(),
        to: today(),
      });

      // 220,000 charged - 100,000 paid = 120,000 owed before today, so the period starts there.
      expect(statement.openingBalance).toBe(120000);
      expect(statement.lines).toHaveLength(0);
      expect(statement.totals.closing).toBe(120000);
      expect(statement.totals.count).toBe(0);
    });
  });

  /**
   * The one-day drift an accountant will spot.
   *
   * Vietnam is UTC+7, so a receipt taken at 06:30 local on the 4th is stored as 23:30 UTC on the
   * 3rd. A UTC-boundary report would count it in the 3rd's takings, and "today" would still be
   * yesterday until 07:00. These tests pin the report to the Vietnamese day, and pin the printed
   * cash book to the same day, so the screen and the paper cannot disagree.
   */
  describe('Vietnamese day boundaries', () => {
    it('defaults the period to the Vietnamese day, not the UTC day', async () => {
      // 23:30 UTC on 3 Nov is 06:30 on 4 Nov in Ho Chi Minh City.
      const summary = await financeSummary({ today: new Date('2026-11-03T23:30:00.000Z') });

      expect(summary.to).toBe('2026-11-04');
      expect(summary.from).toBe('2026-11-01');
    });

    it('counts a receipt on the Vietnamese day the money was taken', async () => {
      await sellTwoUnits(100000);

      const [payment] = await db.select().from(invoicePayments);
      await db
        .update(invoicePayments)
        .set({ paidAt: new Date('2026-11-03T23:30:00.000Z') })
        .where(eq(invoicePayments.id, payment.id));

      const localDay = await financeSummary({ from: '2026-11-04', to: '2026-11-04' });
      expect(localDay.income.receipts).toBe(100000);
      expect(localDay.income.receiptsCount).toBe(1);

      // The UTC day the row is stored under must not claim it.
      const utcDay = await financeSummary({ from: '2026-11-03', to: '2026-11-03' });
      expect(utcDay.income.receipts).toBe(0);
      expect(utcDay.income.receiptsCount).toBe(0);

      // The printed cash book must put the same receipt on the same day.
      const book = await cashBookLedger({ from: '2026-11-04', to: '2026-11-04' });
      expect(book.totals.debit).toBe(100000);
      expect(book.lines.filter((line) => line.source === 'receipt')).toHaveLength(1);
    });
  });
});

