/**
 * The three prices a product must carry before it can be put on a sales order.
 *
 * A sales order is the start of the paperwork chain (order -> delivery note -> VAT invoice)
 * and every later document prices the goods from the product master: the VAT margin
 * statement needs `landingPrice` and `b2bPrice` to work out the split, the till and the
 * B2B/B2C price lists need `b2bPrice` / `b2cPrice`. A product with a blank price used to
 * slip into an order and only failed much later, on a screen where nobody could fix it.
 *
 * So the check lives here, as one pure module, and both the form (instant, before the
 * request leaves the browser) and `buildSalesOrderLines` (authoritative, for API clients)
 * use the same rule and the same wording.
 *
 * AI Agent Note: a price of `0` counts as filled in - it is a decision ("free / included"),
 * while `null`, `undefined`, `""` and `NaN` mean "nobody has entered it yet". Numeric
 * columns come back from Postgres as strings, so both shapes have to be accepted.
 */

/** The price columns checked on every product in a sales order, in the order they are read. */
export const SALES_ORDER_PRICE_FIELDS = [
  { key: "landingPrice", label: "Landing Price" },
  { key: "b2bPrice", label: "B2B Price" },
  { key: "b2cPrice", label: "B2C Price" },
] as const;

export type SalesOrderPriceField = (typeof SALES_ORDER_PRICE_FIELDS)[number]["key"];

/** A catalogue row, as much of it as the price check needs. */
export interface SalesOrderPricedProduct {
  productCode: string;
  productName?: string | null;
  landingPrice?: number | string | null;
  b2bPrice?: number | string | null;
  b2cPrice?: number | string | null;
}

/** One product that cannot go on an order yet. */
export interface MissingSalesOrderPrices {
  productCode: string;
  productName: string | null;
  /** Column names, for callers that want to highlight the fields. */
  fields: SalesOrderPriceField[];
  /** Human labels, in the same order as `fields` ("Landing Price", "B2B Price", ...). */
  labels: string[];
}

/** What the user has to do about it - shown next to the message everywhere. */
export const SALES_ORDER_PRICING_HINT =
  "Open Products, edit each product listed above and fill in Landing Price, B2B Price and B2C Price, then save the sales order again.";

/** `null`, `undefined`, `""` and `NaN` mean "not filled in"; `0` is a real price. */
export function isSalesOrderPriceMissing(value: number | string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return !Number.isFinite(value);
}

/**
 * Every product in `products` that is missing at least one of the three prices.
 *
 * Products that are fully priced are dropped, so an empty result is the green light.
 */
export function findMissingSalesOrderPrices(
  products: SalesOrderPricedProduct[]
): MissingSalesOrderPrices[] {
  const missing: MissingSalesOrderPrices[] = [];

  for (const product of products) {
    const fields: SalesOrderPriceField[] = [];
    const labels: string[] = [];

    for (const field of SALES_ORDER_PRICE_FIELDS) {
      if (isSalesOrderPriceMissing(product[field.key])) {
        fields.push(field.key);
        labels.push(field.label);
      }
    }

    if (fields.length > 0) {
      missing.push({
        productCode: product.productCode,
        productName: product.productName ?? null,
        fields,
        labels,
      });
    }
  }

  return missing;
}

/**
 * One sentence naming every offending product and the fields it is missing, e.g.
 *
 *   "Cannot save the sales order: 2 products are missing prices in the Product module -
 *    PM-MFP-26A001 (Pet Milk): Landing Price, B2C Price; PC-BNHT-26A001 (Bone Treat): B2B Price."
 */
export function describeMissingSalesOrderPrices(missing: MissingSalesOrderPrices[]): string {
  const products = missing
    .map((entry) => {
      const name = entry.productName ? ` (${entry.productName})` : "";
      return `${entry.productCode}${name}: ${entry.labels.join(", ")}`;
    })
    .join("; ");

  const subject =
    missing.length === 1
      ? "1 product is missing prices"
      : `${missing.length} products are missing prices`;

  return `Cannot save the sales order: ${subject} in the Product module - ${products}.`;
}
