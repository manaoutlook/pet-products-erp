import { db } from "@db";
import {
  financeEntries,
  financePartners,
  invoicePayments,
  invoices,
  purchaseOrders,
  suppliers,
} from "@db/schema";
import { and, desc, eq, gte, ilike, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { DbClient } from "./db-types";
import { generateFinanceEntryNumber } from "./finance-counter";
import {
  AGING_BUCKETS,
  agingBucketOf,
  displayInvoiceStatus,
} from "../shared/invoice-payment";
import type { InvoiceStatus } from "../shared/invoice-payment";
import type { FinanceEntryType, FundingKind } from "../shared/finance";
import {
  PURCHASE_ORDER_EXPENSE_CATEGORY,
  directionOfFinanceEntry,
  isPartnerEntryType,
  partnerBalanceOf,
  validatePartnerWithdrawal,
} from "../shared/finance";
import { endOfVietnamDay, startOfVietnamDay, vietnamDayOf } from "../shared/vietnam-day";

/**
 * Financial accounts service.
 *
 * Two books, one report:
 *   1. `invoice_payments` - money received against an invoice. Written by the Receivables module.
 *   2. `finance_entries`  - money typed in here: expenses, other income, partner capital.
 *
 * The report (`financeSummary`) adds them together but never copies rows between them. A receipt
 * voided in Receivables therefore disappears from income immediately, with no reconciliation.
 *
 * Purchase orders post into `finance_entries` instead: creating one writes a posted expense for
 * its total (heading "Supplier purchases", reference = PO number), and cancelling it voids that
 * row. The report also lists the orders behind those rows as `purchases`, so the supplier and the
 * PO number are one click from the money-out total.
 *
 * Every write is a transaction. A partner withdrawal takes a row lock on the partner before it
 * reads the balance, so two people cannot both withdraw the last of the money.
 */

export class FinanceError extends Error {
  status: number;
  suggestion?: string;

  constructor(message: string, status = 400, suggestion?: string) {
    super(message);
    this.name = "FinanceError";
    this.status = status;
    this.suggestion = suggestion;
  }
}

export interface CreateFinanceEntryInput {
  entryType: FinanceEntryType;
  category: string;
  description: string;
  amount: number | string;
  entryDate: string;
  paymentMethod?: string;
  reference?: string | null;
  notes?: string | null;
  partnerId?: number | null;
  fundingKind?: FundingKind | null;
  createdByUserId: number;
}

export interface ListFinanceEntriesFilters {
  entryType?: FinanceEntryType;
  status?: "posted" | "voided";
  partnerId?: number;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface FinanceSummaryFilters {
  from?: string;
  to?: string;
  today?: Date;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function roundMoney(value: number): number {
  return Math.round(value);
}

/** A numeric amount from a Postgres decimal (string) or a JS number. */
function numberOf(value: string | number | null | undefined): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : 0;
}

function assertDate(value: string, label: string): string {
  // `new Date('2026-02-31T00:00:00.000Z')` silently rolls over to 3 March, so compare the parsed
  // day back to the input instead of only checking that the string parses.
  const parsed = DATE_PATTERN.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new FinanceError(`${label} must be a real date in YYYY-MM-DD format`, 400);
  }
  return value;
}

export function toFinanceEntryApiRow(
  entry: typeof financeEntries.$inferSelect & {
    partner?: { id: number; name: string } | null;
    createdByUser?: { id: number; username: string } | null;
    voidedByUser?: { id: number; username: string } | null;
  }
) {
  return {
    ...entry,
    amount: numberOf(entry.amount),
    directionLabel: entry.direction === "credit" ? "Credit" : "Debit",
    voided: entry.status === "voided",
    partner: entry.partner ?? null,
    createdByUser: entry.createdByUser ?? null,
    voidedByUser: entry.voidedByUser ?? null,
  };
}

const entryRelations = {
  partner: { columns: { id: true, name: true } },
  createdByUser: { columns: { id: true, username: true } },
  voidedByUser: { columns: { id: true, username: true } },
} as const;

/** One entry with its partner and the users who wrote/voided it. */
export async function getFinanceEntry(entryId: number) {
  const entry = await db.query.financeEntries.findFirst({
    where: eq(financeEntries.id, entryId),
    with: entryRelations,
  });

  if (!entry) throw new FinanceError("Finance entry not found", 404);
  return toFinanceEntryApiRow(entry);
}

/** Posted deposits and withdrawals per partner, as decimals. */
async function partnerTotals(executor: DbClient, partnerId?: number) {
  const where = partnerId
    ? and(eq(financeEntries.status, "posted"), eq(financeEntries.partnerId, partnerId))
    : and(eq(financeEntries.status, "posted"), sql`${financeEntries.partnerId} IS NOT NULL`);

  return executor
    .select({
      partnerId: financeEntries.partnerId,
      deposits: sql<string>`COALESCE(SUM(CASE WHEN ${financeEntries.entryType} = 'partner_deposit' THEN ${financeEntries.amount} ELSE 0 END), 0)`,
      withdrawals: sql<string>`COALESCE(SUM(CASE WHEN ${financeEntries.entryType} = 'partner_withdrawal' THEN ${financeEntries.amount} ELSE 0 END), 0)`,
    })
    .from(financeEntries)
    .where(where)
    .groupBy(financeEntries.partnerId);
}

/**
 * Validate one entry and turn its amount into whole VND.
 *
 * Kept separate from the insert so a caller that already holds a transaction (a purchase order is
 * posted together with its items) can reuse exactly the same rules instead of keeping a second
 * copy that drifts.
 */
function validateEntryInput(input: CreateFinanceEntryInput) {
  const amount = roundMoney(numberOf(input.amount));
  if (amount <= 0) throw new FinanceError("Enter an amount greater than zero", 400);
  if (!input.category?.trim()) throw new FinanceError("Choose a category", 400);
  if (!input.description?.trim()) throw new FinanceError("Describe what the money was for", 400);
  assertDate(input.entryDate, "Entry date");

  const entryType = input.entryType;
  const partnerEntry = isPartnerEntryType(entryType);

  if (!partnerEntry && input.partnerId) {
    throw new FinanceError("Only partner deposits and withdrawals can name a partner", 400);
  }
  if (partnerEntry && (!input.partnerId || !input.fundingKind)) {
    throw new FinanceError(
      "Choose the partner and whether the money is capital or a temporary loan",
      400
    );
  }

  return { amount, entryType, partnerEntry };
}

/**
 * Allocate the entry number and insert the row in the caller's transaction.
 *
 * The number is generated from the same executor, so a purchase order and its expense commit or
 * roll back as one unit.
 */
async function insertEntry(
  executor: DbClient,
  input: CreateFinanceEntryInput,
  amount: number,
  entryType: FinanceEntryType,
  partnerEntry: boolean
) {
  const entryNumber = await generateFinanceEntryNumber(executor);

  const [created] = await executor
    .insert(financeEntries)
    .values({
      entryNumber,
      entryType,
      direction: directionOfFinanceEntry(entryType),
      category: input.category.trim(),
      description: input.description.trim(),
      amount: amount.toFixed(2),
      entryDate: input.entryDate,
      paymentMethod: input.paymentMethod || "CASH",
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      partnerId: partnerEntry ? input.partnerId ?? null : null,
      fundingKind: partnerEntry ? input.fundingKind ?? null : null,
      status: "posted",
      createdByUserId: input.createdByUserId,
    })
    .returning();

  const entry = await executor.query.financeEntries.findFirst({
    where: eq(financeEntries.id, created.id),
    with: entryRelations,
  });

  return toFinanceEntryApiRow(entry!);
}

/**
 * Insert a posted income/expense row using a transaction the caller already opened.
 *
 * Used when a document that is itself money moving (a purchase order) must post its expense in
 * the same transaction as the document. Partner entries are refused here on purpose: they need
 * the partner row lock and the balance check that `createFinanceEntry` owns.
 */
export async function insertPostedFinanceEntry(
  executor: DbClient,
  input: CreateFinanceEntryInput
) {
  if (isPartnerEntryType(input.entryType)) {
    throw new FinanceError(
      "Partner deposits and withdrawals must be recorded from the Finance screen",
      400
    );
  }

  const { amount, entryType, partnerEntry } = validateEntryInput(input);
  return insertEntry(executor, input, amount, entryType, partnerEntry);
}

/**
 * Record an expense, other income, partner deposit or partner withdrawal.
 *
 * The number and the row commit together. A withdrawal is refused (409) when it would take out
 * more than the partner has put in; the check runs under the partner row lock.
 */
export async function createFinanceEntry(input: CreateFinanceEntryInput) {
  const { amount, entryType, partnerEntry } = validateEntryInput(input);

  return db.transaction(async (tx) => {
    if (partnerEntry) {
      // Lock the partner row before reading the balance. Without the lock two withdrawals of the
      // last 10,000,000 could both read "10,000,000 available" and both post.
      const locked = (await tx.execute(
        sql`SELECT id FROM finance_partners WHERE id = ${input.partnerId} FOR UPDATE`
      )) as unknown as { id: number }[];
      if (locked.length === 0) throw new FinanceError("Partner not found", 404);

      if (entryType === "partner_withdrawal") {
        const [totals] = await partnerTotals(tx, input.partnerId!);
        const available = partnerBalanceOf(totals?.deposits, totals?.withdrawals);
        const check = validatePartnerWithdrawal(amount, available);
        if (!check.valid) throw new FinanceError(check.error!, 409, check.suggestion);
      }
    }

    return insertEntry(tx, input, amount, entryType, partnerEntry);
  });
}

/**
 * Void a posted entry. Nothing is deleted: the row keeps who voided it, when and why, and every
 * total drops it because totals only read `status = 'posted'`.
 *
 * A partner deposit that has already been (partly) withdrawn cannot be voided: doing so would
 * leave the partner with a negative balance, which is money they never put in.
 */
export async function voidFinanceEntry(input: {
  entryId: number;
  voidedByUserId: number;
  reason: string;
}) {
  const reason = input.reason?.trim();
  if (!reason) throw new FinanceError("Give a reason for voiding this entry", 400);

  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(financeEntries)
      .where(eq(financeEntries.id, input.entryId))
      .for("update");

    if (!entry) throw new FinanceError("Finance entry not found", 404);
    if (entry.status === "voided") {
      throw new FinanceError("This entry is already voided", 409);
    }

    if (entry.entryType === "partner_deposit" && entry.partnerId) {
      const [totals] = await partnerTotals(tx, entry.partnerId);
      const balance = partnerBalanceOf(totals?.deposits, totals?.withdrawals);
      const remaining = balance - numberOf(entry.amount);

      if (remaining < 0) {
        throw new FinanceError(
          "This deposit cannot be voided because the partner has already withdrawn the money",
          409,
          "Void the withdrawal first, then void the deposit."
        );
      }
    }

    await tx
      .update(financeEntries)
      .set({
        status: "voided",
        voidedAt: new Date(),
        voidedByUserId: input.voidedByUserId,
        voidReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(financeEntries.id, entry.id));

    const updated = await tx.query.financeEntries.findFirst({
      where: eq(financeEntries.id, entry.id),
      with: entryRelations,
    });

    return toFinanceEntryApiRow(updated!);
  });
}

/**
 * The manual money book, filterable exactly as the screen filters it.
 *
 * The totals cover every matching row, not just the page, so the "credits / debits" line does not
 * change when the operator paginates.
 */
export async function listFinanceEntries(filters: ListFinanceEntriesFilters = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const conditions = [];
  if (filters.entryType) conditions.push(eq(financeEntries.entryType, filters.entryType));
  if (filters.status) conditions.push(eq(financeEntries.status, filters.status));
  if (filters.partnerId) conditions.push(eq(financeEntries.partnerId, filters.partnerId));
  if (filters.from) conditions.push(gte(financeEntries.entryDate, assertDate(filters.from, "From date")));
  if (filters.to) conditions.push(lte(financeEntries.entryDate, assertDate(filters.to, "To date")));
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        ilike(financeEntries.entryNumber, term),
        ilike(financeEntries.description, term),
        ilike(financeEntries.category, term),
        ilike(financeEntries.reference, term)
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalsRows] = await Promise.all([
    db.query.financeEntries.findMany({
      where,
      with: entryRelations,
      orderBy: [desc(financeEntries.entryDate), desc(financeEntries.id)],
      limit,
      offset,
    }),
    db
      .select({
        count: sql<string>`COUNT(*)`,
        credits: sql<string>`COALESCE(SUM(CASE WHEN ${financeEntries.status} = 'posted' AND ${financeEntries.direction} = 'credit' THEN ${financeEntries.amount} ELSE 0 END), 0)`,
        debits: sql<string>`COALESCE(SUM(CASE WHEN ${financeEntries.status} = 'posted' AND ${financeEntries.direction} = 'debit' THEN ${financeEntries.amount} ELSE 0 END), 0)`,
      })
      .from(financeEntries)
      .where(where),
  ]);

  const totals = totalsRows[0];

  return {
    entries: rows.map((row) => toFinanceEntryApiRow(row)),
    total: Number(totals?.count ?? 0),
    limit,
    offset,
    totals: {
      credits: numberOf(totals?.credits),
      debits: numberOf(totals?.debits),
      net: numberOf(totals?.credits) - numberOf(totals?.debits),
    },
  };
}

/**
 * Partners with their live balance. The balance is derived, never stored: voiding a deposit or a
 * withdrawal changes it with no extra write.
 */
export async function listFinancePartners() {
  const [partners, totalsRows] = await Promise.all([
    db.select().from(financePartners).orderBy(financePartners.name),
    partnerTotals(db),
  ]);

  const totalsByPartner = new Map(totalsRows.map((row) => [row.partnerId, row]));

  const rows = partners.map((partner) => {
    const totals = totalsByPartner.get(partner.id);
    const deposits = numberOf(totals?.deposits);
    const withdrawals = numberOf(totals?.withdrawals);
    return {
      ...partner,
      deposits,
      withdrawals,
      balance: partnerBalanceOf(deposits, withdrawals),
    };
  });

  const deposits = rows.reduce((sum, row) => sum + row.deposits, 0);
  const withdrawals = rows.reduce((sum, row) => sum + row.withdrawals, 0);

  return {
    partners: rows,
    totals: {
      deposits,
      withdrawals,
      balance: partnerBalanceOf(deposits, withdrawals),
      partnerCount: rows.length,
    },
  };
}

/** Register a partner so a deposit/withdrawal can name who the money belongs to. */
export async function createFinancePartner(input: {
  name: string;
  phone?: string | null;
  notes?: string | null;
  createdByUserId: number;
}) {
  const name = input.name?.trim();
  if (!name) throw new FinanceError("Enter the partner's name", 400);

  try {
    const [partner] = await db
      .insert(financePartners)
      .values({
        name,
        phone: input.phone?.trim() || null,
        notes: input.notes?.trim() || null,
        createdByUserId: input.createdByUserId,
      })
      .returning();

    return { ...partner, deposits: 0, withdrawals: 0, balance: 0 };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new FinanceError("A partner with this name already exists", 409);
    }
    throw error;
  }
}

/**
 * The financial report for a date range.
 *
 * It answers four questions in one payload:
 *   - what came in (invoice receipts + manual income)          -> CREDIT
 *   - what went out (expenses + partner withdrawals)           -> DEBIT
 *   - what is still owed to us, with partially paid invoices   -> receivables
 *   - how much partner money is currently in the company        -> capital balance
 *
 * It also returns the purchase orders of the period as `purchases`: the supplier and PO number
 * behind the "Supplier purchases" expense rows, plus a flag for orders that posted no expense.
 * Their totals are NOT added to `expenses` again - the expense row each order wrote is already
 * in `finance_entries` - so the block is a drill-down, never a second count.
 *
 * Only POSTED finance entries count. Receipts count when they are not voided, by `paid_at`, so a
 * receipt dated inside the range belongs to that range no matter when it was typed in.
 *
 * The range is Vietnamese calendar days (`shared/vietnam-day.ts`), not UTC: a receipt taken at
 * 06:30 local is 23:30 UTC the day before, and the printed cash book already uses Vietnam days -
 * a UTC filter here would make the on-screen total and the paper disagree by one day.
 */
export async function financeSummary(filters: FinanceSummaryFilters = {}) {
  const today = filters.today ?? new Date();
  const defaultTo = vietnamDayOf(today) || today.toISOString().slice(0, 10);
  const to = assertDate(filters.to ?? defaultTo, "To date");
  const from = assertDate(filters.from ?? `${to.slice(0, 7)}-01`, "From date");
  if (from > to) throw new FinanceError("The start date must be on or before the end date", 400);

  // `finance_entries.entry_date` is a plain date column, so it compares against the strings above;
  // the timestamped tables (receipts, invoices) need the real instants of the local day.
  const fromDate = startOfVietnamDay(from);
  const toDate = endOfVietnamDay(to);

  const periodWhere = and(
    eq(financeEntries.status, "posted"),
    gte(financeEntries.entryDate, from),
    lte(financeEntries.entryDate, to)
  );

  const [
    receiptRows,
    entryRows,
    fundingRows,
    outstandingRows,
    partners,
    partnerTotalsRows,
    purchaseOrderRows,
  ] = await Promise.all([
      db
        .select({
          total: sql<string>`COALESCE(SUM(${invoicePayments.amount}), 0)`,
          count: sql<string>`COUNT(*)`,
        })
        .from(invoicePayments)
        .where(
          and(
            isNull(invoicePayments.voidedAt),
            gte(invoicePayments.paidAt, fromDate),
            lte(invoicePayments.paidAt, toDate)
          )
        ),
      db
        .select({
          entryType: financeEntries.entryType,
          category: financeEntries.category,
          amount: financeEntries.amount,
        })
        .from(financeEntries)
        .where(periodWhere),
      db
        .select({
          fundingKind: financeEntries.fundingKind,
          deposits: sql<string>`COALESCE(SUM(CASE WHEN ${financeEntries.entryType} = 'partner_deposit' THEN ${financeEntries.amount} ELSE 0 END), 0)`,
          withdrawals: sql<string>`COALESCE(SUM(CASE WHEN ${financeEntries.entryType} = 'partner_withdrawal' THEN ${financeEntries.amount} ELSE 0 END), 0)`,
        })
        .from(financeEntries)
        .where(
          and(
            eq(financeEntries.status, "posted"),
            sql`${financeEntries.entryType} IN ('partner_deposit', 'partner_withdrawal')`
          )
        )
        .groupBy(financeEntries.fundingKind),
      db
        .select({
          id: invoices.id,
          status: invoices.status,
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
          balanceDue: invoices.balanceDue,
          dueDate: invoices.dueDate,
        })
        .from(invoices)
        .where(
          and(
            sql`${invoices.status} IN ('issued', 'partially_paid')`,
            sql`${invoices.balanceDue} > 0`,
            lte(invoices.issuedAt, toDate)
          )
        ),
      db.select({ id: financePartners.id, name: financePartners.name }).from(financePartners),
      partnerTotals(db),
      /*
       * The purchase orders themselves, so the report can name the supplier and the PO behind the
       * "Supplier purchases" expense heading. The expense row is matched by its reference (the PO
       * number), which is how a cancelled order's voided entry is recognised as voided here.
       */
      db
        .select({
          id: purchaseOrders.id,
          orderNumber: purchaseOrders.orderNumber,
          orderDate: purchaseOrders.orderDate,
          status: purchaseOrders.status,
          totalAmount: purchaseOrders.totalAmount,
          supplierName: suppliers.name,
          expenseEntryNumber: financeEntries.entryNumber,
          expenseStatus: financeEntries.status,
        })
        .from(purchaseOrders)
        .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .leftJoin(
          financeEntries,
          and(
            eq(financeEntries.reference, purchaseOrders.orderNumber),
            eq(financeEntries.category, PURCHASE_ORDER_EXPENSE_CATEGORY)
          )
        )
        .where(
          and(
            gte(purchaseOrders.orderDate, fromDate),
            lte(purchaseOrders.orderDate, toDate),
            ne(purchaseOrders.status, "cancelled")
          )
        )
        .orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.id)),
    ]);

  // --- Money in / money out ---------------------------------------------------------------
  const receipts = numberOf(receiptRows[0]?.total);
  let otherIncome = 0;
  let expenseTotal = 0;
  let deposits = 0;
  let withdrawals = 0;

  const incomeByCategory = new Map<string, number>();
  const expenseByCategory = new Map<string, { amount: number; count: number }>();
  let expenseCount = 0;

  for (const row of entryRows) {
    const amount = numberOf(row.amount);
    switch (row.entryType) {
      case "income":
        otherIncome += amount;
        incomeByCategory.set(row.category, (incomeByCategory.get(row.category) ?? 0) + amount);
        break;
      case "expense": {
        expenseTotal += amount;
        expenseCount += 1;
        const current = expenseByCategory.get(row.category) ?? { amount: 0, count: 0 };
        expenseByCategory.set(row.category, {
          amount: current.amount + amount,
          count: current.count + 1,
        });
        break;
      }
      case "partner_deposit":
        deposits += amount;
        break;
      case "partner_withdrawal":
        withdrawals += amount;
        break;
      default:
        break;
    }
  }

  const totalIncome = receipts + otherIncome;
  const netProfit = totalIncome - expenseTotal;

  // --- Receivables ------------------------------------------------------------------------
  const counts: Record<InvoiceStatus, number> = {
    issued: 0,
    partially_paid: 0,
    paid: 0,
    overdue: 0,
    cancelled: 0,
  };
  let totalOutstanding = 0;
  let partiallyPaidAmount = 0;
  let overdueAmount = 0;

  const aging = AGING_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    amount: 0,
    count: 0,
  }));
  const agingByKey = new Map(aging.map((bucket) => [bucket.key, bucket]));

  for (const row of outstandingRows) {
    const total = numberOf(row.totalAmount);
    const paid = numberOf(row.amountPaid);
    const balance = Math.max(0, Math.round(total - paid));
    const status = displayInvoiceStatus(
      { status: row.status as InvoiceStatus, balanceDue: balance, dueDate: row.dueDate },
      today
    );

    counts[status] += 1;
    totalOutstanding += balance;

    if (status === "partially_paid") partiallyPaidAmount += balance;
    if (status === "overdue") overdueAmount += balance;

    const bucket = agingByKey.get(agingBucketOf(row.dueDate, today).key);
    if (bucket) {
      bucket.amount += balance;
      bucket.count += 1;
    }
  }

  // --- Partner capital --------------------------------------------------------------------
  const partnerNames = new Map(partners.map((partner) => [partner.id, partner.name]));
  const byPartner = partnerTotalsRows
    .map((row) => {
      const partnerDeposits = numberOf(row.deposits);
      const partnerWithdrawals = numberOf(row.withdrawals);
      return {
        partnerId: row.partnerId,
        name: row.partnerId ? partnerNames.get(row.partnerId) ?? "Unknown partner" : "Unassigned",
        deposits: partnerDeposits,
        withdrawals: partnerWithdrawals,
        balance: partnerBalanceOf(partnerDeposits, partnerWithdrawals),
      };
    })
    .sort((a, b) => b.balance - a.balance);

  const byFundingKind = fundingRows.map((row) => {
    const kindDeposits = numberOf(row.deposits);
    const kindWithdrawals = numberOf(row.withdrawals);
    return {
      fundingKind: row.fundingKind,
      deposits: kindDeposits,
      withdrawals: kindWithdrawals,
      balance: partnerBalanceOf(kindDeposits, kindWithdrawals),
    };
  });

  const capitalBalance = byFundingKind.reduce((sum, row) => sum + row.balance, 0);

  // --- Purchases ----------------------------------------------------------------------------
  /*
   * The purchase orders behind the "Supplier purchases" expense heading. `total` is what the
   * period's orders committed to suppliers; it is deliberately NOT added to `expenses`, because
   * every order already posted its own expense row and adding both would count the same money
   * twice.
   *
   * One order can match more than one finance entry (an operator may have typed an expense with
   * the PO number as its reference), so rows are folded by order id, preferring a posted entry.
   * `unrecordedCount` calls out orders with no posted expense - those created before purchase
   * orders posted to Finance, or whose entry was voided - so the owner can see why the purchase
   * total and the expense heading can differ.
   */
  const purchaseOrderList: Array<{
    id: number;
    orderNumber: string;
    orderDate: string;
    status: string;
    supplier: string;
    amount: number;
    expense: { entryNumber: string; status: string | null } | null;
  }> = [];
  const purchaseIndexById = new Map<number, number>();

  for (const row of purchaseOrderRows) {
    const expense =
      row.expenseEntryNumber !== null
        ? { entryNumber: row.expenseEntryNumber, status: row.expenseStatus }
        : null;
    const existingIndex = purchaseIndexById.get(row.id);

    if (existingIndex === undefined) {
      purchaseIndexById.set(row.id, purchaseOrderList.length);
      purchaseOrderList.push({
        id: row.id,
        orderNumber: row.orderNumber,
        orderDate: row.orderDate.toISOString(),
        status: row.status,
        supplier: row.supplierName,
        amount: numberOf(row.totalAmount),
        expense,
      });
    } else if (
      expense?.status === "posted" &&
      purchaseOrderList[existingIndex].expense?.status !== "posted"
    ) {
      purchaseOrderList[existingIndex].expense = expense;
    }
  }

  const purchasesTotal = purchaseOrderList.reduce((sum, row) => sum + row.amount, 0);
  const recordedPurchasesTotal = purchaseOrderList
    .filter((row) => row.expense?.status === "posted")
    .reduce((sum, row) => sum + row.amount, 0);

  return {
    from,
    to,
    income: {
      receipts,
      receiptsCount: Number(receiptRows[0]?.count ?? 0),
      otherIncome,
      total: totalIncome,
      byCategory: [
        ...(receipts > 0
          ? [{ category: "Customer receipts", amount: receipts, automatic: true }]
          : []),
        ...Array.from(incomeByCategory.entries()).map(([category, amount]) => ({
          category,
          amount,
          automatic: false,
        })),
      ].sort((a, b) => b.amount - a.amount),
    },
    expenses: {
      total: expenseTotal,
      count: expenseCount,
      byCategory: Array.from(expenseByCategory.entries())
        .map(([category, value]) => ({ category, amount: value.amount, count: value.count }))
        .sort((a, b) => b.amount - a.amount),
    },
    purchases: {
      total: purchasesTotal,
      count: purchaseOrderList.length,
      recordedTotal: recordedPurchasesTotal,
      unrecordedCount: purchaseOrderList.filter((row) => row.expense?.status !== "posted").length,
      rows: purchaseOrderList,
    },
    netProfit,
    cashPosition: totalIncome + deposits - expenseTotal - withdrawals,
    capital: {
      deposits,
      withdrawals,
      net: deposits - withdrawals,
      balance: capitalBalance,
      byPartner,
      byFundingKind,
    },
    receivables: {
      totalOutstanding,
      invoiceCount: outstandingRows.length,
      partiallyPaidAmount,
      partiallyPaidCount: counts.partially_paid,
      unpaidAmount: totalOutstanding - partiallyPaidAmount,
      unpaidCount: counts.issued,
      overdueAmount,
      overdueCount: counts.overdue,
      aging,
    },
    generatedAt: new Date().toISOString(),
  };
}



