import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import {
  invoiceCounters,
  invoicePayments,
  invoices,
  inventory,
  products,
  salesOrderItems,
  salesOrders,
  userStoreAssignments,
  vatCompanies,
} from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData } from '../../helpers/test-db';
import { createSale } from '../../../server/sales';
import {
  InvoiceError,
  backfillInvoices,
  cancelInvoice,
  getInvoice,
  listInvoices,
  vietnamDateOffset,
} from '../../../server/invoices';
import { listReceipts, recordPayment, voidPayment } from '../../../server/payments';
import { issueSalesOrderInvoice } from '../../../server/sales-order-invoices';
import { generateSalesOrderNumber } from '../../../server/numbering';
import { DEFAULT_PAYMENT_TERM_DAYS } from '../../../shared/invoice-payment';

/**
 * Receivables - one invoice per sale, many receipts per invoice.
 *
 * These tests pin the promises the shop makes to a business customer:
 *
 *   - the invoice is a snapshot: paying it never changes what it says;
 *   - a receipt may never take more than the balance, so two cashiers cannot both collect the
 *     last instalment;
 *   - nothing is deleted: a wrong receipt is voided, a wrong invoice is cancelled, and both keep
 *     who/when/why;
 *   - a Sales Order's VAT invoice creates exactly one receivable, and issuing it twice does not
 *     allocate a second debt;
 *   - the backfill of historical sales can be run twice without duplicating anything.
 */
describe('receivables', () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let ciCompany: typeof vatCompanies.$inferSelect;

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

  /** A VAT sales order of 10 units: 1,000,000 + 10% = 1,100,000. */
  const createVatOrder = async () => {
    const [order] = await db
      .insert(salesOrders)
      .values({
        orderNumber: generateSalesOrderNumber(),
        customerName: 'Nguyen Van A',
        companyName: 'Pet Shop A',
        contactPerson: 'Mr A',
        customerTaxId: '0319999999',
        phone: '0900000000',
        deliveryAddress: '12 Le Loi, District 1',
        orderDate: new Date(),
        totalAmount: '1000000.00',
        status: 'open',
        preparedByUserId: data.users.admin.id,
        vatCompanyId: ciCompany.id,
        vatCompanyCode: ciCompany.code,
        vatCompanyName: ciCompany.name,
        vatCompanyTaxId: ciCompany.taxId,
        vatCompanyAddress: ciCompany.address,
        vatRate: '0.1000',
      })
      .returning();

    await db.insert(salesOrderItems).values({
      salesOrderId: order.id,
      productId: data.products.product.id,
      productCode: data.products.product.sku,
      description: data.products.product.name,
      quantity: 10,
      unitPrice: '100000.00',
      totalPrice: '1000000.00',
      deliveredQuantity: 0,
    });

    return order;
  };

  const invoiceOfSale = async (salesTransactionId: number) => {
    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.salesTransactionId, salesTransactionId),
      with: { payments: true },
    });
    expect(invoice).toBeDefined();
    return invoice!;
  };

  it('writes one paid invoice and one receipt for a counter sale', async () => {
    const sale = await sellTwoUnits();

    const invoice = await invoiceOfSale(sale!.id);
    expect(invoice.source).toBe('POS_SALE');
    expect(invoice.kind).toBe('VAT');
    expect(Number(invoice.totalAmount)).toBe(220000);
    expect(Number(invoice.subtotal)).toBe(200000);
    expect(Number(invoice.vatAmount)).toBe(20000);
    expect(Number(invoice.vatRate)).toBeCloseTo(0.1, 4);
    expect(Number(invoice.amountPaid)).toBe(220000);
    expect(Number(invoice.balanceDue)).toBe(0);
    expect(invoice.status).toBe('paid');
    // A counter sale is due on issue, not on terms.
    expect(invoice.dueDate).toBe(vietnamDateOffset(new Date(invoice.issuedAt), 0));

    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0].receiptNumber).toMatch(/^RCPT-\d{8}-\d{4}$/);
    expect(Number(invoice.payments[0].amount)).toBe(220000);
    expect(invoice.payments[0].receivedByUserId).toBe(data.users.admin.id);

    // The receipt number was allocated from the shared counter table, not a random string.
    const receiptCounters = await db
      .select()
      .from(invoiceCounters)
      .where(eq(invoiceCounters.counterType, 'RECEIPT'));
    expect(receiptCounters).toHaveLength(1);
    expect(receiptCounters[0].currentNumber).toBe(1);
  });

  it('keeps a partly paid sale outstanding and settles it with a second receipt', async () => {
    const sale = await sellTwoUnits(100000);
    const invoice = await invoiceOfSale(sale!.id);

    expect(invoice.status).toBe('partially_paid');
    expect(Number(invoice.amountPaid)).toBe(100000);
    expect(Number(invoice.balanceDue)).toBe(120000);
    // The document value did not move because money arrived - only the money columns did.
    expect(Number(invoice.totalAmount)).toBe(220000);

    const second = await recordPayment({
      invoiceId: invoice.id,
      amount: 120000,
      paymentMethod: 'BANK_TRANSFER',
      reference: 'VCB-1234',
      userId: data.users.admin.id,
      storeId: data.stores.store1.id,
    });

    expect(second.payment.receiptNumber).toMatch(/^RCPT-\d{8}-\d{4}$/);
    expect(Number(second.invoice.amountPaid)).toBe(220000);
    expect(Number(second.invoice.balanceDue)).toBe(0);
    expect(second.invoice.status).toBe('paid');

    const reloaded = await getInvoice(invoice.id);
    expect(reloaded.payments.filter((payment) => !payment.voided)).toHaveLength(2);
  });

  it('refuses a receipt larger than the balance and leaves the invoice untouched', async () => {
    const sale = await sellTwoUnits(100000);
    const invoice = await invoiceOfSale(sale!.id);

    await expect(
      recordPayment({
        invoiceId: invoice.id,
        amount: 120001,
        paymentMethod: 'CASH',
        userId: data.users.admin.id,
        storeId: data.stores.store1.id,
      })
    ).rejects.toBeInstanceOf(InvoiceError);

    await recordPayment({
      invoiceId: invoice.id,
      amount: 120000,
      paymentMethod: 'CASH',
      userId: data.users.admin.id,
      storeId: data.stores.store1.id,
    });

    // Already fully paid: another receipt is refused, so the balance cannot go negative.
    await expect(
      recordPayment({
        invoiceId: invoice.id,
        amount: 1,
        paymentMethod: 'CASH',
        userId: data.users.admin.id,
        storeId: data.stores.store1.id,
      })
    ).rejects.toBeInstanceOf(InvoiceError);

    const reloaded = await getInvoice(invoice.id);
    expect(reloaded.status).toBe('paid');
    expect(Number(reloaded.balanceDue)).toBe(0);
  });

  it('voids a receipt instead of deleting it and re-opens the balance', async () => {
    const sale = await sellTwoUnits(100000);
    const invoice = await invoiceOfSale(sale!.id);

    const payment = await recordPayment({
      invoiceId: invoice.id,
      amount: 120000,
      paymentMethod: 'CASH',
      userId: data.users.admin.id,
      storeId: data.stores.store1.id,
    });

    const voided = await voidPayment({
      paymentId: payment.payment.id,
      userId: data.users.admin.id,
      reason: 'Customer paid the wrong amount',
    });

    expect(Number(voided.invoice.balanceDue)).toBe(120000);
    expect(voided.invoice.status).toBe('partially_paid');

    // The row survives with who/when/why - history is not rewritten.
    const reloaded = await getInvoice(invoice.id);
    const kept = reloaded.payments.find((p) => p.id === payment.payment.id)!;
    expect(kept.voided).toBe(true);
    expect(kept.voidReason).toBe('Customer paid the wrong amount');
    expect(kept.voidedByUserId).toBe(data.users.admin.id);

    // Voiding twice is refused rather than silently applied.
    await expect(
      voidPayment({
        paymentId: payment.payment.id,
        userId: data.users.admin.id,
        reason: 'again',
      })
    ).rejects.toBeInstanceOf(InvoiceError);
  });

  it('cancels an invoice only when no money is recorded against it', async () => {
    const sale = await sellTwoUnits(100000);
    const invoice = await invoiceOfSale(sale!.id);

    await expect(
      cancelInvoice({ invoiceId: invoice.id, userId: data.users.admin.id, reason: 'duplicate' })
    ).rejects.toBeInstanceOf(InvoiceError);

    const unpaid = await sellTwoUnits(0);
    const unpaidInvoice = await invoiceOfSale(unpaid!.id);
    const cancelled = await cancelInvoice({
      invoiceId: unpaidInvoice.id,
      userId: data.users.admin.id,
      reason: 'raised in error',
    });

    expect(cancelled!.status).toBe('cancelled');
    expect(cancelled!.cancelReason).toBe('raised in error');
    expect(cancelled!.cancelledByUserId).toBe(data.users.admin.id);

    // A cancelled invoice stays in the register but owes nothing.
    const report = await listInvoices({ status: 'outstanding' });
    expect(report.invoices.map((row) => row.id)).not.toContain(unpaidInvoice.id);
  });

  it('registers exactly one receivable for a Sales Order VAT invoice', async () => {
    const order = await createVatOrder();

    const issued = await issueSalesOrderInvoice(order.id);
    // Issuing twice returns the same document and must not add a second debt.
    await issueSalesOrderInvoice(order.id);

    const rows = await db.select().from(invoices).where(eq(invoices.salesOrderId, order.id));
    expect(rows).toHaveLength(1);

    const invoice = rows[0];
    expect(invoice.source).toBe('SALES_ORDER');
    // A sales order invoice is a company document: no store, and it carries credit terms.
    expect(invoice.storeId).toBeNull();
    expect(invoice.invoiceNumber).toBe(issued.invoiceNumber);
    expect(Number(invoice.totalAmount)).toBe(1100000);
    expect(invoice.status).toBe('issued');
    expect(invoice.dueDate).toBe(
      vietnamDateOffset(new Date(invoice.issuedAt), DEFAULT_PAYMENT_TERM_DAYS)
    );
  });

  it('backfills the receivable of a Sales Order invoiced before receivables existed', async () => {
    const order = await createVatOrder();
    const issued = await issueSalesOrderInvoice(order.id);

    // Simulate an invoice issued before the `invoices` table existed: the number is on the
    // order, the receivable row is not.
    await db.delete(invoices).where(eq(invoices.salesOrderId, order.id));

    const preview = await backfillInvoices({ dryRun: true });
    expect(preview.created).toBe(1);
    expect(preview.orderInvoices).toBe(1);
    expect(await db.select().from(invoices)).toHaveLength(0);

    const run = await backfillInvoices();
    expect(run.created).toBe(1);
    expect(run.orderInvoices).toBe(1);
    // An order invoice is not paid at issue: the backfill must not invent a receipt.
    expect(run.receipts).toBe(0);

    const rows = await db.select().from(invoices).where(eq(invoices.salesOrderId, order.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].invoiceNumber).toBe(issued.invoiceNumber);
    expect(rows[0].status).toBe('issued');
    expect(Number(rows[0].totalAmount)).toBe(1100000);
    expect(Number(rows[0].balanceDue)).toBe(1100000);
    expect(await db.select().from(invoicePayments)).toHaveLength(0);

    // Idempotent: a second run finds nothing left to register.
    expect((await backfillInvoices()).created).toBe(0);
  });

  it('reports outstanding totals, aging and statuses for the receivables page', async () => {
    const paid = await sellTwoUnits();
    const owing = await sellTwoUnits(50000);

    const report = await listInvoices({});
    expect(report.invoices).toHaveLength(2);
    expect(report.summary.counts.paid).toBe(1);
    expect(report.summary.counts.partially_paid).toBe(1);
    expect(report.summary.totalInvoiced).toBe(440000);
    expect(report.summary.totalPaid).toBe(220000 + 50000);
    expect(report.summary.totalOutstanding).toBe(170000);

    const outstanding = await listInvoices({ status: 'outstanding' });
    expect(outstanding.invoices).toHaveLength(1);
    expect(outstanding.invoices[0].salesTransactionId).toBe(owing!.id);

    const bySearch = await listInvoices({ search: paid!.invoiceNumber });
    expect(bySearch.invoices).toHaveLength(1);

    // Store scoping: an own store sees its sales, a foreign store sees none of them.
    const byStore = await listInvoices({ storeIds: [data.stores.store1.id] });
    expect(byStore.invoices).toHaveLength(2);
    const foreignStore = await listInvoices({ storeIds: [data.stores.warehouse.id] });
    expect(foreignStore.invoices).toHaveLength(0);

    // Every aging bucket is present so the UI can render a fixed table.
    expect(report.aging.map((bucket) => bucket.key)).toContain('current');
    const current = report.aging.find((bucket) => bucket.key === 'current')!;
    expect(current.amount).toBe(170000);
    expect(current.count).toBe(1);
  });

  it('backfills historical sales once, and can be previewed without writing', async () => {
    const sale = await sellTwoUnits();
    // Simulate a sale made before receivables existed: drop its receipt and invoice again.
    const [existing] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.salesTransactionId, sale!.id));
    await db.delete(invoicePayments).where(eq(invoicePayments.invoiceId, existing.id));
    await db.delete(invoices).where(eq(invoices.id, existing.id));

    const preview = await backfillInvoices({ dryRun: true });
    expect(preview.created).toBe(1);
    expect(await db.select().from(invoices)).toHaveLength(0);

    const first = await backfillInvoices();
    expect(first.created).toBe(1);
    expect(first.receipts).toBe(1);

    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.salesTransactionId, sale!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('paid');
    expect(Number(rows[0].balanceDue)).toBe(0);

    // Running it again changes nothing - the register is not duplicated.
    const second = await backfillInvoices();
    expect(second.created).toBe(0);
    expect(await db.select().from(invoices)).toHaveLength(1);
  });

  it('lists every customer receipt with the invoice and the company that issued it', async () => {
    // A till sale settled at the counter, and a Sales Order invoice paid in instalments.
    const sale = await sellTwoUnits();
    const order = await createVatOrder();
    const issued = await issueSalesOrderInvoice(order.id);

    const orderInvoice = await db.query.invoices.findFirst({
      where: eq(invoices.salesOrderId, order.id),
    });
    const instalment = await recordPayment({
      invoiceId: orderInvoice!.id,
      amount: 200000,
      paymentMethod: 'BANK_TRANSFER',
      reference: 'VCB-884422',
      userId: data.users.admin.id,
      storeId: null,
    });

    const register = await listReceipts({});

    expect(register.receipts).toHaveLength(2);
    const row = register.receipts.find(
      (receipt) => receipt.receiptNumber === instalment.payment.receiptNumber
    )!;

    // The number printed on the receipt, the invoice it settles and its issuer all agree.
    expect(row.receiptNumber).toMatch(/^RCPT-\d{8}-\d{4}$/);
    expect(row.invoice.invoiceNumber).toBe(issued.invoiceNumber);
    expect(row.invoice.source).toBe('SALES_ORDER');
    expect(row.invoice.orderNumber).toBe(order.orderNumber);
    expect(row.invoice.vatCompany?.name).toBe('Conqueror International');
    expect(row.invoice.buyerName).toBe('Pet Shop A');
    expect(row.reference).toBe('VCB-884422');
    expect(row.receivedBy?.username).toBe(data.users.admin.username);

    // A receipt shows the balance it left behind, not today's balance.
    expect(row.invoice.totalAmount).toBe(1100000);
    expect(row.paidBefore).toBe(0);
    expect(row.amount).toBe(200000);
    expect(row.balanceAfter).toBe(900000);
    expect(row.voided).toBe(false);

    // The till sale is in the same register, under the same issuer, with no order number.
    const tillRow = register.receipts.find((receipt) => receipt.id !== row.id)!;
    expect(tillRow.invoice.invoiceNumber).toBe(sale!.invoiceNumber);
    expect(tillRow.invoice.source).toBe('POS_SALE');
    expect(tillRow.invoice.orderNumber).toBeNull();
    expect(tillRow.balanceAfter).toBe(0);

    expect(register.summary.receiptCount).toBe(2);
    expect(register.summary.receivedTotal).toBe(220000 + 200000);
    expect(register.summary.voidedCount).toBe(0);
  });

  it('keeps a voided receipt in the register but out of the money received', async () => {
    const sale = await sellTwoUnits();
    const invoice = await invoiceOfSale(sale!.id);

    await voidPayment({
      paymentId: invoice.payments[0].id,
      userId: data.users.admin.id,
      reason: 'Recorded against the wrong invoice',
    });

    const register = await listReceipts({});
    expect(register.receipts).toHaveLength(1);
    expect(register.receipts[0].voided).toBe(true);
    expect(register.receipts[0].voidReason).toBe('Recorded against the wrong invoice');
    expect(register.receipts[0].amount).toBe(220000);
    // A voided receipt no longer pays the invoice down, so the balance is back to the total.
    expect(register.receipts[0].balanceAfter).toBe(220000);
    expect(register.summary.receivedTotal).toBe(0);
    expect(register.summary.voidedCount).toBe(1);

    expect(await listReceipts({ status: 'active' })).toMatchObject({
      receipts: [],
      total: 0,
    });
    expect((await listReceipts({ status: 'voided' })).receipts).toHaveLength(1);
  });

  it('searches receipts by number and keeps store scoping on the invoice', async () => {
    await sellTwoUnits();
    const order = await createVatOrder();
    await issueSalesOrderInvoice(order.id);
    const orderInvoice = await db.query.invoices.findFirst({
      where: eq(invoices.salesOrderId, order.id),
    });
    const instalment = await recordPayment({
      invoiceId: orderInvoice!.id,
      amount: 200000,
      paymentMethod: 'CASH',
      userId: data.users.admin.id,
      storeId: null,
    });

    const byReceipt = await listReceipts({ search: instalment.payment.receiptNumber });
    expect(byReceipt.receipts).toHaveLength(1);
    expect(byReceipt.receipts[0].id).toBe(instalment.payment.id);

    const byInvoice = await listReceipts({ search: orderInvoice!.invoiceNumber });
    expect(byInvoice.receipts).toHaveLength(1);

    // The till receipt lives in store1; the order receipt has no store (company document) and is
    // therefore visible to every scope, exactly like the invoice it pays.
    const ownStore = await listReceipts({ storeIds: [data.stores.store1.id] });
    expect(ownStore.receipts).toHaveLength(2);

    const foreignStore = await listReceipts({ storeIds: [data.stores.warehouse.id] });
    expect(foreignStore.receipts).toHaveLength(1);
    expect(foreignStore.receipts[0].invoice.source).toBe('SALES_ORDER');
  });
});
