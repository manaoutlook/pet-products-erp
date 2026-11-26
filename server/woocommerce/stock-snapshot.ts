import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@db";
import { inventory, products } from "@db/schema";
import type { StockQuantityRow, WebsiteStockScope } from "../../shared/woocommerce";

/**
 * The ERP's stock, as the website sees it: one number per product.
 *
 * `ALL` (the business default) sums the distribution centre and every store, because a customer
 * buying on the website is served from whichever shelf still holds the item. `DC` and `STORES`
 * exist for a channel that must not promise a shop's shelf stock to the public.
 *
 * AI Agent Note - the aggregate is a LEFT JOIN, never a `WHERE`:
 * A product with no `inventory` row at all is out of stock, not absent. Putting the scope into
 * the WHERE clause would drop those products from the snapshot, and the sync would then leave
 * them on the website with whatever quantity they last had - the exact failure this sync exists
 * to prevent. The scope therefore lives in the JOIN condition.
 *
 * AI Agent Note - `SUM` comes back as a string:
 * Postgres types `sum(integer)` as `bigint`, and postgres-js hands bigints back as strings. The
 * conversion to a number happens here, once, with `COALESCE(..., 0)` covering the empty group.
 */
export interface StockSnapshotOptions {
  scope?: WebsiteStockScope;
  /** Only consulted when `scope` is `STORES`. Empty means "no store contributes". */
  storeIds?: number[];
}

export async function loadStockSnapshot(
  options: StockSnapshotOptions = {},
): Promise<StockQuantityRow[]> {
  const { scope = "ALL", storeIds = [] } = options;

  const joinCondition = (() => {
    if (scope === "DC") {
      // The DC has no store id; a store row always has one.
      return and(eq(inventory.productId, products.id), isNull(inventory.storeId));
    }
    if (scope === "STORES") {
      // No explicit list means "every store shelf, without the DC". Returning nothing here would
      // make a mis-set channel push 0 for every product, which is the one failure mode this
      // module must never have.
      const notDc = isNotNull(inventory.storeId);
      if (storeIds.length === 0) {
        return and(eq(inventory.productId, products.id), notDc);
      }
      return and(
        eq(inventory.productId, products.id),
        notDc,
        inArray(inventory.storeId, storeIds),
      );
    }
    return eq(inventory.productId, products.id);
  })();

  const rows = await db
    .select({
      productId: products.id,
      sku: products.sku,
      quantity: sql<string>`COALESCE(SUM(${inventory.quantity}), 0)`,
    })
    .from(products)
    .leftJoin(inventory, joinCondition)
    .groupBy(products.id, products.sku)
    .orderBy(asc(products.sku));

  return rows.map((row) => ({
    productId: row.productId,
    sku: row.sku,
    quantity: Number(row.quantity ?? 0),
  }));
}
