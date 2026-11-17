/**
 * VAT - the one place the rate and the arithmetic live.
 *
 * AI Agent Note (do not re-add a hardcoded 0.1 anywhere):
 * The shop is `HỘ KINH DOANH TIỆN ÍCH GIA ĐÌNH`, a household business which is NOT allowed
 * to issue a VAT invoice. Catalogue prices are therefore stored VAT-EXCLUSIVE, and VAT is
 * added only when a customer asks for a VAT invoice:
 *
 *     subtotal   = sum(line quantity x unit price)        (VAT-exclusive)
 *     vatAmount  = subtotal x rate                        (only when printing with VAT)
 *     total      = subtotal + vatAmount
 *
 * The rate is NOT the same for every issuer: each licensed VAT company carries its own rate
 * (`vat_companies.vat_rate`, edited as a percentage on the VAT Companies screen), and every
 * invoice that company issues charges that rate. `VAT_RATE` is only the default for a company
 * that has never been given one - pass the company's rate into `computeSaleTotals` instead of
 * relying on it.
 *
 * `server/sales.ts` calls this once inside the sale transaction and stores all three
 * numbers on `sales_transactions`. The cart preview, the till receipt, the A4 invoice and
 * every reprint read those stored numbers - they never recompute a total backwards.
 *
 * This used to be three copies of `* 0.1` (cart, receipt printer, reprint route) plus a
 * `/ 1.1` back-calculation on reprint. A 100,000 sale printed 110,000 at the till, stored
 * 100,000 in the database and reprinted as 90,909.09 + 9,090.91 = 100,000.
 */

/** VAT rate a company starts with when it has never been given one. Vietnam's standard rate. */
export const VAT_RATE = 0.1;

/** A rate is a fraction of the subtotal, so 100% is the ceiling. */
export const MAX_VAT_RATE = 1;

/**
 * The rate columns are DECIMAL(5,4), i.e. four decimals - `0.0850`. Percentages are shown with
 * two decimals (`8.5`), which fits that grid exactly.
 */
const RATE_SCALE = 10_000;

/**
 * A percentage typed on the VAT Companies screen ("8.5") as the stored fraction (0.085).
 *
 * AI Agent Note: the COLUMN and this module work in fractions - the same unit as
 * `sales_transactions.vat_rate` and `computeSaleTotals`'s `rate` argument. Only the form (and
 * this helper) converts to the percentage an operator understands, so no caller has to divide
 * by 100 itself.
 */
export function percentToRate(percent: number): number {
  const safe = Number.isFinite(percent) ? percent : 0;
  return Math.round((safe / 100) * RATE_SCALE) / RATE_SCALE;
}

/** A stored fraction (0.085) as the percentage the VAT % field shows (8.5). */
export function rateToPercent(rate: number): number {
  const safe = Number.isFinite(rate) ? rate : 0;
  return Math.round(safe * RATE_SCALE) / 100;
}

/**
 * Read a stored rate into a usable fraction.
 *
 * `decimal` columns come back from Postgres as strings ("0.0800"), and a legacy row may hold
 * nothing at all - in both cases the caller gets a number, never NaN. `fallback` is the rate
 * used when the stored value is missing or unreadable.
 */
export function toVatRate(
  value: string | number | null | undefined,
  fallback: number = VAT_RATE
): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : fallback;
}

export interface SaleTotals {
  /** Sum of the line totals, VAT-exclusive. */
  subtotal: number;
  /** VAT added on top; `0` when the sale is not invoiced with VAT. */
  vatAmount: number;
  /** What the customer actually pays. */
  total: number;
  /** The rate that produced `vatAmount` - stored so a reprint cannot drift. */
  vatRate: number;
}

/** VND has no minor unit in practice: round to the dong, on both sides of the wire. */
export function roundVnd(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

/**
 * Add VAT to a VAT-exclusive subtotal.
 *
 * `withVat: false` is not "0%" - it means no VAT invoice is issued at all, so the rate and
 * the amount are both stored as 0 and the invoice prints "no VAT" rather than "VAT 0%".
 */
export function computeSaleTotals(
  subtotal: number,
  withVat: boolean,
  rate: number = VAT_RATE
): SaleTotals {
  const safeSubtotal = roundVnd(subtotal);
  if (!withVat) {
    return { subtotal: safeSubtotal, vatAmount: 0, total: safeSubtotal, vatRate: 0 };
  }
  const vatAmount = roundVnd(safeSubtotal * rate);
  return {
    subtotal: safeSubtotal,
    vatAmount,
    total: safeSubtotal + vatAmount,
    vatRate: rate,
  };
}

/** Sum of line totals for a cart, before VAT. */
export function sumLineTotals(
  lines: Array<{ quantity: number; unitPrice: number }>
): number {
  return roundVnd(
    lines.reduce((sum, line) => sum + Number(line.unitPrice) * Number(line.quantity), 0)
  );
}
