import { db } from "@db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  inventory,
  orders,
  purchaseOrders,
  salesTransactions,
  transferRequests,
  userStoreAssignments,
} from "@db/schema";

// AI Agent Note: A store is referenced by two kinds of data:
//  - Operational data that can be moved away (inventory, user assignments).
//  - Immutable history that is kept for reporting (orders, sales, purchase
//    orders, stock transfers).
// Deleting the store row would either violate a foreign key or silently orphan
// records, so deletion is refused while any of them exist.
//
// Inventory is special: `inventory.store_id` is nullable and rows may only be
// pinned to a store through the free-text `inventory.location` column (which has
// no foreign key). Those rows must block deletion too, otherwise the stock stays
// behind pointing at a location that no longer exists.
export interface StoreDeletionBlockers {
  /** Inventory rows linked to the store by `inventory.store_id`. */
  inventoryByStore: number;
  /** Inventory rows with no store id whose location text matches the store's. */
  inventoryByLocation: number;
  /** Users assigned to the store. */
  assignments: number;
  /** Orders placed against the store. */
  orders: number;
  /** POS sales recorded against the store. */
  salesTransactions: number;
  /** Purchase orders whose destination is the store. */
  purchaseOrders: number;
  /** Stock transfers leaving or entering the store. */
  transfers: number;
}

export function hasBlockers(blockers: StoreDeletionBlockers): boolean {
  return Object.values(blockers).some((count) => count > 0);
}

/**
 * Collects every record that keeps a store from being deleted.
 * `storeLocation` is the store's free-text location, used to find inventory that
 * is only associated by location (matched case- and whitespace-insensitively).
 */
export async function getStoreDeletionBlockers(
  storeId: number,
  storeLocation?: string | null,
): Promise<StoreDeletionBlockers> {
  const locationKey = (storeLocation ?? "").trim().toLowerCase();

  // Drizzle returns a `{ count }` row per query; unwrap it so the call sites below
  // stay readable.
  const firstCount = async (rows: Promise<{ count: number }[]>) => {
    const [row] = await rows;
    return row?.count ?? 0;
  };

  const [inventoryByStore, inventoryByLocation, assignmentCount, orderCount, salesCount, purchaseOrderCount, transferCount] =
    await Promise.all([
      // Inventory pinned to the store directly.
      firstCount(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(inventory)
          .where(eq(inventory.storeId, storeId)),
      ),
      // Inventory pinned only by location text (no FK, so nothing else stops the
      // delete from orphaning it).
      locationKey
        ? firstCount(
            db
              .select({ count: sql<number>`count(*)::int` })
              .from(inventory)
              .where(
                and(
                  isNull(inventory.storeId),
                  sql`lower(btrim(${inventory.location})) = ${locationKey}`,
                ),
              ),
          )
        : Promise.resolve(0),
      firstCount(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(userStoreAssignments)
          .where(eq(userStoreAssignments.storeId, storeId)),
      ),
      firstCount(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(orders)
          .where(eq(orders.storeId, storeId)),
      ),
      firstCount(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(salesTransactions)
          .where(eq(salesTransactions.storeId, storeId)),
      ),
      firstCount(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(purchaseOrders)
          .where(eq(purchaseOrders.destinationStoreId, storeId)),
      ),
      firstCount(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(transferRequests)
          .where(
            or(
              eq(transferRequests.fromStoreId, storeId),
              eq(transferRequests.toStoreId, storeId),
            ),
          ),
      ),
    ]);

  return {
    inventoryByStore,
    inventoryByLocation,
    assignments: assignmentCount,
    orders: orderCount,
    salesTransactions: salesCount,
    purchaseOrders: purchaseOrderCount,
    transfers: transferCount,
  };
}

/**
 * Builds the 400 payload for a blocked deletion: which records block it, plus
 * what the user can actually do about them.
 */
export function buildStoreDeletionError(
  storeName: string,
  storeLocation: string | null | undefined,
  blockers: StoreDeletionBlockers,
): { message: string; suggestion: string } {
  const linked: string[] = [];
  const actions: string[] = [];

  if (blockers.inventoryByStore > 0) {
    linked.push(`${blockers.inventoryByStore} inventory record(s)`);
    actions.push("transfer or remove the inventory");
  }
  if (blockers.inventoryByLocation > 0) {
    const where = (storeLocation ?? "").trim();
    linked.push(
      where
        ? `${blockers.inventoryByLocation} inventory record(s) assigned to the location "${where}"`
        : `${blockers.inventoryByLocation} inventory record(s) assigned to this location`,
    );
    actions.push("reassign or remove the inventory at this location");
  }
  if (blockers.assignments > 0) {
    linked.push(`${blockers.assignments} user assignment(s)`);
    actions.push("remove the user store assignments");
  }

  const history: string[] = [];
  if (blockers.orders > 0) history.push(`${blockers.orders} order(s)`);
  if (blockers.salesTransactions > 0) history.push(`${blockers.salesTransactions} sales transaction(s)`);
  if (blockers.purchaseOrders > 0) history.push(`${blockers.purchaseOrders} purchase order(s)`);
  if (blockers.transfers > 0) history.push(`${blockers.transfers} stock transfer(s)`);

  const parts: string[] = [];
  if (actions.length > 0) parts.push(`Please ${actions.join(" and ")} first`);
  if (history.length > 0) {
    parts.push("Stores with transaction history are kept for reporting and cannot be deleted");
  }

  return {
    message: `Cannot delete store "${storeName}" because it is still linked to ${[...linked, ...history].join(", ")}`,
    suggestion: `${parts.join(". ")}.`,
  };
}
