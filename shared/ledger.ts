/**
 * Ledger printing - one shape for every printable money statement.
 *
 * AI Agent Note - why this file exists, and what it is NOT:
 *
 * The application keeps its facts in three places and never copies them into a fourth:
 *   - `invoice_payments`  cash actually received (Receivables);
 *   - `finance_entries`   money a person typed in (expenses, other income, partner capital);
 *   - `invoices`          what a customer was charged (the receivable).
 *
 * A "ledger" is therefore a READ MODEL: it reads those tables in date order and prints them.
 * Nothing here writes a row, so a voided receipt or a voided expense disappears from the next
 * statement by itself - there is no second copy that could drift.
 *
 * `debit` / `credit` follow one rule for every kind of statement here:
 *   debit  = the value that INCREASES the running balance (money in / amount charged)
 *   credit = the value that DECREASES the running balance (money out / amount paid)
 *
 * That is the cash-account convention for the cash book and the customer-account convention
 * for a statement, so one running-balance function serves both. The headings printed on paper
 * come from `columnLabels`, never from the field names.
 *
 * A VOIDED row is still printed (audit: what was written and what was corrected) but it does
 * not move the balance: `lineEffect` returns 0 for it.
 */

export const LEDGER_KINDS = ["cash_book", "customer_statement"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const LEDGER_SOURCES = ["invoice", "receipt", "finance_entry"] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export const LEDGER_LINE_STATUSES = ["posted", "voided"] as const;
export type LedgerLineStatus = (typeof LEDGER_LINE_STATUSES)[number];

export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
  cash_book: "Cash book (money in / money out)",
  customer_statement: "Customer statement",
};

export interface LedgerLine {
  /** Vietnamese calendar day, `YYYY-MM-DD`. */
  date: string;
  docType: string;
  docNumber: string;
  description: string;
  /** Second, smaller line: due date, payment method, reference. */
  note: string | null;
  debit: number;
  credit: number;
  status: LedgerLineStatus;
  source: LedgerSource;
  sourceId: number;
  /** Where the reader can open the document behind the line. */
  href: string | null;
}

export interface LedgerParty {
  id: number;
  name: string;
  detail: string | null;
}

export interface LedgerTotals {
  /** Posted debits in the period. */
  debit: number;
  /** Posted credits in the period. */
  credit: number;
  /** Opening balance + debit - credit: the balance at `to`. */
  closing: number;
  /** Posted rows in the period (voided ones are not counted). */
  count: number;
  /** Rows printed, including voided ones. */
  printed: number;
}

export interface LedgerDocument {
  kind: LedgerKind;
  title: string;
  subtitle: string;
  party: LedgerParty | null;
  from: string;
  to: string;
  openingLabel: string;
  openingBalance: number;
  columnLabels: { debit: string; credit: string; balance: string };
  closingLabel: string;
  lines: LedgerLine[];
  totals: LedgerTotals;
  /** Printed under the table so a reader knows what the figure does and does not include. */
  notes: string[];
  generatedAt: string;
}

/** Headings for the two amount columns plus the running balance, per statement kind. */
export function ledgerColumnLabels(kind: LedgerKind): LedgerDocument["columnLabels"] {
  return kind === "customer_statement"
    ? { debit: "Charged", credit: "Paid", balance: "Outstanding" }
    : { debit: "Money in", credit: "Money out", balance: "Balance" };
}

export function isLedgerKind(value: unknown): value is LedgerKind {
  return typeof value === "string" && (LEDGER_KINDS as readonly string[]).includes(value);
}

/**
 * How much a printed line moves the balance.
 *
 * A voided row keeps its amount so the paper shows what was reversed, but contributes nothing -
 * otherwise a voided expense would still reduce the balance it no longer belongs to.
 */
export function lineEffect(line: Pick<LedgerLine, "debit" | "credit" | "status">): number {
  if (line.status !== "posted") return 0;
  return line.debit - line.credit;
}

export interface LedgerLineWithBalance extends LedgerLine {
  balance: number;
}

/**
 * Attach the running balance to each line, starting from the opening figure.
 *
 * Used by both the preview and the printed sheet, so the screen and the paper can never
 * disagree about the arithmetic.
 */
export function withRunningBalance(
  lines: readonly LedgerLine[],
  openingBalance: number
): LedgerLineWithBalance[] {
  let balance = openingBalance;
  return lines.map((line) => {
    balance += lineEffect(line);
    return { ...line, balance };
  });
}

export function ledgerTotals(lines: readonly LedgerLine[], openingBalance: number): LedgerTotals {
  let debit = 0;
  let credit = 0;
  let count = 0;

  for (const line of lines) {
    if (line.status !== "posted") continue;
    debit += line.debit;
    credit += line.credit;
    count += 1;
  }

  return {
    debit,
    credit,
    closing: openingBalance + debit - credit,
    count,
    printed: lines.length,
  };
}

/** The day a receipt belongs to on paper. Vietnam is UTC+7 all year, with no DST. */
export const VIETNAM_UTC_OFFSET_MINUTES = 7 * 60;

export function vietnamDayOf(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + VIETNAM_UTC_OFFSET_MINUTES * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** First instant of a Vietnamese calendar day, as a real `Date`. */
export function startOfVietnamDay(day: string): Date {
  return new Date(`${day}T00:00:00.000+07:00`);
}

/** Last instant of a Vietnamese calendar day, as a real `Date`. */
export function endOfVietnamDay(day: string): Date {
  return new Date(`${day}T23:59:59.999+07:00`);
}

