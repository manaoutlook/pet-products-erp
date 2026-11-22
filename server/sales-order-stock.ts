import { and, eq, isNull } from "drizzle-orm";
import { inventory, stores } from "@db/schema";
import type { DbClient } from "./db-types";
import { StockError, applyStockChange } from "./stock-ledger";

/**
 * The stock side of a sales order and its delivery notes.
 *
 * Two documents, two different jobs:
 *
 *   sales order    a commitment. Saving one CHECKS that the chosen location can cover it, so the
 *                  shop cannot promise goods it does not have - but it moves no stock. An order
 *                  can be edited, cancelled or deleted without touching the ledger, because the
 *                  goods are still on the shelf until they are loaded.
 *   delivery note  the goods issue. This is the document that says what actually left the
 *                  warehouse (it carries real, possibly partial, quantities and the customer's
 *                  signature), so this is what deducts `inventory.quantity` and writes the
 *                  `SALES_ORDER` movement.
 *
 * Doing it any other way breaks on the shop floor: deducting the full order on save leaves stock
 * missing for goods still on the shelf when a short delivery ships, and deducting on both
 * documents takes the units out twice.
 *
 * Both documents use the same location convention as a purchase order's destination:
 *
 *   storeId = null   the Distribution Centre row (`inventory.store_id IS NULL`)
 *   storeId = N      that store's own inventory row
 *
 * Every write goes through `applyStockChange`, so `stock_movements` answers "where did this stock
 * go?" and points at the delivery note that took it.
 */

export class SalesOrderStockError extends Error {
  status: number;
  suggestion?: string;

  constructor(message: string, status = 400, suggestion?: string) {
    super(message);
    this.name = "SalesOrderStockError";
    this.status = status;
    this.suggestion = suggestion;
  }
}

/** The minimum a line needs for the ledger: which product, how many, and how it prints. */
export interface SalesOrderStockLine {
  productId: number;
  productCode: string;
  quantity: number;
}

export interface SalesOrderStockInput {
  /** Where the goods leave from. `null` = the Distribution Centre. */
  storeId: number | null;
  lines: SalesOrderStockLine[];
}

export interface IssueDeliveryNoteStockInput extends SalesOrderStockInput {
  deliveryNoteId: number;
  /** Printed in the movement note so the ledger can be searched by order too. */
  salesOrderNumber: string;
  userId: number;
}

interface StockLocation {
  storeId: number | null;
  /** How the location reads in a sentence: "the Distribution Centre" / "Test Store 1". */
  name: string;
}

async function resolveLocation(
  executor: DbClient,
  storeId: number | null
): Promise<StockLocation> {
  if (storeId === null) {
    return { storeId: null, name: "the Distribution Centre" };
  }

  const store = await executor.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { id: true, name: true },
  });

  if (!store) {
    throw new SalesOrderStockError(
      `Location ${storeId} was not found`,
      400,
      'Pick another "Deliver from" location for the order.'
    );
  }

  return { storeId, name: store.name };
}

/**
 * One entry per product. A delivery note can carry two lines of the same product, but two ledger
 * rows for one shelf are noise - the units are added up first.
 */
function mergeLines(lines: SalesOrderStockLine[]): SalesOrderStockLine[] {
  const merged = new Map<number, SalesOrderStockLine>();

  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue;

    const existing = merged.get(line.productId);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      merged.set(line.productId, { ...line });
    }
  }

  return Array.from(merged.values());
}

/** The inventory row stock leaves from. */
async function findInventoryRow(
  executor: DbClient,
  productId: number,
  storeId: number | null
) {
  return executor.query.inventory.findFirst({
    where: and(
      eq(inventory.productId, productId),
      storeId === null ? isNull(inventory.storeId) : eq(inventory.storeId, storeId)
    ),
    columns: { id: true, quantity: true },
  });
}

/**
 * Can this location still cover these lines?
 *
 * Called when a sales order is saved and again when a delivery note is issued. It only reads:
 * the answer must not change the shelf, because a cancelled order and a corrected quantity would
 * both have to be undone. A missing inventory row is refused too - "we never stocked this here"
 * is not the same as "we have zero", and a sale from it would have nowhere to go in the ledger.
 */
export async function assertStockAvailable(
  executor: DbClient,
  input: SalesOrderStockInput
): Promise<void> {
  const location = await resolveLocation(executor, input.storeId);

  for (const line of mergeLines(input.lines)) {
    const row = await findInventoryRow(executor, line.productId, location.storeId);

    if (!row) {
      throw new SalesOrderStockError(
        `${line.productCode} has no stock record at ${location.name}`,
        400,
        `Receive stock at ${location.name} first, or ship this order from a location that has it.`
      );
    }

    if (row.quantity < line.quantity) {
      throw new SalesOrderStockError(
        `${line.productCode}: only ${row.quantity} in stock at ${location.name}, but ${line.quantity} ${
          line.quantity === 1 ? "unit is" : "units are"
        } needed`,
        400,
        'Reduce the quantity, receive stock first, or pick another "Deliver from" location.'
      );
    }
  }
}

/**
 * Arguments for returning a cancelled note's units to stock.
 *
 * `SalesOrderStockInput` carries the note lines plus the location they shipped from
 * (`delivery_notes.store_id`, NULL = the Distribution Centre).
 */
export interface RestoreDeliveryNoteStockInput extends SalesOrderStockInput {
  deliveryNoteId: number;
  deliveryNoteNumber: string;
  /** Printed in the movement note so the ledger can be searched by order too. */
  salesOrderNumber: string;
  userId: number;
  /** The operator's explanation, copied onto the ledger row. */
  reason?: string | null;
}

/**
 * Put a cancelled delivery note's units back on the shelf.
 *
 * Cancelling a note reverses the goods issue: the units that
 * `issueDeliveryNoteStock` took off are returned to the SAME inventory row the note shipped
 * from (`delivery_notes.store_id`, snapshotted at issue time; NULL = the Distribution Centre).
 * The movement is written as `cancel` / `RETURN` and points at the note, so the ledger can
 * explain the increase and `npm run stock:reconcile` still balances.
 *
 * Runs inside the caller's transaction, so a restock that cannot be written rolls the status
 * change back with it - a note can never read "cancelled" while its stock is still missing.
 */
export async function restoreDeliveryNoteStock(
  executor: DbClient,
  input: RestoreDeliveryNoteStockInput
): Promise<number> {
  const location = await resolveLocation(executor, input.storeId);
  const reason = input.reason?.trim() ? input.reason.trim() : null;
  let restored = 0;

  for (const line of mergeLines(input.lines)) {
    const row = await findInventoryRow(executor, line.productId, location.storeId);

    if (!row) {
      throw new SalesOrderStockError(
        `${line.productCode} has no stock record at ${location.name} to return to`,
        409,
        `Receive stock at ${location.name}, or record this with a stock adjustment.`
      );
    }

    await applyStockChange(executor, {
      inventoryId: row.id,
      delta: line.quantity,
      reason: "cancel",
      transactionType: "RETURN",
      productId: line.productId,
      storeId: location.storeId,
      refType: "delivery_note",
      refId: input.deliveryNoteId,
      userId: input.userId,
      note: [
        `Delivery note ${input.deliveryNoteNumber} cancelled`,
        `sales order ${input.salesOrderNumber}`,
        `units returned to ${location.name}`,
        reason ? `reason: ${reason}` : null,
      ]
        .filter(Boolean)
        .join(" - "),
    });

    restored += line.quantity;
  }

  return restored;
}

/**
 * Take a delivery note's units off the shelf.
 *
 * Runs inside the caller's transaction, so a note that cannot be covered is rolled back to
 * nothing - no note, no line tallies, no shipment whose stock never left. Stock is refused rather
 * than allowed to go negative: goods that are not there cannot be loaded, and a negative quantity
 * on the shelf is how a stock report stops being trusted.
 */
export async function issueDeliveryNoteStock(
  executor: DbClient,
  input: IssueDeliveryNoteStockInput
): Promise<void> {
  const location = await resolveLocation(executor, input.storeId);

  for (const line of mergeLines(input.lines)) {
    const row = await findInventoryRow(executor, line.productId, location.storeId);

    if (!row) {
      throw new SalesOrderStockError(
        `${line.productCode} has no stock record at ${location.name}`,
        409,
        `Receive stock at ${location.name} before delivering this order.`
      );
    }

    if (row.quantity < line.quantity) {
      throw new SalesOrderStockError(
        `${line.productCode}: only ${row.quantity} in stock at ${location.name}, but this delivery takes ${line.quantity}`,
        409,
        'Deliver what is on the shelf, receive stock first, or move stock to this location.'
      );
    }

    try {
      await applyStockChange(executor, {
        inventoryId: row.id,
        delta: -line.quantity,
        reason: "sale",
        transactionType: "SALES_ORDER",
        productId: line.productId,
        storeId: location.storeId,
        refType: "delivery_note",
        refId: input.deliveryNoteId,
        userId: input.userId,
        note: `Sales order ${input.salesOrderNumber} shipped from ${location.name}`,
        // Belt and braces: two notes issued at the same moment must not oversell the row the
        // pre-check above just read.
        requireSufficientStock: true,
      });
    } catch (error) {
      if (error instanceof StockError) {
        throw new SalesOrderStockError(
          `${line.productCode} could not be taken out of stock at ${location.name}`,
          error.status,
          error.suggestion
        );
      }
      throw error;
    }
  }
}
