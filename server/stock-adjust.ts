import { db } from "@db";
import { inventory, products, stockMovements, stores } from "@db/schema";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { applyStockChange, StockError } from "./stock-ledger";
import { scopeStoreFilter, type AccessScope } from "./scoping";
import type { DbClient } from "./db-types";

/**
 * Stock adjustment / stock-take.
 *
 * AI Agent Note: before this module the only way to correct a count was to edit the
 * inventory row through `PUT /api/inventory/:id`, which overwrites the quantity and (until
 * the ledger existed) left no trace of who changed it or why. Every correction now goes
 * through `adjustStock`, which always writes a `stock_movements` row - a count that changes
 * nothing writes nothing.
 */

export type AdjustSource = 'stock_adjust' | 'stock_take';

export interface AdjustStockInput {
  inventoryId: number;
  userId?: number | null;
  /** Signed correction. Mutually exclusive with `countedQuantity`. */
  delta?: number;
  /** What the shelf actually holds; the delta is derived from the stored quantity. */
  countedQuantity?: number;
  /** Why - required, free text ("damaged in transit", "stock take 2026-02"). */
  reason: string;
  source?: AdjustSource;
}

export interface AdjustStockResult {
  inventoryId: number;
  productId: number | null;
  storeId: number | null;
  quantityBefore: number;
  quantityAfter: number;
  /** The change that was applied - zero when the count matched. */
  delta: number;
  /** False when the count matched and no movement was written. */
  movementWritten: boolean;
}

const REASON_MIN = 3;
const REASON_MAX = 200;

/**
 * Apply a stock correction and record it.
 *
 * AI Agent Note: reading the row and then writing `quantity + delta` is exactly the
 * read-then-write pattern that loses concurrent changes, so the actual increment goes
 * through `applyStockChange` inside the caller's transaction. A negative result is refused
 * by Postgres, not by a pre-check.
 */
export async function adjustStock(
  input: AdjustStockInput,
  executor: DbClient = db,
): Promise<AdjustStockResult> {
  const hasDelta = typeof input.delta === 'number';
  const hasCount = typeof input.countedQuantity === 'number';

  if (hasDelta === hasCount) {
    throw new StockError(
      'Provide either delta or countedQuantity, not both',
      400,
      'Send { delta: -3 } for a correction or { countedQuantity: 12 } for a counted shelf',
    );
  }

  if (hasDelta && (!Number.isInteger(input.delta) || input.delta === 0)) {
    throw new StockError('delta must be a non-zero whole number', 400);
  }

  if (hasCount && (!Number.isInteger(input.countedQuantity) || input.countedQuantity! < 0)) {
    throw new StockError('countedQuantity must be zero or more', 400);
  }

  const reason = (input.reason ?? '').trim();
  if (reason.length < REASON_MIN) {
    throw new StockError(
      'A reason is required for a stock adjustment',
      400,
      'Say why the stock changed, e.g. "damaged in transit"',
    );
  }
  if (reason.length > REASON_MAX) {
    throw new StockError(`The reason must be ${REASON_MAX} characters or fewer`, 400);
  }

  const source: AdjustSource = input.source ?? (hasCount ? 'stock_take' : 'stock_adjust');

  return executor.transaction(async (tx) => {
    const row = await tx.query.inventory.findFirst({
      where: eq(inventory.id, input.inventoryId),
      columns: { id: true, productId: true, storeId: true, quantity: true },
    });

    if (!row) {
      throw new StockError('Inventory item not found', 404);
    }

    const quantityBefore = row.quantity;
    const delta = hasCount ? input.countedQuantity! - quantityBefore : input.delta!;

    if (delta === 0) {
      // A blind recount that matches the system is the normal, healthy outcome - there is
      // nothing to record, and an empty movement would only add noise to the ledger.
      return {
        inventoryId: row.id,
        productId: row.productId,
        storeId: row.storeId,
        quantityBefore,
        quantityAfter: quantityBefore,
        delta: 0,
        movementWritten: false,
      };
    }

    const quantityAfter = await applyStockChange(tx, {
      inventoryId: row.id,
      delta,
      reason: 'adjustment',
      productId: row.productId,
      storeId: row.storeId,
      refType: source,
      refId: row.id,
      userId: input.userId ?? null,
      note: reason,
      requireSufficientStock: true,
    });

    return {
      inventoryId: row.id,
      productId: row.productId,
      storeId: row.storeId,
      quantityBefore,
      quantityAfter,
      delta,
      movementWritten: true,
    };
  });
}

export interface StockTakeRow {
  inventoryId: number;
  productId: number | null;
  productName: string;
  sku: string;
  storeId: number | null;
  storeName: string | null;
  inventoryType: string;
  /** What the system thinks is on the shelf right now. */
  systemQuantity: number;
  /** What was counted the last time this row was counted, if ever. */
  lastCountedQuantity: number | null;
  /** signed difference found at that count (negative = shrinkage). */
  lastVariance: number | null;
  lastCountedAt: string | null;
  lastNote: string | null;
}

/**
 * Rows for the stock-take screen: every inventory row the user can see, its system
 * quantity and the result of its most recent count.
 *
 * AI Agent Note: this must apply the step-07 store scope, otherwise a cashier could read
 * every store's stock. DC rows (store_id NULL) are shared company stock and stay visible,
 * same rule as GET /api/inventory.
 */
export async function listStockTake(
  scope: AccessScope,
  executor: DbClient = db,
): Promise<StockTakeRow[]> {
  const storeFilter = scopeStoreFilter(scope, inventory.storeId);

  const rows = await executor
    .select({
      inventoryId: inventory.id,
      productId: inventory.productId,
      productName: products.name,
      sku: products.sku,
      storeId: inventory.storeId,
      storeName: stores.name,
      inventoryType: inventory.inventoryType,
      systemQuantity: inventory.quantity,
    })
    .from(inventory)
    .innerJoin(products, eq(products.id, inventory.productId))
    .leftJoin(stores, eq(stores.id, inventory.storeId))
    .where(storeFilter ? or(storeFilter, isNull(inventory.storeId)) : undefined)
    .orderBy(products.name);

  if (rows.length === 0) return [];

  const counts = await executor
    .select({
      inventoryId: stockMovements.inventoryId,
      quantityAfter: stockMovements.quantityAfter,
      delta: stockMovements.delta,
      createdAt: stockMovements.createdAt,
      note: stockMovements.note,
    })
    .from(stockMovements)
    .where(and(
      eq(stockMovements.refType, 'stock_take'),
      inArray(stockMovements.inventoryId, rows.map((row) => row.inventoryId)),
    ))
    .orderBy(desc(stockMovements.id));

  const lastByInventory = new Map<number, typeof counts[number]>();
  for (const count of counts) {
    // Rows arrive newest first, so the first sighting of an inventory id is its last count.
    if (!lastByInventory.has(count.inventoryId)) {
      lastByInventory.set(count.inventoryId, count);
    }
  }

  return rows.map((row) => {
    const last = lastByInventory.get(row.inventoryId);
    return {
      ...row,
      lastCountedQuantity: last?.quantityAfter ?? null,
      lastVariance: last?.delta ?? null,
      lastCountedAt: last?.createdAt ? last.createdAt.toISOString() : null,
      lastNote: last?.note ?? null,
    };
  });
}
