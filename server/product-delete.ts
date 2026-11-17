import { db } from "@db";
import {
  inventory,
  orderItems,
  purchaseOrderItems,
  salesOrderItems,
  salesTransactionItems,
  transferHistory,
  transferRequestItems,
} from "@db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Why a product must not be deleted.
 *
 * AI Agent Note: a product is referenced by stock, orders and transfers. Deleting it used
 * to cascade-delete its inventory rows, which silently destroyed stock history and left
 * sales/PO/transfer rows pointing at a vanished product (or failing with a raw FK error).
 * Deletion is therefore refused while any association exists.
 *
 * The shape mirrors `store-deletion.ts`: collect every blocker with a count, then build
 * one message that names the product and lists what is still attached, so the user knows
 * exactly what to clean up instead of seeing a generic 500.
 */
export interface ProductDeletionBlockers {
  /** Stock rows (`inventory.product_id`). Even a zero-quantity row blocks: it anchors the ledger. */
  inventory: number;
  /** Legacy customer order lines. */
  orderItems: number;
  /** Purchase order lines - the purchase history must survive. */
  purchaseOrderItems: number;
  /** Sales order lines - the order must still show what was sold. */
  salesOrderItems: number;
  /** POS sale lines - invoices are legal documents. */
  salesTransactionItems: number;
  /** Transfer request lines still in flight. */
  transferRequestItems: number;
  /** Completed transfer audit rows. */
  transferHistory: number;
}

export function hasProductDeletionBlockers(blockers: ProductDeletionBlockers): boolean {
  return Object.values(blockers).some((count) => count > 0);
}

/** Counts every record that keeps a product from being deleted. */
export async function getProductDeletionBlockers(
  productId: number,
): Promise<ProductDeletionBlockers> {
  // Drizzle returns a `{ count }` row per query; unwrap it so the call sites below stay
  // readable (same helper shape as store-deletion.ts).
  const countRows = async (rows: Promise<{ count: number }[]>) => {
    const [row] = await rows;
    return row?.count ?? 0;
  };

  const [inventoryCount, orderItemCount, purchaseOrderItemCount, salesOrderItemCount, salesItemCount, transferItemCount, transferHistoryCount] =
    await Promise.all([
      countRows(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(inventory)
          .where(eq(inventory.productId, productId)),
      ),
      countRows(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(orderItems)
          .where(eq(orderItems.productId, productId)),
      ),
      countRows(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(purchaseOrderItems)
          .where(eq(purchaseOrderItems.productId, productId)),
      ),
      countRows(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(salesOrderItems)
          .where(eq(salesOrderItems.productId, productId)),
      ),
      countRows(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(salesTransactionItems)
          .where(eq(salesTransactionItems.productId, productId)),
      ),
      countRows(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(transferRequestItems)
          .where(eq(transferRequestItems.productId, productId)),
      ),
      countRows(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(transferHistory)
          .where(eq(transferHistory.productId, productId)),
      ),
    ]);

  return {
    inventory: inventoryCount,
    orderItems: orderItemCount,
    purchaseOrderItems: purchaseOrderItemCount,
    salesOrderItems: salesOrderItemCount,
    salesTransactionItems: salesItemCount,
    transferRequestItems: transferItemCount,
    transferHistory: transferHistoryCount,
  };
}

/**
 * Human-readable list of what blocks the deletion, e.g.
 * `2 inventory record(s), 1 purchase order line(s)`.
 */
export function describeProductDeletionBlockers(blockers: ProductDeletionBlockers): string {
  const linked: string[] = [];
  if (blockers.inventory > 0) linked.push(`${blockers.inventory} inventory record(s)`);
  if (blockers.orderItems > 0) linked.push(`${blockers.orderItems} order line(s)`);
  if (blockers.purchaseOrderItems > 0) {
    linked.push(`${blockers.purchaseOrderItems} purchase order line(s)`);
  }
  if (blockers.salesOrderItems > 0) linked.push(`${blockers.salesOrderItems} sales order line(s)`);
  if (blockers.salesTransactionItems > 0) {
    linked.push(`${blockers.salesTransactionItems} sales transaction line(s)`);
  }
  if (blockers.transferRequestItems > 0) {
    linked.push(`${blockers.transferRequestItems} stock transfer line(s)`);
  }
  if (blockers.transferHistory > 0) {
    linked.push(`${blockers.transferHistory} completed stock transfer(s)`);
  }
  return linked.join(", ");
}

/**
 * Builds the 400 payload for a blocked deletion: the product name, what is still attached,
 * and what the user can actually do about it. Same contract as `buildStoreDeletionError`.
 */
export function buildProductDeletionError(
  productName: string,
  blockers: ProductDeletionBlockers,
): { message: string; suggestion: string } {
  const actions: string[] = [];
  if (blockers.inventory > 0) {
    actions.push("remove or transfer the inventory");
  }

  // Orders, purchase orders, sales and transfers are history that must stay readable, so
  // there is no action that makes those disappear - say so plainly instead of suggesting
  // an "archive" feature the product catalogue does not have.
  const hasHistory =
    blockers.orderItems > 0 ||
    blockers.purchaseOrderItems > 0 ||
    blockers.salesOrderItems > 0 ||
    blockers.salesTransactionItems > 0 ||
    blockers.transferRequestItems > 0 ||
    blockers.transferHistory > 0;

  const parts: string[] = [];
  if (actions.length > 0) parts.push(`Please ${actions.join(" and ")} first`);
  if (hasHistory) {
    parts.push(
      "Products with order, sales or stock transfer history are kept for reporting and cannot be deleted",
    );
  }

  return {
    message: `Cannot delete product "${productName}" because it is still linked to ${describeProductDeletionBlockers(blockers)}.`,
    suggestion: parts.length > 0 ? `${parts.join(". ")}.` : "Please try again later.",
  };
}

