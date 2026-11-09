import { inventory, stockMovements, type InventoryTransactionType } from "@db/schema";
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
  /**
   * The audited business reason. Omitted by callers that only know the internal
   * `reason` - `inferInventoryTransactionType` then derives it, so no path can write a
   * movement without a transaction type.
   */
  transactionType?: InventoryTransactionType;
  productId?: number | null;
  storeId?: number | null;
  /** `inventory.quantity` right before the change, when the caller knows it. */
  quantityBefore?: number | null;
  /** `inventory.quantity` right after the change, when the caller knows it. */
  quantityAfter?: number | null;
  refType?: string | null;
  refId?: number | null;
  /** The retained upload behind a bulk import, when this movement came from one. */
  importFileId?: number | null;
  userId?: number | null;
  /** Human explanation for a manual change; `reason` stays a fixed vocabulary. */
  note?: string | null;
}

/**
 * Map the internal movement vocabulary onto the audited transaction types.
 *
 * `adjustment` is the one ambiguous reason, so `refType` decides: a stock take is a
 * physical count, an import is a bulk import, a write-off is damage, everything else is
 * a manual correction.
 */
export function inferInventoryTransactionType(
  reason: StockMovementReason,
  refType?: string | null,
): InventoryTransactionType {
  switch (reason) {
    case 'sale':
      return 'SALES_ORDER';
    case 'refund':
    case 'cancel':
      return 'RETURN';
    case 'transfer_in':
    case 'transfer_out':
      return 'STOCK_TRANSFER';
    case 'po_receipt':
      return 'PURCHASE_ORDER';
    case 'adjustment':
    default:
      if (refType === 'stock_take') return 'PHYSICAL_COUNT';
      if (refType === 'inventory_import') return 'BULK_IMPORT';
      if (refType === 'damage_or_write_off') return 'DAMAGE_OR_WRITE_OFF';
      return 'MANUAL_ADJUSTMENT';
  }
}

/** Normalise one caller input into the exact row shape the ledger stores. */
function toMovementRow(input: StockMovementInput) {
  const quantityAfter = input.quantityAfter ?? null;
  // A movement that knows where it ended also knows where it started: after - delta.
  // Deriving it here keeps the two cached quantities consistent by construction.
  const quantityBefore =
    input.quantityBefore ?? (quantityAfter === null ? null : quantityAfter - input.delta);

  return {
    inventoryId: input.inventoryId,
    productId: input.productId ?? null,
    storeId: input.storeId ?? null,
    delta: input.delta,
    quantityBefore,
    quantityAfter,
    transactionType:
      input.transactionType ?? inferInventoryTransactionType(input.reason, input.refType),
    reason: input.reason,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    importFileId: input.importFileId ?? null,
    userId: input.userId ?? null,
    note: input.note ?? null,
  };
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

  await executor.insert(stockMovements).values(toMovementRow(input));
}

/**
 * Batch form of recordStockMovement - one INSERT for a whole receipt/transfer.
 */
export async function recordStockMovements(
  executor: DbClient,
  inputs: StockMovementInput[]
): Promise<void> {
  if (inputs.length === 0) return;

  await executor.insert(stockMovements).values(inputs.map(toMovementRow));
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
