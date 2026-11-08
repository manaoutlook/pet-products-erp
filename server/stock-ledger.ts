import { inventory, stockMovements } from "@db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import type { DbClient } from "./db-types";

/**
 * Why stock moved. Keep in sync with `stockMovements.reason` in db/schema.ts.
 */
export type StockMovementReason =
  | 'sale'
  | 'refund'
  | 'cancel'
  | 'transfer_in'
  | 'transfer_out'
  | 'po_receipt'
  | 'adjustment';

export interface StockMovementInput {
  inventoryId: number;
  /** Signed change: negative leaves the shelf, positive arrives on it. */
  delta: number;
  reason: StockMovementReason;
  productId?: number | null;
  storeId?: number | null;
  /** `inventory.quantity` right after the change, when the caller knows it. */
  quantityAfter?: number | null;
  refType?: string | null;
  refId?: number | null;
  userId?: number | null;
}

/**
 * Raised when a guarded stock change cannot be applied.
 * Routes map it to res.status(err.status).json({ message, suggestion }).
 */
export class StockError extends Error {
  status: number;
  suggestion?: string;

  constructor(message: string, status = 400, suggestion?: string) {
    super(message);
    this.name = 'StockError';
    this.status = status;
    this.suggestion = suggestion;
  }
}

/**
 * Append one row to the stock ledger.
 *
 * AI Agent Note: always pass the caller's transaction (`tx`) where one exists. A movement
 * written on a separate pooled connection commits even when the surrounding sale/transfer
 * rolls back, which would leave a ledger entry for stock that never moved.
 */
export async function recordStockMovement(
  executor: DbClient,
  input: StockMovementInput
): Promise<void> {
  if (!Number.isInteger(input.inventoryId) || input.inventoryId <= 0) {
    throw new StockError('Cannot record a stock movement without an inventory id', 500);
  }

  await executor.insert(stockMovements).values({
    inventoryId: input.inventoryId,
    productId: input.productId ?? null,
    storeId: input.storeId ?? null,
    delta: input.delta,
    quantityAfter: input.quantityAfter ?? null,
    reason: input.reason,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    userId: input.userId ?? null,
  });
}

/**
 * Batch form of recordStockMovement - one INSERT for a whole receipt/transfer.
 */
export async function recordStockMovements(
  executor: DbClient,
  inputs: StockMovementInput[]
): Promise<void> {
  if (inputs.length === 0) return;

  await executor.insert(stockMovements).values(
    inputs.map((input) => ({
      inventoryId: input.inventoryId,
      productId: input.productId ?? null,
      storeId: input.storeId ?? null,
      delta: input.delta,
      quantityAfter: input.quantityAfter ?? null,
      reason: input.reason,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      userId: input.userId ?? null,
    }))
  );
}

export interface ApplyStockChangeInput extends Omit<StockMovementInput, 'quantityAfter'> {
  /**
   * When true a negative delta is only applied if the row still holds enough stock,
   * evaluated by Postgres in the same statement. This is the guard that stops two
   * concurrent sales from overselling.
   */
  requireSufficientStock?: boolean;
}

/**
 * Change `inventory.quantity` and record the movement in one step.
 * Returns the new quantity.
 *
 * AI Agent Note: the increment happens in SQL (`quantity + delta`), never by reading the
 * value and writing value+delta back - two concurrent callers would otherwise compute the
 * same result and lose one of the changes.
 */
export async function applyStockChange(
  executor: DbClient,
  input: ApplyStockChangeInput
): Promise<number> {
  const where = input.requireSufficientStock && input.delta < 0
    ? and(eq(inventory.id, input.inventoryId), gte(inventory.quantity, -input.delta))
    : eq(inventory.id, input.inventoryId);

  const [updated] = await executor
    .update(inventory)
    .set({
      quantity: sql`${inventory.quantity} + ${input.delta}`,
      updatedAt: new Date(),
    })
    .where(where)
    .returning({ quantity: inventory.quantity });

  if (!updated) {
    throw new StockError(
      'Insufficient stock for this change',
      400,
      'Refresh the page to see the current quantity'
    );
  }

  await recordStockMovement(executor, { ...input, quantityAfter: updated.quantity });
  return updated.quantity;
}

/**
 * Record the arrival of a brand-new inventory row.
 *
 * A new row starts at its first quantity, so the ledger needs that opening balance as a
 * movement; otherwise the sum of movements never matches `inventory.quantity` and the
 * reconciliation report would flag every created row.
 */
export async function recordOpeningStock(
  executor: DbClient,
  input: Omit<StockMovementInput, 'delta' | 'quantityAfter'> & { quantity: number }
): Promise<void> {
  await recordStockMovement(executor, {
    ...input,
    delta: input.quantity,
    quantityAfter: input.quantity,
  });
}
