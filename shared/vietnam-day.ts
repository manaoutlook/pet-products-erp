/**
 * Vietnamese calendar days.
 *
 * AI Agent Note - why this file exists:
 *
 * Every money document is stamped with a real timestamp (`invoice_payments.paid_at`,
 * `invoices.issued_at`), but every figure the owner reads is per *Vietnamese* day. Vietnam is
 * UTC+7 all year with no DST, so a receipt taken at 06:30 on the 4th is stored as 23:30 UTC on
 * the 3rd. A UTC-boundary filter (`T00:00:00.000Z` .. `T23:59:59.999Z`) therefore counts that
 * receipt on the wrong day: it lands in the 3rd's takings, and a report that ends "today" at
 * 06:30 stops at yesterday.
 *
 * These three helpers are the only place that conversion happens. The finance report, the
 * receipt/invoice registers and the printable ledger all use them, so the screen, the list and
 * the paper can never disagree about which day a payment belongs to.
 */

/** Vietnam is UTC+7 all year, with no daylight saving. */
export const VIETNAM_UTC_OFFSET_MINUTES = 7 * 60;

/** The Vietnamese calendar day (`YYYY-MM-DD`) an instant belongs to. Empty string if invalid. */
export function vietnamDayOf(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + VIETNAM_UTC_OFFSET_MINUTES * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** First instant of a Vietnamese calendar day, as a real `Date` (17:00 UTC the day before). */
export function startOfVietnamDay(day: string): Date {
  return new Date(`${day}T00:00:00.000+07:00`);
}

/** Last instant of a Vietnamese calendar day, as a real `Date`. */
export function endOfVietnamDay(day: string): Date {
  return new Date(`${day}T23:59:59.999+07:00`);
}

/**
 * Move a `YYYY-MM-DD` day by whole days.
 *
 * Pure calendar arithmetic on the day string - no timezone is involved, so it can never slide a
 * month end onto the wrong date the way `Date.setDate` on a local instant can.
 */
export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
