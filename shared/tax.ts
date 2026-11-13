/**
 * VAT - the one place the rate and the arithmetic live.
 *
 * AI Agent Note (do not re-add a hardcoded 0.1 anywhere):
 * The shop is `HỘ KINH DOANH TIỆN ÍCH GIA ĐÌNH`, a household business which is NOT allowed
 * to issue a VAT invoice. Catalogue prices are therefore stored VAT-EXCLUSIVE, and VAT is
 * added only when a customer asks for a VAT invoice:
 *
 *     subtotal   = sum(line quantity x unit price)        (VAT-exclusive)
 *     vatAmount  = subtotal x VAT_RATE                    (only when printing with VAT)
 *     total      = subtotal + vatAmount
 *
 * `server/sales.ts` calls this once inside the sale transaction and stores all three
 * numbers on `sales_transactions`. The cart preview, the till receipt, the A4 invoice and
 * every reprint read those stored numbers - they never recompute a total backwards.
 *
 * This used to be three copies of `* 0.1` (cart, receipt printer, reprint route) plus a
 * `/ 1.1` back-calculation on reprint. A 100,000 sale printed 110,000 at the till, stored
 * 100,000 in the database and reprinted as 90,909.09 + 9,090.91 = 100,000.
 */

/** VAT rate applied to a VAT invoice. Vietnam's standard rate for these goods. */
export const VAT_RATE = 0.1;

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
