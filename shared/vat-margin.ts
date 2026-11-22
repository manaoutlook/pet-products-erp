/**
 * VAT Margin Calculator - the profit-split worksheet, as one pure module.
 *
 * A VAT company (Conqueror / Hasim) issues the tax invoice for a sales order. Before it can be
 * paid, both sides agree how the sales value is split. This module reproduces the spreadsheet
 * the partners use, one line per sales-order line:
 *
 *   E  landing cost              products.landing_price
 *   F  selling price to B2B      products.b2b_price
 *   G  quantity                  sales_order_items.quantity
 *   H  margin                    profitMarginRate x (F - E)
 *   I  SmartLife price           E + H
 *   J  Conqueror profit / unit   F - I
 *   K  Conqueror profit total    J x G
 *   L  income tax                incomeTaxRate x K
 *   N  pay back to SmartLife     O - K - L
 *   O  sales value               F x G
 *   P  VAT                       vatRate x O
 *   Q  invoice total             O + P
 *
 * The unit figures (H, I, J) are per unit; K, L, N, O, P and Q are whole-line amounts. A totals
 * row sums those columns and the quantity, exactly like the worksheet's third row.
 *
 * The sales value splits into two piles that add back up to it:
 *
 *   VAT company profit (K) + income tax (L)   what the VAT company keeps from the invoice
 *   payback to SmartLife (N)                  everything else - O - K - L
 *
 * So N is SmartLife's price for the goods (I x G) less the tax it covers, and the two summary
 * lines under the table (N, and K + L) are the amounts actually transferred.
 *
 * AI Agent Note: the column letters keep the worksheet's original labels. M (VAT invoice
 * service fee) was retired and is deliberately not re-used, so every other letter still means
 * what the partners' spreadsheet says it means.
 *
 * AI Agent Note: this module never reads the database. The route joins the order lines to the
 * products and passes numbers in, so the same arithmetic can be unit-tested without Postgres and
 * the browser can show what the server will store. Money is rounded to the dong at every step
 * with `roundVnd`, the same helper the invoices use.
 */

import { roundVnd } from "./tax";

/** Profit margin is the share of the profit SmartLife keeps - the sheet uses 92% to 98%. */
export const VAT_MARGIN_MIN_PERCENT = 92;
export const VAT_MARGIN_MAX_PERCENT = 98;
export const VAT_MARGIN_MIN_RATE = VAT_MARGIN_MIN_PERCENT / 100;
export const VAT_MARGIN_MAX_RATE = VAT_MARGIN_MAX_PERCENT / 100;

/** Pre-filled on the calculator when no global setting has been saved yet. */
export const DEFAULT_PROFIT_MARGIN_RATE = 0.97;
export const DEFAULT_INCOME_TAX_RATE = 0.2;

/** Clamp a rate into 0..1, falling back when the input is not a finite number. */
export function normaliseRate(value: number | string | null | undefined, fallback = 0): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

/**
 * The profit margin is the one rate with a business rule around it: anything outside 92%-98%
 * is clamped, so a typo can never hand the VAT company the whole margin (or none of it).
 */
export function normaliseProfitMarginRate(
  value: number | string | null | undefined,
  fallback = DEFAULT_PROFIT_MARGIN_RATE
): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return fallback;
  return Math.min(VAT_MARGIN_MAX_RATE, Math.max(VAT_MARGIN_MIN_RATE, numeric));
}

/**
 * Whether a profit-margin FRACTION (0.97, not 97) is inside 92%-98%.
 *
 * `normaliseProfitMarginRate` silently clamps, which is right for the arithmetic but wrong for
 * the operator: typing 99 must not quietly become 98. The screen asks this to decide whether to
 * show the range error, and still computes with the clamped value so a statement is never
 * produced from an out-of-range split.
 */
export function isProfitMarginRateInRange(value: number | string | null | undefined): boolean {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return false;
  // A hair of tolerance so 0.92 (92 / 100) cannot fail on floating-point noise.
  const epsilon = 1e-9;
  return (
    numeric >= VAT_MARGIN_MIN_RATE - epsilon && numeric <= VAT_MARGIN_MAX_RATE + epsilon
  );
}

export interface VatMarginParams {
  /** Share of the profit SmartLife keeps (0.92 - 0.98). */
  profitMarginRate: number;
  /** Income-tax rate applied to the VAT company's profit (a global setting). */
  incomeTaxRate: number;
  /** The rate the order's VAT company charges, snapshotted on `sales_orders.vat_rate`. */
  vatRate: number;
}

export interface VatMarginSourceLine {
  productCode: string;
  description: string;
  /** products.landing_price - null when the Product module has not been updated. */
  landingPrice: number | null;
  /** products.b2b_price - null when the Product module has not been updated. */
  b2bPrice: number | null;
  quantity: number;
}

export interface VatMarginLine {
  productCode: string;
  description: string;
  landingPrice: number;
  b2bPrice: number;
  quantity: number;
  /** H - margin amount per unit. */
  marginAmount: number;
  /** I - the price SmartLife effectively receives per unit (landing + margin). */
  smartLifePrice: number;
  /** J - the VAT company's profit per unit. */
  conquerorProfitUnit: number;
  /** K - the VAT company's profit for the line. */
  conquerorProfitTotal: number;
  /** L - income tax on K. */
  incomeTax: number;
  /** N - what the VAT company pays back to SmartLife. */
  paybackToSmartLife: number;
  /** O - sales value, F x G. */
  salesValue: number;
  /** P - VAT, vatRate x O. */
  vatAmount: number;
  /** Q - invoice total, O + P. */
  invoiceTotal: number;
  /** True when a price is missing from the Product module; the line cannot be trusted. */
  hasError: boolean;
}

export interface VatMarginTotals {
  quantity: number;
  conquerorProfitTotal: number;
  incomeTax: number;
  paybackToSmartLife: number;
  salesValue: number;
  vatAmount: number;
  invoiceTotal: number;
}

export interface VatMarginIssue {
  productCode: string;
  field: "landingPrice" | "b2bPrice";
  message: string;
}

export interface VatMarginStatement {
  lines: VatMarginLine[];
  totals: VatMarginTotals;
  params: VatMarginParams;
  /** Clear, per-product messages naming the Product module field that is missing. */
  errors: VatMarginIssue[];
}

function computeLine(source: VatMarginSourceLine, params: VatMarginParams): VatMarginLine {
  const quantity = Number.isFinite(source.quantity) ? source.quantity : 0;
  const landingPrice = source.landingPrice ?? 0;
  const b2bPrice = source.b2bPrice ?? 0;
  const hasError = source.landingPrice === null || source.b2bPrice === null;

  const marginAmount = roundVnd(params.profitMarginRate * (b2bPrice - landingPrice));
  const smartLifePrice = roundVnd(landingPrice + marginAmount);
  const conquerorProfitUnit = roundVnd(b2bPrice - smartLifePrice);
  const conquerorProfitTotal = roundVnd(conquerorProfitUnit * quantity);
  const salesValue = roundVnd(b2bPrice * quantity);
  const incomeTax = roundVnd(params.incomeTaxRate * conquerorProfitTotal);
  // N: SmartLife gets the sales value less what the VAT company keeps (its profit) and the income
  // tax SmartLife covers out of its share. Identity: N + K + L = O.
  const paybackToSmartLife = roundVnd(salesValue - conquerorProfitTotal - incomeTax);
  const vatAmount = roundVnd(params.vatRate * salesValue);
  const invoiceTotal = roundVnd(salesValue + vatAmount);

  return {
    productCode: source.productCode,
    description: source.description,
    landingPrice,
    b2bPrice,
    quantity,
    marginAmount,
    smartLifePrice,
    conquerorProfitUnit,
    conquerorProfitTotal,
    incomeTax,
    paybackToSmartLife,
    salesValue,
    vatAmount,
    invoiceTotal,
    hasError,
  };
}

/**
 * Build the full statement. Prices are normalised here (never at the edge) so a route that
 * forgets to clamp a query-string rate still cannot produce an invalid split.
 */
export function computeVatMarginStatement(
  sources: VatMarginSourceLine[],
  params: VatMarginParams
): VatMarginStatement {
  const normalisedParams: VatMarginParams = {
    profitMarginRate: normaliseProfitMarginRate(params.profitMarginRate),
    incomeTaxRate: normaliseRate(params.incomeTaxRate),
    vatRate: normaliseRate(params.vatRate),
  };

  const lines: VatMarginLine[] = [];
  const errors: VatMarginIssue[] = [];

  for (const source of sources) {
    if (source.landingPrice === null) {
      errors.push({
        productCode: source.productCode,
        field: "landingPrice",
        message: `Landing Price is not updated in the Product module for ${source.productCode}`,
      });
    }
    if (source.b2bPrice === null) {
      errors.push({
        productCode: source.productCode,
        field: "b2bPrice",
        message: `B2B Price is not updated in the Product module for ${source.productCode}`,
      });
    }
    lines.push(computeLine(source, normalisedParams));
  }

  const totals = lines.reduce<VatMarginTotals>(
    (sum, line) => ({
      quantity: sum.quantity + line.quantity,
      conquerorProfitTotal: sum.conquerorProfitTotal + line.conquerorProfitTotal,
      incomeTax: sum.incomeTax + line.incomeTax,
      paybackToSmartLife: sum.paybackToSmartLife + line.paybackToSmartLife,
      salesValue: sum.salesValue + line.salesValue,
      vatAmount: sum.vatAmount + line.vatAmount,
      invoiceTotal: sum.invoiceTotal + line.invoiceTotal,
    }),
    {
      quantity: 0,
      conquerorProfitTotal: 0,
      incomeTax: 0,
      paybackToSmartLife: 0,
      salesValue: 0,
      vatAmount: 0,
      invoiceTotal: 0,
    }
  );

  return { lines, totals, params: normalisedParams, errors };
}

/** The VAT company's profit after income tax - the other half of "their earning". */
export function conquerorProfitAfterTax(totals: VatMarginTotals): number {
  return roundVnd(totals.conquerorProfitTotal - totals.incomeTax);
}

/**
 * What the VAT company keeps from the invoice: its profit plus the income tax withheld on it.
 * Shown as the second summary line - "Profit and Income Tax for VAT company".
 */
export function vatCompanyProfitAndTax(totals: VatMarginTotals): number {
  return roundVnd(totals.conquerorProfitTotal + totals.incomeTax);
}

