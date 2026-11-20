import { db } from "@db";
import {
  invoicePayments,
  invoices,
  salesOrders,
  stores,
  users,
  vatCompanies,
} from "@db/schema";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { InvoiceError, getInvoice, insertInvoicePayment, refreshInvoiceBalance } from "./invoices";
import { canAcceptPayment, validatePaymentAmount } from "../shared/invoice-payment";
import type { DbClient } from "./db-types";

/**
 * Recording and voiding payment receipts.
 *
 * AI Agent Note - the two rules this module exists to enforce:
 *
 *  1. A receipt may never exceed what is still owed, and it is written with the invoice row
 *     locked (`lockInvoice` does `SELECT ... FOR UPDATE`). Two cashiers pressing "record
 *     payment" on the last 2,000,000 therefore cannot both succeed.
 *  2. Nothing is updated or deleted after the fact. A wrong receipt is VOIDED - the row stays,
 *     with who/when/why - and the invoice balance is recomputed from the receipts that remain.
 *
 * The invoice VALUE (`total_amount`, `vat_amount`, `subtotal`) is never touched here: paying a
 * document does not change what the document says.
 */

export interface RecordPaymentInput {
  invoiceId: number;
  /** Raw input, so "1,500,000" from a text box is validated here rather than trusted. */
  amount: string | number;
  paymentMethod: string;
  paidAt?: Date | string | null;
  reference?: string | null;
  notes?: string | null;
  userId: number;
  storeId?: number | null;
}

export async function recordPayment(input: RecordPaymentInput) {
  return db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, input.invoiceId);

    const state = canAcceptPayment({
      status: invoice.status,
      totalAmount: invoice.totalAmount,
      amountPaid: invoice.amountPaid,
      balanceDue: invoice.balanceDue,
    });
    if (!state.allowed) {
      throw new InvoiceError(state.reason ?? 'This invoice cannot take a payment', 409);
    }

    const validation = validatePaymentAmount(input.amount, invoice.balanceDue);
    if (!validation.valid) {
      throw new InvoiceError(validation.error!, 400, validation.suggestion);
    }

    const payment = await insertInvoicePayment(tx, {
      invoiceId: invoice.id,
      amount: validation.amount,
      paymentMethod: input.paymentMethod,
      paidAt: parsePaidAt(input.paidAt),
      reference: input.reference,
      notes: input.notes,
      receivedByUserId: input.userId,
      // The receipt belongs to the shop that took the money, not to the invoice's store - a
      // head-office customer may settle their order at any branch.
      storeId: input.storeId ?? invoice.storeId ?? null,
    });

    const updated = await refreshInvoiceBalance(tx, invoice.id);

    return { payment: { ...payment, amount: Number(payment.amount) }, invoice: updated };
  });
}

export interface VoidPaymentInput {
  paymentId: number;
  userId: number;
  reason: string;
}

/**
 * Void a receipt (money was returned, or it was recorded against the wrong invoice).
 *
 * The row is kept and stamped, never deleted; the invoice's balance goes back up, which can
 * turn a `paid` invoice into `partially_paid` or `issued` again. An already-voided receipt is
 * refused instead of silently voided twice.
 */
export async function voidPayment(input: VoidPaymentInput) {
  const reason = input.reason?.trim();
  if (!reason) {
    throw new InvoiceError(
      'A reason is required to void a receipt',
      400,
      'Say what happened, e.g. "wrong invoice" or "customer refunded"'
    );
  }

  return db.transaction(async (tx) => {
    const payment = await tx.query.invoicePayments.findFirst({
      where: eq(invoicePayments.id, input.paymentId),
    });
    if (!payment) {
      throw new InvoiceError('Receipt not found', 404, 'Reload the invoice');
    }
    if (payment.voidedAt) {
      throw new InvoiceError('This receipt is already voided', 409);
    }

    const invoice = await lockInvoice(tx, payment.invoiceId);
    if (invoice.status === 'cancelled') {
      throw new InvoiceError('The invoice is cancelled; its receipts cannot be changed', 409);
    }

    const [voided] = await tx
      .update(invoicePayments)
      .set({ voidedAt: new Date(), voidedByUserId: input.userId, voidReason: reason })
      .where(and(eq(invoicePayments.id, input.paymentId), isNull(invoicePayments.voidedAt)))
      .returning();

    if (!voided) {
      throw new InvoiceError('This receipt is already voided', 409);
    }

    const updated = await refreshInvoiceBalance(tx, payment.invoiceId);
    return { payment: { ...voided, amount: Number(voided.amount) }, invoice: updated };
  });
}

/** One receipt with the invoice and buyer it belongs to (the printable receipt document). */
export async function getPayment(paymentId: number) {
  const payment = await db.query.invoicePayments.findFirst({
    where: eq(invoicePayments.id, paymentId),
    with: {
      receivedByUser: { columns: { id: true, username: true } },
      invoice: {
        with: {
          salesTransaction: true,
          salesOrder: true,
          customerProfile: true,
          vatCompany: true,
          store: true,
        },
      },
    },
  });

  if (!payment) {
    throw new InvoiceError('Receipt not found', 404, 'Reload the invoice');
  }

  return { ...payment, amount: Number(payment.amount), voided: Boolean(payment.voidedAt) };
}

/** Receipts of one invoice, oldest first - the "payments" tab of the invoice drawer. */
export async function listInvoicePayments(invoiceId: number) {
  const invoice = await getInvoice(invoiceId);
  return invoice.payments;
}

/**
 * The customer-receipt register: every `RCPT-` document, newest first.
 *
 * AI Agent Note - this is the OTHER half of the Receipts page. `GET /api/sales-transactions`
 * lists till SALES (`DC-/STR…` numbers, printed under the shop letterhead); this lists the money
 * a customer PAID against an invoice (`RCPT-…` numbers, printed under the letterhead of the VAT
 * company that issued the invoice). Two registers, two counters - they are not supposed to share
 * numbers, and nothing here may try to reconcile the two sequences.
 *
 * Store visibility follows the INVOICE, exactly like `GET /api/invoices/:id`: a sales-order
 * invoice has no store, so its receipts stay visible to every user holding the permission.
 */
export interface ListReceiptsFilters {
  /** `active` hides voided receipts; `voided` shows only those. Omit for the whole trail. */
  status?: "active" | "voided";
  method?: string;
  search?: string;
  from?: string;
  to?: string;
  /** null = every store (global scope); [] = storeless (sales order) invoices only. */
  storeIds?: number[] | null;
  limit?: number;
  offset?: number;
}

/** Shape handed to the browser for one `RCPT-` document. */
export interface CustomerReceiptRow {
  id: number;
  receiptNumber: string;
  amount: number;
  paymentMethod: string;
  paidAt: Date;
  reference: string | null;
  notes: string | null;
  voided: boolean;
  voidedAt: Date | null;
  voidReason: string | null;
  receivedBy: { id: number; username: string } | null;
  store: { id: number; name: string } | null;
  /**
   * The invoice's ACTIVE receipts before this one, and the balance left after it. Both are
   * windows over the receipts, so a reprint years later still shows the instalment it was -
   * not today's balance.
   */
  paidBefore: number;
  balanceAfter: number;
  invoice: {
    id: number;
    invoiceNumber: string;
    source: string;
    kind: string;
    status: string;
    buyerName: string;
    issuedAt: Date;
    dueDate: string | null;
    subtotal: number;
    vatRate: number;
    vatAmount: number;
    totalAmount: number;
    amountPaid: number;
    balanceDue: number;
    orderNumber: string | null;
    /** The issuer of the invoice; null for a till sale printed under the shop letterhead. */
    vatCompany: {
      id: number;
      code: string;
      name: string;
      taxId: string;
      address: string;
    } | null;
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function receiptWhere(filters: ListReceiptsFilters) {
  const conditions = [];

  // Same rule as the invoices list: a storeless (sales order) invoice is company business and
  // is visible to every scope, a till invoice is only visible inside its own store.
  if (filters.storeIds !== null && filters.storeIds !== undefined) {
    conditions.push(
      filters.storeIds.length === 0
        ? sql`${invoices.storeId} IS NULL`
        : or(inArray(invoices.storeId, filters.storeIds), isNull(invoices.storeId))
    );
  }
  if (filters.status === "active") {
    conditions.push(sql`${invoicePayments.voidedAt} IS NULL`);
  } else if (filters.status === "voided") {
    conditions.push(sql`${invoicePayments.voidedAt} IS NOT NULL`);
  }
  if (filters.method) conditions.push(eq(invoicePayments.paymentMethod, filters.method));
  if (filters.from) conditions.push(gte(invoicePayments.paidAt, new Date(filters.from)));
  if (filters.to) {
    conditions.push(
      lte(invoicePayments.paidAt, new Date(`${filters.to.slice(0, 10)}T23:59:59.999Z`))
    );
  }
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        sql`${invoicePayments.receiptNumber} ILIKE ${term}`,
        sql`${invoices.invoiceNumber} ILIKE ${term}`,
        sql`${invoices.buyerName} ILIKE ${term}`,
        sql`${invoicePayments.reference} ILIKE ${term}`
      )
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listReceipts(filters: ListReceiptsFilters = {}) {
  const where = receiptWhere(filters);
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  // Instalments are ordered by (paid_at, id); the window reads only ACTIVE receipts of the same
  // invoice, so a voided receipt neither counts nor shifts the ones around it.
  const paidBefore = sql<string>`(
    SELECT COALESCE(SUM(earlier.amount), 0)
    FROM invoice_payments earlier
    WHERE earlier.invoice_id = ${invoicePayments.invoiceId}
      AND earlier.voided_at IS NULL
      AND (earlier.paid_at, earlier.id) < (${invoicePayments.paidAt}, ${invoicePayments.id})
  )`;

  const [rows, summaryRows] = await Promise.all([
    db
      .select({
        id: invoicePayments.id,
        receiptNumber: invoicePayments.receiptNumber,
        amount: invoicePayments.amount,
        paymentMethod: invoicePayments.paymentMethod,
        paidAt: invoicePayments.paidAt,
        reference: invoicePayments.reference,
        notes: invoicePayments.notes,
        voidedAt: invoicePayments.voidedAt,
        voidReason: invoicePayments.voidReason,
        receivedById: users.id,
        receivedByUsername: users.username,
        storeId: stores.id,
        storeName: stores.name,
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        invoiceSource: invoices.source,
        invoiceKind: invoices.kind,
        invoiceStatus: invoices.status,
        buyerName: invoices.buyerName,
        invoiceIssuedAt: invoices.issuedAt,
        dueDate: invoices.dueDate,
        subtotal: invoices.subtotal,
        vatRate: invoices.vatRate,
        vatAmount: invoices.vatAmount,
        totalAmount: invoices.totalAmount,
        amountPaid: invoices.amountPaid,
        balanceDue: invoices.balanceDue,
        orderNumber: salesOrders.orderNumber,
        vatCompanyId: vatCompanies.id,
        vatCompanyCode: vatCompanies.code,
        vatCompanyName: vatCompanies.name,
        vatCompanyTaxId: vatCompanies.taxId,
        vatCompanyAddress: vatCompanies.address,
        paidBefore,
      })
      .from(invoicePayments)
      .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
      .leftJoin(users, eq(users.id, invoicePayments.receivedByUserId))
      .leftJoin(stores, eq(stores.id, invoicePayments.storeId))
      .leftJoin(salesOrders, eq(salesOrders.id, invoices.salesOrderId))
      .leftJoin(vatCompanies, eq(vatCompanies.id, invoices.vatCompanyId))
      .where(where)
      .orderBy(desc(invoicePayments.paidAt), desc(invoicePayments.id))
      .limit(limit)
      .offset(offset),
    db
      .select({
        receiptCount: sql<number>`count(*)::int`,
        receivedTotal: sql<string>`COALESCE(SUM(CASE WHEN ${invoicePayments.voidedAt} IS NULL THEN ${invoicePayments.amount} ELSE 0 END), 0)`,
        voidedCount: sql<number>`count(*) FILTER (WHERE ${invoicePayments.voidedAt} IS NOT NULL)::int`,
      })
      .from(invoicePayments)
      .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
      .where(where),
  ]);

  const receipts: CustomerReceiptRow[] = rows.map((row) => {
    const amount = Number(row.amount);
    const paidBefore = Number(row.paidBefore);
    const total = Number(row.totalAmount);
    const voided = Boolean(row.voidedAt);

    return {
      id: row.id,
      receiptNumber: row.receiptNumber,
      amount,
      paymentMethod: row.paymentMethod,
      paidAt: row.paidAt,
      reference: row.reference,
      notes: row.notes,
      voided,
      voidedAt: row.voidedAt,
      voidReason: row.voidReason,
      receivedBy: row.receivedById
        ? { id: row.receivedById, username: row.receivedByUsername ?? "" }
        : null,
      store: row.storeId ? { id: row.storeId, name: row.storeName ?? "" } : null,
      paidBefore: roundMoney(paidBefore),
      balanceAfter: roundMoney(voided ? total - paidBefore : total - paidBefore - amount),
      invoice: {
        id: row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        source: row.invoiceSource,
        kind: row.invoiceKind,
        status: row.invoiceStatus,
        buyerName: row.buyerName,
        issuedAt: row.invoiceIssuedAt,
        dueDate: row.dueDate,
        subtotal: Number(row.subtotal),
        vatRate: Number(row.vatRate),
        vatAmount: Number(row.vatAmount),
        totalAmount: total,
        amountPaid: Number(row.amountPaid),
        balanceDue: Number(row.balanceDue),
        orderNumber: row.orderNumber,
        vatCompany: row.vatCompanyId
          ? {
              id: row.vatCompanyId,
              code: row.vatCompanyCode ?? "",
              name: row.vatCompanyName ?? "",
              taxId: row.vatCompanyTaxId ?? "",
              address: row.vatCompanyAddress ?? "",
            }
          : null,
      },
    };
  });

  const summary = {
    receiptCount: summaryRows[0]?.receiptCount ?? 0,
    receivedTotal: roundMoney(Number(summaryRows[0]?.receivedTotal ?? 0)),
    voidedCount: summaryRows[0]?.voidedCount ?? 0,
  };

  return { receipts, total: summary.receiptCount, limit, offset, summary };
}

/**
 * Read the invoice FOR UPDATE and return its stored numbers.
 *
 * Everything that writes money must go through this: without the lock two concurrent payments
 * read the same `balance_due` and both pass the "does it fit" check.
 */
async function lockInvoice(tx: DbClient, invoiceId: number) {
  const rows = (await tx.execute(sql`
    SELECT id, status, total_amount, amount_paid, balance_due, store_id
    FROM invoices WHERE id = ${invoiceId} FOR UPDATE
  `)) as unknown as Array<{
    id: number;
    status: string;
    total_amount: string;
    amount_paid: string;
    balance_due: string;
    store_id: number | null;
  }>;

  if (rows.length === 0) {
    throw new InvoiceError('Invoice not found', 404, 'Reload the receivables list');
  }

  const row = rows[0];
  return {
    id: row.id,
    status: row.status,
    totalAmount: row.total_amount,
    amountPaid: row.amount_paid,
    balanceDue: row.balance_due,
    storeId: row.store_id,
  };
}

function parsePaidAt(value: Date | string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

