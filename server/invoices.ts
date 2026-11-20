import { db } from "@db";
import {
  invoicePayments,
  invoices,
  salesOrders,
  salesTransactions,
} from "@db/schema";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { DbClient } from "./db-types";
import { generateReceiptNumber } from "./receipt-counter";
import { computeSaleTotals, toVatRate } from "../shared/tax";
import { endOfVietnamDay, startOfVietnamDay } from "../shared/vietnam-day";
import {
  AGING_BUCKETS,
  DEFAULT_PAYMENT_TERM_DAYS,
  agingBucketOf,
  balanceOf,
  computeStoredStatus,
  daysPastDue,
  displayInvoiceStatus,
  invoiceStatusLabel,
  type InvoiceKind,
  type InvoiceSource,
  type InvoiceStatus,
} from "../shared/invoice-payment";

/**
 * The receivables service.
 *
 * AI Agent Note - what this module does and does NOT do:
 *
 *  - It registers ONE `invoices` row per completed sale / issued sales order. The row is a
 *    snapshot: `subtotal` / `vat_rate` / `vat_amount` / `total_amount` are copied from the
 *    source document and never recomputed. Do not "fix" them from the catalogue or from the
 *    company's current rate - that would rewrite an issued document.
 *  - It keeps `amount_paid` / `balance_due` / `status` in step with `invoice_payments`. Every
 *    write goes through `refreshInvoiceBalance`, which locks the invoice row
 *    (`SELECT ... FOR UPDATE`) so two cashiers taking money at the same moment cannot both see
 *    the old balance.
 *  - It never deletes an invoice or a payment. Money corrections are voids and cancellations,
 *    both of which keep who/when/why.
 */

export class InvoiceError extends Error {
  status: number;
  suggestion?: string;

  constructor(message: string, status = 400, suggestion?: string) {
    super(message);
    this.name = 'InvoiceError';
    this.status = status;
    this.suggestion = suggestion;
  }
}

/** `2026-03-12` (the format `date` columns read/write) for a date offset by `days`. */
export function isoDateOffset(from: Date, days: number): string {
  const date = new Date(from.getTime());
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface RegisterInvoiceInput {
  invoiceNumber: string;
  kind: InvoiceKind;
  source: InvoiceSource;
  salesTransactionId?: number | null;
  salesOrderId?: number | null;
  vatCompanyId?: number | null;
  customerProfileId?: number | null;
  buyerName?: string | null;
  storeId?: number | null;
  issuedAt?: Date;
  /** Days of credit. `0` means "due on issue" (a counter sale). */
  paymentTermDays?: number;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
}

/**
 * Write the invoice row for a document. Pure bookkeeping - no payments.
 *
 * The caller must already hold a transaction; that is what makes "sale + invoice" (or
 * "order invoice + invoice") a single atomic unit, so a document can never exist without its
 * receivable and a receivable can never exist without a document.
 */
export async function registerInvoice(
  tx: DbClient,
  input: RegisterInvoiceInput,
  options: { onConflictDoNothing?: boolean } = {}
) {
  const issuedAt = input.issuedAt ?? new Date();
  const termDays = input.paymentTermDays ?? DEFAULT_PAYMENT_TERM_DAYS;

  const values = {
    invoiceNumber: input.invoiceNumber,
    kind: input.kind,
    source: input.source,
    salesTransactionId: input.salesTransactionId ?? null,
    salesOrderId: input.salesOrderId ?? null,
    vatCompanyId: input.vatCompanyId ?? null,
    customerProfileId: input.customerProfileId ?? null,
    buyerName: (input.buyerName ?? '').trim(),
    storeId: input.storeId ?? null,
    issuedAt,
    dueDate: isoDateOffset(issuedAt, Math.max(0, Math.trunc(termDays))),
    currency: 'VND',
    subtotal: input.subtotal.toFixed(2),
    vatRate: input.vatRate.toString(),
    vatAmount: input.vatAmount.toFixed(2),
    totalAmount: input.totalAmount.toFixed(2),
    amountPaid: '0.00',
    balanceDue: input.totalAmount.toFixed(2),
    status: computeStoredStatus({
      cancelled: false,
      totalAmount: input.totalAmount,
      amountPaid: 0,
    }),
    statusUpdatedAt: issuedAt,
  };

  const insert = tx.insert(invoices).values(values);
  const [row] = options.onConflictDoNothing
    ? await insert.onConflictDoNothing().returning()
    : await insert.returning();

  return row ?? null;
}

/**
 * Recompute `amount_paid` / `balance_due` / `status` from the receipts and store them.
 *
 * The `SELECT ... FOR UPDATE` is the concurrency guard: two payments for the same invoice
 * serialize here, so the second one sees the first one's balance (and is refused if it no
 * longer fits). The invoice VALUE is read only to compute the balance - it is never written.
 */
export async function refreshInvoiceBalance(tx: DbClient, invoiceId: number) {
  const locked = await tx.execute(sql`
    SELECT id, total_amount, status FROM invoices WHERE id = ${invoiceId} FOR UPDATE
  `);
  const lockedRow = (locked as unknown as Array<{ id: number; total_amount: string; status: string }>)[0];

  if (!lockedRow) {
    throw new InvoiceError('Invoice not found', 404, 'Reload the receivables list');
  }

  const [sum] = await tx
    .select({ paid: sql<string>`COALESCE(SUM(${invoicePayments.amount}), 0)` })
    .from(invoicePayments)
    .where(and(eq(invoicePayments.invoiceId, invoiceId), isNull(invoicePayments.voidedAt)));

  const total = Number(lockedRow.total_amount);
  const paid = Math.round(Number(sum?.paid ?? 0));
  const status = computeStoredStatus({
    cancelled: lockedRow.status === 'cancelled',
    totalAmount: total,
    amountPaid: paid,
  });

  const now = new Date();
  const [updated] = await tx
    .update(invoices)
    .set({
      amountPaid: paid.toFixed(2),
      balanceDue: balanceOf(total, paid).toFixed(2),
      status,
      statusUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(invoices.id, invoiceId))
    .returning();

  return updated;
}

/** Insert one receipt row. Shared by the POS checkout and the payments service. */
export async function insertInvoicePayment(
  tx: DbClient,
  input: {
    invoiceId: number;
    amount: number;
    paymentMethod: string;
    paidAt?: Date;
    reference?: string | null;
    notes?: string | null;
    receivedByUserId: number;
    storeId?: number | null;
  }
) {
  // One company-wide sequence: the number is printed and unique across `invoice_payments`,
  // so it cannot depend on which store (or no store at all) took the money.
  const receiptNumber = await generateReceiptNumber(tx);
  const [payment] = await tx
    .insert(invoicePayments)
    .values({
      invoiceId: input.invoiceId,
      receiptNumber,
      amount: input.amount.toFixed(2),
      paymentMethod: input.paymentMethod.trim().toUpperCase().slice(0, 20),
      paidAt: input.paidAt ?? new Date(),
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      receivedByUserId: input.receivedByUserId,
      storeId: input.storeId ?? null,
    })
    .returning();

  return payment;
}

export interface RegisterPosSaleInvoiceInput extends RegisterInvoiceInput {
  /** Money handed over at the counter. Omitted = the sale is fully paid. */
  amountPaidNow?: number;
  paymentMethod: string;
  userId: number;
}

/**
 * Register the receivable of a POS sale, plus the receipt for the money taken at the till.
 *
 * AI Agent Note: the sale itself is always worth `totalAmount`; `amountPaidNow` only decides
 * whether the invoice is issued unpaid, partly paid or paid. A shop that lets a regular
 * customer take the goods and pay later passes 0 and the invoice lands in the receivables list.
 */
export async function registerPosSaleInvoice(tx: DbClient, input: RegisterPosSaleInvoiceInput) {
  const invoice = await registerInvoice(tx, input);
  if (!invoice) {
    throw new InvoiceError('The invoice for this sale already exists', 409);
  }

  const paidNow = Math.round(input.amountPaidNow ?? input.totalAmount);
  if (paidNow < 0) {
    throw new InvoiceError(
      'The amount paid cannot be negative',
      400,
      'Leave it empty when the sale is paid in full'
    );
  }
  if (paidNow > input.totalAmount) {
    throw new InvoiceError(
      'The amount paid exceeds the value of the sale',
      400,
      'A sale of this value cannot receive more money than it is worth'
    );
  }
  if (paidNow > 0) {
    await insertInvoicePayment(tx, {
      invoiceId: invoice.id,
      amount: paidNow,
      paymentMethod: input.paymentMethod,
      paidAt: invoice.issuedAt ?? undefined,
      receivedByUserId: input.userId,
      storeId: input.storeId ?? null,
    });
    return refreshInvoiceBalance(tx, invoice.id);
  }

  return invoice;
}

/**
 * Make sure the VAT invoice of a sales order has its receivable row.
 *
 * Called inside `issueSalesOrderInvoice`'s transaction. The order already stores the issuing
 * company's snapshot and the ordered amounts, so the invoice is copied from those - never from
 * the company's current profile or the product catalogue.
 *
 * Idempotent: issuing twice returns the existing row (the unique index makes a duplicate
 * impossible even under two concurrent requests).
 */
export async function ensureSalesOrderInvoiceRegistered(tx: DbClient, orderId: number) {
  const existing = await tx.query.invoices.findFirst({
    where: eq(invoices.salesOrderId, orderId),
  });
  if (existing) return existing;

  const order = await tx.query.salesOrders.findFirst({ where: eq(salesOrders.id, orderId) });
  if (!order) {
    throw new InvoiceError('Sales order not found', 404);
  }
  if (!order.vatInvoiceNumber) {
    throw new InvoiceError(
      'The sales order has no invoice number yet',
      409,
      'Issue the invoice from the order first - the number comes from the VAT company’s sequence'
    );
  }

  // The order stores a VAT-exclusive total and the rate that was snapshotted when it was saved
  // (see server/sales-order-invoices.ts). Adding VAT here is the same rule as issuing it.
  const subtotal = Number(order.totalAmount);
  const totals = computeSaleTotals(subtotal, true, toVatRate(order.vatRate));

  const invoice = await registerInvoice(tx, {
    invoiceNumber: order.vatInvoiceNumber,
    kind: 'VAT',
    source: 'SALES_ORDER',
    salesOrderId: order.id,
    vatCompanyId: order.vatCompanyId,
    customerProfileId: order.customerProfileId,
    buyerName: order.companyName?.trim() || order.customerName,
    storeId: null,
    issuedAt: order.vatInvoiceIssuedAt ?? new Date(),
    paymentTermDays: DEFAULT_PAYMENT_TERM_DAYS,
    subtotal: totals.subtotal,
    vatRate: totals.vatRate,
    vatAmount: totals.vatAmount,
    totalAmount: totals.total,
  }, { onConflictDoNothing: true });

  return invoice ?? (await tx.query.invoices.findFirst({
    where: eq(invoices.salesOrderId, orderId),
  }))!;
}

export interface ListInvoicesFilters {
  /** issued | partially_paid | paid | cancelled | overdue | outstanding */
  status?: string;
  kind?: string;
  source?: string;
  customerProfileId?: number;
  /** null = every store (global scope). */
  storeIds?: number[] | null;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  today?: Date;
}

type InvoiceWithRelations = typeof invoices.$inferSelect & {
  payments?: Array<typeof invoicePayments.$inferSelect & {
    receivedByUser?: { id: number; username: string } | null;
  }>;
};

/** Shape handed to the browser: decimals become numbers, status becomes what a human sees. */
export function toInvoiceApiRow(invoice: InvoiceWithRelations, today: Date = new Date()) {
  const totalAmount = Number(invoice.totalAmount);
  const amountPaid = Number(invoice.amountPaid);
  const balanceDue = balanceOf(totalAmount, amountPaid);
  const status = displayInvoiceStatus(
    { status: invoice.status, balanceDue, dueDate: invoice.dueDate },
    today
  );

  return {
    ...invoice,
    subtotal: Number(invoice.subtotal),
    vatAmount: Number(invoice.vatAmount),
    vatRate: Number(invoice.vatRate),
    totalAmount,
    amountPaid,
    balanceDue,
    status,
    storedStatus: invoice.status,
    statusLabel: invoiceStatusLabel(status),
    daysPastDue: daysPastDue(invoice.dueDate, today),
    agingBucket:
      balanceDue > 0 && invoice.status !== 'cancelled'
        ? agingBucketOf(invoice.dueDate, today).key
        : null,
    payments: (invoice.payments ?? []).map((payment) => ({
      ...payment,
      amount: Number(payment.amount),
      voided: Boolean(payment.voidedAt),
    })),
  };
}

function invoiceWhere(filters: ListInvoicesFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.storeIds !== null && filters.storeIds !== undefined) {
    // A sales order invoice has no store (`store_id` is NULL) because it is a company document
    // shipped from whichever warehouse had stock - sales orders are not store-scoped either.
    // Scoped staff therefore see storeless invoices alongside their own stores' till invoices.
    conditions.push(
      filters.storeIds.length === 0
        ? sql`${invoices.storeId} IS NULL`
        : (or(inArray(invoices.storeId, filters.storeIds), isNull(invoices.storeId)) as SQL)
    );
  }
  if (filters.kind) conditions.push(eq(invoices.kind, filters.kind));
  if (filters.source) conditions.push(eq(invoices.source, filters.source));
  if (filters.customerProfileId) {
    conditions.push(eq(invoices.customerProfileId, filters.customerProfileId));
  }
  if (filters.from) conditions.push(gte(invoices.issuedAt, startOfVietnamDay(filters.from.slice(0, 10))));
  if (filters.to) {
    // Vietnamese day, not UTC: an invoice issued at 06:30 local is stored as 23:30 UTC the day
    // before, and belongs to the local day on every report and printed sheet.
    conditions.push(lte(invoices.issuedAt, endOfVietnamDay(filters.to.slice(0, 10))));
  }
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        sql`${invoices.invoiceNumber} ILIKE ${term}`,
        sql`${invoices.buyerName} ILIKE ${term}`,
        sql`CAST(${invoices.id} AS TEXT) = ${filters.search.trim()}`
      ) as SQL
    );
  }

  // 'outstanding' and 'overdue' are derived, so they cannot be plain equality on the stored
  // column: they mean "still owes money" (plus a past due date, for overdue).
  if (filters.status === 'outstanding') {
    conditions.push(sql`${invoices.status} IN ('issued', 'partially_paid')`);
    conditions.push(sql`${invoices.balanceDue} > 0`);
  } else if (filters.status === 'overdue') {
    conditions.push(sql`${invoices.status} IN ('issued', 'partially_paid')`);
    conditions.push(sql`${invoices.balanceDue} > 0`);
    conditions.push(sql`${invoices.dueDate} < CURRENT_DATE`);
  } else if (filters.status) {
    conditions.push(eq(invoices.status, filters.status));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * The receivables report: the matching invoices plus the totals and aging buckets shown above
 * the table. Summary and aging cover EVERY matching invoice, not just the current page - a
 * totals row that changes when you paginate would be wrong.
 */
export async function listInvoices(filters: ListInvoicesFilters = {}) {
  const today = filters.today ?? new Date();
  const where = invoiceWhere(filters);
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const [rows, summaryRows] = await Promise.all([
    db.query.invoices.findMany({
      where,
      with: {
        payments: { with: { receivedByUser: { columns: { id: true, username: true } } } },
        salesTransaction: {
          columns: { id: true, invoiceNumber: true, status: true, transactionDate: true },
        },
        salesOrder: { columns: { id: true, orderNumber: true, status: true } },
        customerProfile: { columns: { id: true, companyName: true, contactPerson: true } },
      },
      orderBy: [desc(invoices.issuedAt), desc(invoices.id)],
      limit,
      offset,
    }),
    db
      .select({
        status: invoices.status,
        totalAmount: invoices.totalAmount,
        amountPaid: invoices.amountPaid,
        dueDate: invoices.dueDate,
      })
      .from(invoices)
      .where(where),
  ]);

  const counts: Record<InvoiceStatus, number> = {
    issued: 0,
    partially_paid: 0,
    paid: 0,
    overdue: 0,
    cancelled: 0,
  };
  const summary = {
    invoiceCount: summaryRows.length,
    totalInvoiced: 0,
    totalPaid: 0,
    totalOutstanding: 0,
    overdueAmount: 0,
    counts,
  };
  const aging = new Map(AGING_BUCKETS.map((bucket) => [
    bucket.key,
    { key: bucket.key, label: bucket.label, amount: 0, count: 0 },
  ]));

  for (const row of summaryRows) {
    const total = Number(row.totalAmount);
    const paid = Number(row.amountPaid);
    const balance = balanceOf(total, paid);
    const status = displayInvoiceStatus(
      { status: row.status, balanceDue: balance, dueDate: row.dueDate },
      today
    );

    summary.totalInvoiced += total;
    summary.totalPaid += paid;
    counts[status] += 1;

    if (status === 'cancelled') continue;
    summary.totalOutstanding += balance;
    if (status === 'overdue') summary.overdueAmount += balance;

    if (balance > 0) {
      const bucket = aging.get(agingBucketOf(row.dueDate, today).key)!;
      bucket.amount += balance;
      bucket.count += 1;
    }
  }

  return {
    invoices: rows.map((row) => toInvoiceApiRow(row as InvoiceWithRelations, today)),
    total: summaryRows.length,
    limit,
    offset,
    summary,
    aging: Array.from(aging.values()),
    today: today.toISOString(),
  };
}

/** One invoice with its receipts - what the detail drawer and the printed receipt read. */
export async function getInvoice(invoiceId: number) {
  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, invoiceId),
    with: {
      payments: {
        with: { receivedByUser: { columns: { id: true, username: true } } },
        orderBy: [asc(invoicePayments.paidAt), asc(invoicePayments.id)],
      },
      salesTransaction: true,
      salesOrder: true,
      customerProfile: true,
      vatCompany: true,
      store: true,
    },
  });

  if (!invoice) {
    throw new InvoiceError('Invoice not found', 404, 'Reload the receivables list');
  }

  return toInvoiceApiRow(invoice as InvoiceWithRelations);
}

export interface CancelInvoiceInput {
  invoiceId: number;
  userId: number;
  reason?: string;
  /**
   * Also void the receipts. Set when the money is coming back (refund of the sale); the manual
   * cancel endpoint leaves this false and refuses while receipts exist, because a cancellation
   * is not a refund.
   */
  voidPayments?: boolean;
}

/**
 * Cancel an invoice: refuse to delete it.
 *
 * AI Agent Note: a cancelled invoice keeps its value, its receipts and its reason. Deleting or
 * emptying it would destroy the audit trail of a document the customer may still hold.
 */
export async function cancelInvoice(input: CancelInvoiceInput, executor?: DbClient) {
  const run = async (tx: DbClient) => {
    const lockedRows = (await tx.execute(sql`
      SELECT id, amount_paid, status FROM invoices WHERE id = ${input.invoiceId} FOR UPDATE
    `)) as unknown as Array<{ id: number; amount_paid: string; status: string }>;

    if (lockedRows.length === 0) {
      throw new InvoiceError('Invoice not found', 404, 'Reload the receivables list');
    }
    if (lockedRows[0].status === 'cancelled') return;

    const amountPaid = Number(lockedRows[0].amount_paid);
    if (amountPaid > 0 && !input.voidPayments) {
      throw new InvoiceError(
        'This invoice already has payment receipts recorded',
        409,
        'Void the receipts (a refund) before cancelling the invoice'
      );
    }

    if (amountPaid > 0) {
      const now = new Date();
      await tx
        .update(invoicePayments)
        .set({
          voidedAt: now,
          voidedByUserId: input.userId,
          voidReason: input.reason?.trim() || 'Invoice cancelled',
        })
        .where(
          and(eq(invoicePayments.invoiceId, input.invoiceId), isNull(invoicePayments.voidedAt))
        );
    }

    // Recompute first so amount_paid/balance_due reflect the voided receipts, then stamp.
    await refreshInvoiceBalance(tx, input.invoiceId);

    const now = new Date();
    await tx
      .update(invoices)
      .set({
        status: 'cancelled',
        statusUpdatedAt: now,
        cancelledAt: now,
        cancelledByUserId: input.userId,
        cancelReason: input.reason?.trim() || null,
        updatedAt: now,
      })
      .where(eq(invoices.id, input.invoiceId));
  };

  if (executor) {
    await run(executor);
    // The caller owns the transaction; reading the invoice here would hit a second
    // connection and see the pre-cancellation row.
    return null;
  }

  await db.transaction(run);
  return getInvoice(input.invoiceId);
}

/**
 * Cancel the invoice that belongs to a refunded/voided sale, inside the caller's transaction.
 *
 * Called from the sale refund path (server/sales.ts). The money is handed back there, so the
 * receipts are voided with the invoice - unlike the manual endpoint, which refuses.
 */
export async function cancelInvoiceForSale(
  tx: DbClient,
  input: { salesTransactionId?: number; salesOrderId?: number; userId: number; reason: string }
) {
  const invoice = await tx.query.invoices.findFirst({
    where: input.salesTransactionId
      ? eq(invoices.salesTransactionId, input.salesTransactionId)
      : eq(invoices.salesOrderId, input.salesOrderId!),
  });
  if (!invoice || invoice.status === 'cancelled') return invoice ?? null;

  await cancelInvoice(
    {
      invoiceId: invoice.id,
      userId: input.userId,
      reason: input.reason,
      voidPayments: true,
    },
    tx
  );

  return invoice;
}

/**
 * Backfill the receivables register for sales made before `invoices` existed.
 *
 * Every historical POS sale becomes one invoice marked as settled by one receipt, dated with
 * the sale - that is what "historical sales were all paid at the counter" means in this shop.
 * Refunded and voided sales become cancelled invoices with no receipt.
 *
 * Sales Orders that already carry a VAT invoice number are registered too, from the number and
 * totals stored on the order; they were issued before this register existed, so they start
 * `issued` with the full balance outstanding (no receipt is invented for them).
 *
 * Idempotent by construction: the query only returns sales that have no invoice row, and the
 * unique index on `sales_transaction_id` refuses a duplicate if two runs overlap.
 */
export async function backfillInvoices(options: { dryRun?: boolean } = {}) {
  const PAGE = 200;
  let lastId = 0;
  let created = 0;
  let receipts = 0;
  let cancelled = 0;
  // Counted separately so the preview shows which side produced the rows (counter sales vs
  // invoices already issued on a Sales Order).
  let orderInvoices = 0;

  for (;;) {
    const batch = await db
      .select({
        id: salesTransactions.id,
        invoiceNumber: salesTransactions.invoiceNumber,
        storeId: salesTransactions.storeId,
        cashierUserId: salesTransactions.cashierUserId,
        customerProfileId: salesTransactions.customerProfileId,
        subtotal: salesTransactions.subtotal,
        vatRate: salesTransactions.vatRate,
        vatAmount: salesTransactions.vatAmount,
        totalAmount: salesTransactions.totalAmount,
        printedWithVat: salesTransactions.printedWithVat,
        vatCompanyId: salesTransactions.vatCompanyId,
        buyerName: salesTransactions.buyerName,
        buyerCompanyName: salesTransactions.buyerCompanyName,
        paymentMethod: salesTransactions.paymentMethod,
        transactionDate: salesTransactions.transactionDate,
        createdAt: salesTransactions.createdAt,
        status: salesTransactions.status,
      })
      .from(salesTransactions)
      .where(
        and(
          sql`${salesTransactions.id} > ${lastId}`,
          sql`NOT EXISTS (
            SELECT 1 FROM invoices i WHERE i.sales_transaction_id = ${salesTransactions.id}
          )`
        )
      )
      .orderBy(asc(salesTransactions.id))
      .limit(PAGE);

    if (batch.length === 0) break;
    lastId = batch[batch.length - 1].id;

    for (const sale of batch) {
      if (options.dryRun) {
        created += 1;
        continue;
      }

      const issuedAt = sale.transactionDate ?? sale.createdAt ?? new Date();
      const isCancelled = sale.status !== 'completed';

      await db.transaction(async (tx) => {
        const invoice = await registerInvoice(
          tx,
          {
            invoiceNumber: sale.invoiceNumber,
            // A VAT invoice was printed only if the sale was flagged AND it carries a company.
            kind: sale.printedWithVat && sale.vatCompanyId ? 'VAT' : 'RETAIL',
            source: 'POS_SALE',
            salesTransactionId: sale.id,
            vatCompanyId: sale.vatCompanyId,
            customerProfileId: sale.customerProfileId,
            buyerName: sale.buyerCompanyName?.trim() || sale.buyerName,
            storeId: sale.storeId,
            issuedAt,
            paymentTermDays: 0,
            subtotal: Number(sale.subtotal),
            vatRate: Number(sale.vatRate),
            vatAmount: Number(sale.vatAmount),
            totalAmount: Number(sale.totalAmount),
          },
          { onConflictDoNothing: true }
        );

        if (!invoice) return;

        if (isCancelled) {
          const now = new Date();
          await tx
            .update(invoices)
            .set({
              status: 'cancelled',
              statusUpdatedAt: now,
              cancelledAt: now,
              cancelReason: `Sale ${sale.status}`,
              updatedAt: now,
            })
            .where(eq(invoices.id, invoice.id));
          cancelled += 1;
          return;
        }

        await insertInvoicePayment(tx, {
          invoiceId: invoice.id,
          amount: Number(sale.totalAmount),
          paymentMethod: sale.paymentMethod,
          paidAt: issuedAt,
          notes: 'Backfilled: settled at the time of sale',
          receivedByUserId: sale.cashierUserId,
          storeId: sale.storeId,
        });
        await refreshInvoiceBalance(tx, invoice.id);
        receipts += 1;
      });

      created += 1;
    }

    if (batch.length < PAGE) break;
  }

  // Second pass: VAT invoices already issued for Sales Orders. The number lives on the order
  // (`sales_orders.vat_invoice_number`), so nothing is allocated here - the receivable is
  // registered from the stored order, with the delivery term applied. An order that has since
  // been cancelled gets a cancelled invoice, exactly like a refunded sale above.
  lastId = 0;
  for (;;) {
    const orders = await db
      .select({
        id: salesOrders.id,
        status: salesOrders.status,
      })
      .from(salesOrders)
      .where(
        and(
          sql`${salesOrders.id} > ${lastId}`,
          sql`${salesOrders.vatInvoiceNumber} IS NOT NULL`,
          sql`NOT EXISTS (
            SELECT 1 FROM invoices i WHERE i.sales_order_id = ${salesOrders.id}
          )`
        )
      )
      .orderBy(asc(salesOrders.id))
      .limit(PAGE);

    if (orders.length === 0) break;
    lastId = orders[orders.length - 1].id;

    for (const order of orders) {
      if (options.dryRun) {
        created += 1;
        orderInvoices += 1;
        continue;
      }

      await db.transaction(async (tx) => {
        const invoice = await ensureSalesOrderInvoiceRegistered(tx, order.id);
        if (!invoice) return;

        if (order.status === 'cancelled' && invoice.status !== 'cancelled') {
          const now = new Date();
          await tx
            .update(invoices)
            .set({
              status: 'cancelled',
              statusUpdatedAt: now,
              cancelledAt: now,
              cancelReason: `Sales order ${order.status}`,
              updatedAt: now,
            })
            .where(eq(invoices.id, invoice.id));
        }

        orderInvoices += 1;
      });

      created += 1;
    }

    if (orders.length < PAGE) break;
  }

  return { created, receipts, cancelled, orderInvoices, dryRun: Boolean(options.dryRun) };
}

