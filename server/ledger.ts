import { db } from "@db";
import { customerProfiles, financeEntries, invoicePayments, invoices } from "@db/schema";
import { and, asc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { FINANCE_ENTRY_TYPE_LABELS } from "../shared/finance";
import type { FinanceEntryType } from "../shared/finance";
import {
  endOfVietnamDay,
  ledgerColumnLabels,
  ledgerTotals,
  startOfVietnamDay,
  vietnamDayOf,
} from "../shared/ledger";
import type { LedgerDocument, LedgerLine } from "../shared/ledger";
import { FinanceError } from "./finance";

/**
 * Ledger printing service.
 *
 * A read model, not a posting engine. Every amount below already exists in the database:
 * `invoice_payments` (cash received), `finance_entries` (money typed in) and `invoices` (what a
 * customer was charged). This file only reads them in date order and hands the printable sheet
 * to the client. Nothing is copied, so voiding a receipt or an expense corrects the next print
 * with no reconciliation step.
 *
 * Day boundaries are Vietnamese calendar days, not UTC: a receipt taken at 06:30 local on the
 * 4th is stored as 23:30 UTC on the 3rd, so a UTC-boundary filter would put it on the wrong day.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function numberOf(value: string | number | null | undefined): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : 0;
}

function assertDate(value: string, label: string): string {
  const parsed = DATE_PATTERN.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new FinanceError(`${label} must be a real date in YYYY-MM-DD format`, 400);
  }
  return value;
}

export interface LedgerRangeFilters {
  from?: string;
  to?: string;
  today?: Date;
}

/** Resolve the requested range, defaulting to the current Vietnamese month. */
function resolveRange(filters: LedgerRangeFilters) {
  const today = filters.today ?? new Date();
  const defaultTo = vietnamDayOf(today) || today.toISOString().slice(0, 10);
  const to = assertDate(filters.to ?? defaultTo, "To date");
  const from = assertDate(filters.from ?? `${to.slice(0, 7)}-01`, "From date");
  if (from > to) throw new FinanceError("The start date must be on or before the end date", 400);
  return { from, to, start: startOfVietnamDay(from), end: endOfVietnamDay(to) };
}

/** Sort by day, then by document number, so a reprint is always in the same order. */
function sortLines(lines: LedgerLine[]): LedgerLine[] {
  return lines.sort(
    (a, b) => a.date.localeCompare(b.date) || a.docNumber.localeCompare(b.docNumber)
  );
}

/**
 * Money in / money out for a period, from every stream that moves cash.
 *
 * The opening balance is computed from what happened BEFORE the period, which is what makes the
 * closing figure equal the real cash position. Voided rows are printed (with their amount and a
 * VOIDED mark) but contribute nothing - see `lineEffect` in shared/ledger.ts.
 */
export async function cashBookLedger(filters: LedgerRangeFilters = {}): Promise<LedgerDocument> {
  const { from, to, start, end } = resolveRange(filters);

  const [receiptRows, entryRows, openingReceipts, openingEntries] = await Promise.all([
    db
      .select({
        id: invoicePayments.id,
        receiptNumber: invoicePayments.receiptNumber,
        amount: invoicePayments.amount,
        paidAt: invoicePayments.paidAt,
        paymentMethod: invoicePayments.paymentMethod,
        reference: invoicePayments.reference,
        voidedAt: invoicePayments.voidedAt,
        invoiceNumber: invoices.invoiceNumber,
        buyerName: invoices.buyerName,
      })
      .from(invoicePayments)
      .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
      .where(and(gte(invoicePayments.paidAt, start), lte(invoicePayments.paidAt, end)))
      .orderBy(asc(invoicePayments.paidAt), asc(invoicePayments.id)),
    db
      .select({
        id: financeEntries.id,
        entryNumber: financeEntries.entryNumber,
        entryType: financeEntries.entryType,
        direction: financeEntries.direction,
        category: financeEntries.category,
        description: financeEntries.description,
        amount: financeEntries.amount,
        entryDate: financeEntries.entryDate,
        paymentMethod: financeEntries.paymentMethod,
        reference: financeEntries.reference,
        status: financeEntries.status,
      })
      .from(financeEntries)
      .where(and(gte(financeEntries.entryDate, from), lte(financeEntries.entryDate, to)))
      .orderBy(asc(financeEntries.entryDate), asc(financeEntries.id)),
    db
      .select({ total: sql<string>`COALESCE(SUM(${invoicePayments.amount}), 0)` })
      .from(invoicePayments)
      .where(and(isNull(invoicePayments.voidedAt), lt(invoicePayments.paidAt, start))),
    db
      .select({
        total: sql<string>`COALESCE(SUM(CASE WHEN ${financeEntries.direction} = 'credit'
          THEN ${financeEntries.amount} ELSE -${financeEntries.amount} END), 0)`,
      })
      .from(financeEntries)
      .where(and(eq(financeEntries.status, "posted"), lt(financeEntries.entryDate, from))),
  ]);

  const lines: LedgerLine[] = [];

  for (const receipt of receiptRows) {
    lines.push({
      date: vietnamDayOf(receipt.paidAt),
      docType: "Receipt",
      docNumber: receipt.receiptNumber,
      description: `Received from ${receipt.buyerName || "walk-in customer"} for invoice ${
        receipt.invoiceNumber
      }`,
      note: [receipt.paymentMethod, receipt.reference].filter(Boolean).join(" · ") || null,
      debit: numberOf(receipt.amount),
      credit: 0,
      status: receipt.voidedAt ? "voided" : "posted",
      source: "receipt",
      sourceId: receipt.id,
      href: "/receipts?tab=customer",
    });
  }

  for (const entry of entryRows) {
    const amount = numberOf(entry.amount);
    // `direction` is the stored bookkeeping side of the entry: credit brings money in, debit
    // takes it out. A database CHECK keeps it aligned with `entryType`, so one column is enough.
    const moneyIn = entry.direction === "credit";
    lines.push({
      date: entry.entryDate,
      docType: FINANCE_ENTRY_TYPE_LABELS[entry.entryType as FinanceEntryType] ?? "Entry",
      docNumber: entry.entryNumber,
      description: `${entry.category} - ${entry.description}`,
      note: [entry.paymentMethod, entry.reference].filter(Boolean).join(" · ") || null,
      debit: moneyIn ? amount : 0,
      credit: moneyIn ? 0 : amount,
      status: entry.status === "voided" ? "voided" : "posted",
      source: "finance_entry",
      sourceId: entry.id,
      href: `/finance?tab=entries&search=${encodeURIComponent(entry.entryNumber)}`,
    });
  }

  const sorted = sortLines(lines);
  const openingBalance =
    numberOf(openingReceipts[0]?.total) + numberOf(openingEntries[0]?.total);

  return {
    kind: "cash_book",
    title: "Cash book",
    subtitle: `Money in and money out, ${from} to ${to}`,
    party: null,
    from,
    to,
    openingLabel: "Opening balance",
    openingBalance,
    columnLabels: ledgerColumnLabels("cash_book"),
    closingLabel: "Closing balance",
    lines: sorted,
    totals: ledgerTotals(sorted, openingBalance),
    notes: [
      "Reads the customer receipt register and the manual entries together; invoice receipts are never copied, so a voided receipt or expense is gone from the next print.",
      "Voided rows are printed for the audit trail but do not move the balance.",
      `Opening balance is everything before ${from}; the closing figure is the cash position at the end of ${to}.`,
    ],
    generatedAt: new Date().toISOString(),
  };
}

/** The customers that have at least one invoice - the ones a statement can be printed for. */
export async function ledgerCustomers() {
  const rows = await db
    .select({
      id: customerProfiles.id,
      name: sql<string>`COALESCE(NULLIF(${customerProfiles.companyName}, ''), ${customerProfiles.contactPerson})`,
      contactPerson: customerProfiles.contactPerson,
      mobileNumber: customerProfiles.mobileNumber,
      invoiceCount: sql<number>`COUNT(${invoices.id})`,
    })
    .from(customerProfiles)
    .innerJoin(invoices, eq(invoices.customerProfileId, customerProfiles.id))
    .groupBy(
      customerProfiles.id,
      customerProfiles.companyName,
      customerProfiles.contactPerson,
      customerProfiles.mobileNumber
    )
    .orderBy(asc(sql`COALESCE(NULLIF(${customerProfiles.companyName}, ''), ${customerProfiles.contactPerson})`));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    detail: [row.contactPerson, row.mobileNumber].filter(Boolean).join(" · ") || null,
    invoiceCount: Number(row.invoiceCount),
  }));
}

/**
 * One customer's statement: invoices are the charges, receipts are the payments.
 *
 * The opening figure is what the customer already owed the day before `from`:
 *   sum(invoices issued before the period) - sum(receipts received before the period)
 * so partial payments from earlier months carry into this one and the closing figure is
 * genuinely what is still outstanding, not just what happened inside the window.
 *
 * Cancelled invoices are left out entirely (a cancelled document is not a charge). A receipt
 * that was voided is still printed - it is a correction the customer may hold a copy of - but it
 * does not reduce the balance.
 */
export async function customerStatementLedger(
  customerProfileId: number,
  filters: LedgerRangeFilters = {}
): Promise<LedgerDocument> {
  const { from, to, start, end } = resolveRange(filters);

  const customer = await db.query.customerProfiles.findFirst({
    where: eq(customerProfiles.id, customerProfileId),
    columns: {
      id: true,
      companyName: true,
      contactPerson: true,
      mobileNumber: true,
      email: true,
    },
  });

  if (!customer) {
    throw new FinanceError("Customer not found", 404, "Reload the customer list and try again");
  }

  const invoiceRows = await db.query.invoices.findMany({
    where: eq(invoices.customerProfileId, customerProfileId),
    with: { payments: true },
    orderBy: [asc(invoices.issuedAt), asc(invoices.id)],
  });

  let openingBalance = 0;
  const lines: LedgerLine[] = [];

  for (const invoice of invoiceRows) {
    const issuedAt = new Date(invoice.issuedAt);
    const total = numberOf(invoice.totalAmount);
    const cancelled = invoice.status === "cancelled";

    if (!cancelled) {
      if (issuedAt < start) {
        openingBalance += total;
      } else if (issuedAt <= end) {
        lines.push({
          date: vietnamDayOf(issuedAt),
          docType: "Invoice",
          docNumber: invoice.invoiceNumber,
          description: `${invoice.kind === "VAT" ? "VAT" : "Retail"} invoice${
            invoice.source === "SALES_ORDER" ? " (sales order)" : ""
          }`,
          note: invoice.dueDate ? `Due ${invoice.dueDate}` : "Due on issue",
          debit: total,
          credit: 0,
          status: "posted",
          source: "invoice",
          sourceId: invoice.id,
          href: "/receivables",
        });
      }
    }

    for (const payment of invoice.payments ?? []) {
      const paidAt = new Date(payment.paidAt);
      const amount = numberOf(payment.amount);

      if (paidAt < start) {
        if (!payment.voidedAt) openingBalance -= amount;
        continue;
      }
      if (paidAt > end) continue;

      lines.push({
        date: vietnamDayOf(paidAt),
        docType: "Receipt",
        docNumber: payment.receiptNumber,
        description: `Payment for invoice ${invoice.invoiceNumber}${
          cancelled ? " (invoice cancelled)" : ""
        }`,
        note:
          [payment.paymentMethod, payment.reference].filter(Boolean).join(" · ") || null,
        debit: 0,
        credit: amount,
        status: payment.voidedAt ? "voided" : "posted",
        source: "receipt",
        sourceId: payment.id,
        href: "/receipts?tab=customer",
      });
    }
  }

  const sorted = sortLines(lines);
  const partyName = customer.companyName?.trim() || customer.contactPerson;

  return {
    kind: "customer_statement",
    title: "Customer statement",
    subtitle: `Account activity, ${from} to ${to}`,
    party: {
      id: customer.id,
      name: partyName,
      detail:
        [customer.contactPerson, customer.mobileNumber, customer.email]
          .filter(Boolean)
          .join(" · ") || null,
    },
    from,
    to,
    openingLabel: "Opening balance",
    openingBalance,
    columnLabels: ledgerColumnLabels("customer_statement"),
    closingLabel: "Outstanding at end of period",
    lines: sorted,
    totals: ledgerTotals(sorted, openingBalance),
    notes: [
      "Invoices are the charges and receipts are the payments, including partial payments.",
      "Cancelled invoices are left out. A voided receipt is printed for the audit trail but does not reduce the balance.",
      "The closing figure is what this customer still owes at the end of the period.",
    ],
    generatedAt: new Date().toISOString(),
  };
}



