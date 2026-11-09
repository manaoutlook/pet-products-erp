import { eq, inArray } from "drizzle-orm";
import {
  deliveryNoteItems,
  deliveryNotes,
  products,
  salesOrderItems,
  salesOrders,
} from "@db/schema";
import type { DbClient } from "./db-types";
import { generateDeliveryNoteNumber } from "./numbering";

/**
 * Sales orders and the delivery notes that ship them.
 *
 * Why the order keeps its own `delivered_quantity` per line while the notes keep a copy of
 * what they carried: the delivery note is the customer's proof of what arrived in *that*
 * shipment, and the order line is the running tally the next shipment is measured against.
 * Deriving the tally by summing every note would mean a removed/edited note silently rewrites
 * history, and it cannot answer "how many units are still owed" without a full scan.
 *
 * The order status is never edited by hand (except cancelling): it is derived from the lines
 * by `recalculateSalesOrderStatus`, so the list can never show "delivered" on an order that
 * still has undelivered units.
 */

export type SalesOrderStatus = "open" | "partially_delivered" | "delivered" | "cancelled";

/**
 * Raised when a sales order / delivery note operation is refused.
 * Routes map it to `res.status(err.status).json({ message, suggestion })`.
 */
export class SalesOrderError extends Error {
  status: number;
  suggestion?: string;

  constructor(message: string, status = 400, suggestion?: string) {
    super(message);
    this.name = "SalesOrderError";
    this.status = status;
    this.suggestion = suggestion;
  }
}

/** Round to the 2 decimals the DECIMAL(15,2) columns can store (VND amounts). */
export function money(value: number | null | undefined): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Derive the order status from its lines.
 *
 * Pure on purpose: this is the whole rule ("nothing delivered / some delivered / everything
 * delivered") and it is unit-tested without a database.
 */
export function summariseStatus(
  lines: Array<{ quantity: number; deliveredQuantity: number }>,
  current: SalesOrderStatus = "open"
): SalesOrderStatus {
  // A cancelled order is final: delivering against it is refused elsewhere, and the status
  // must not silently flip back if somebody adds a line or fixes a quantity.
  if (current === "cancelled") return "cancelled";

  if (lines.length === 0) return "open";

  const ordered = lines.reduce((sum, line) => sum + line.quantity, 0);
  const delivered = lines.reduce(
    (sum, line) => sum + Math.min(line.deliveredQuantity, line.quantity),
    0
  );

  if (ordered > 0 && delivered >= ordered) return "delivered";
  if (delivered > 0) return "partially_delivered";
  return "open";
}

/**
 * Recompute and persist `sales_orders.status` from its lines.
 *
 * Always pass the caller's transaction (`db.transaction((tx) => ...)`) so the status change
 * commits together with the delivery note that caused it.
 */
export async function recalculateSalesOrderStatus(
  executor: DbClient,
  salesOrderId: number
): Promise<SalesOrderStatus> {
  const order = await executor.query.salesOrders.findFirst({
    where: eq(salesOrders.id, salesOrderId),
    columns: { id: true, status: true, orderNumber: true },
  });

  if (!order) {
    throw new SalesOrderError("Sales order not found", 404);
  }

  const lines = await executor
    .select({
      quantity: salesOrderItems.quantity,
      deliveredQuantity: salesOrderItems.deliveredQuantity,
    })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.salesOrderId, salesOrderId));

  const status = summariseStatus(lines, order.status as SalesOrderStatus);

  if (status !== order.status) {
    await executor
      .update(salesOrders)
      .set({ status, updatedAt: new Date() })
      .where(eq(salesOrders.id, salesOrderId));
  }

  return status;
}

/** Load an order with its lines, refusing cancelled / already-complete ones. */
export async function loadDeliverableSalesOrder(executor: DbClient, salesOrderId: number) {
  const order = await executor.query.salesOrders.findFirst({
    where: eq(salesOrders.id, salesOrderId),
  });

  if (!order) {
    throw new SalesOrderError("Sales order not found", 404);
  }

  if (order.status === "cancelled") {
    throw new SalesOrderError(
      `Sales order ${order.orderNumber} is cancelled`,
      400,
      "Create a new sales order instead of delivering a cancelled one."
    );
  }

  const items = await executor.query.salesOrderItems.findMany({
    where: eq(salesOrderItems.salesOrderId, salesOrderId),
    orderBy: [salesOrderItems.id],
  });

  const outstanding = items.reduce(
    (sum, item) => sum + Math.max(0, item.quantity - item.deliveredQuantity),
    0
  );

  if (items.length === 0 || outstanding === 0) {
    throw new SalesOrderError(
      `Sales order ${order.orderNumber} has nothing left to deliver`,
      409,
      "Every line is already covered by a delivery note - raise a new sales order instead."
    );
  }

  return { order, items, outstanding };
}

/** A line the driver is dropping off: which order line, and how many units. */
export interface DeliveryLineInput {
  salesOrderItemId: number;
  deliveredQuantity: number;
  remarks?: string | null;
}

export interface IssueDeliveryNoteInput {
  salesOrderId: number;
  deliveryDate: Date;
  userId: number;
  remarks?: string | null;
  customerConfirmed?: boolean;
  /**
   * Which lines travel on this note and how many units of each.
   * Omit it to deliver everything still outstanding (a single complete shipment).
   */
  items?: DeliveryLineInput[];
}

export interface IssueDeliveryNoteResult {
  deliveryNote: typeof deliveryNotes.$inferSelect;
  items: Array<typeof deliveryNoteItems.$inferSelect>;
  /** Order status after this shipment. */
  status: SalesOrderStatus;
  /** Units still owed to the customer after this note. */
  outstandingQuantity: number;
}

/**
 * Issue a delivery note: the outbound mirror of `receiveGoods`.
 *
 * Creates the note, records what it carried, advances the order lines and refreshes the
 * order status - all inside the caller's transaction. Over-delivery is refused per line, so a
 * double click can never ship (or bill for) more units than the customer ordered.
 */
export async function issueDeliveryNote(
  executor: DbClient,
  input: IssueDeliveryNoteInput
): Promise<IssueDeliveryNoteResult> {
  const { order, items: orderItems, outstanding } = await loadDeliverableSalesOrder(
    executor,
    input.salesOrderId
  );

  const itemsById = new Map(orderItems.map((item) => [item.id, item]));

  // Default: ship whatever is still owed. The screen normally sends explicit lines so the
  // driver can leave part of the order behind.
  const requestedLines: DeliveryLineInput[] =
    input.items && input.items.length > 0
      ? input.items
      : orderItems
          .map((item) => ({
            salesOrderItemId: item.id,
            deliveredQuantity: Math.max(0, item.quantity - item.deliveredQuantity),
          }))
          .filter((line) => line.deliveredQuantity > 0);

  const seen = new Set<number>();
  const resolvedLines: Array<{
    item: (typeof orderItems)[number];
    deliveredQuantity: number;
    remarks: string | null;
  }> = [];

  for (const line of requestedLines) {
    const orderItem = itemsById.get(line.salesOrderItemId);
    if (!orderItem) {
      throw new SalesOrderError(
        `Line ${line.salesOrderItemId} does not belong to order ${order.orderNumber}`,
        400,
        "Reload the order - its lines may have changed since the form was opened."
      );
    }

    if (seen.has(line.salesOrderItemId)) {
      throw new SalesOrderError(
        `Line ${orderItem.productCode} appears twice on the same delivery note`,
        400,
        "Combine the quantities into a single row."
      );
    }
    seen.add(line.salesOrderItemId);

    if (!Number.isInteger(line.deliveredQuantity) || line.deliveredQuantity <= 0) {
      throw new SalesOrderError(
        `Delivered quantity for ${orderItem.productCode} must be a whole number above zero`,
        400
      );
    }

    const remaining = orderItem.quantity - orderItem.deliveredQuantity;
    if (line.deliveredQuantity > remaining) {
      throw new SalesOrderError(
        `Cannot deliver ${line.deliveredQuantity} x ${orderItem.productCode} - only ${Math.max(
          0,
          remaining
        )} still outstanding`,
        400,
        "Reduce the delivered quantity to the amount actually shipped."
      );
    }

    resolvedLines.push({
      item: orderItem,
      deliveredQuantity: line.deliveredQuantity,
      remarks: line.remarks?.trim() ? line.remarks.trim() : null,
    });
  }

  if (resolvedLines.length === 0) {
    throw new SalesOrderError(
      "A delivery note needs at least one line with units on it",
      400,
      "Enter the quantity that actually left the warehouse."
    );
  }

  const [deliveryNote] = await executor
    .insert(deliveryNotes)
    .values({
      deliveryNoteNumber: generateDeliveryNoteNumber(),
      salesOrderId: order.id,
      deliveryDate: input.deliveryDate,
      // Snapshot of the order's customer block: a reprint must match what was signed.
      customerName: order.customerName,
      companyName: order.companyName,
      contactPerson: order.contactPerson,
      phone: order.phone,
      deliveryAddress: order.deliveryAddress,
      deliveredByUserId: input.userId,
      customerConfirmed: input.customerConfirmed ?? false,
      remarks: input.remarks?.trim() ? input.remarks.trim() : null,
      status: "issued",
    })
    .returning();

  const insertedItems = await executor
    .insert(deliveryNoteItems)
    .values(
      resolvedLines.map((line) => ({
        deliveryNoteId: deliveryNote.id,
        salesOrderItemId: line.item.id,
        productCode: line.item.productCode,
        description: line.item.description,
        orderedQuantity: line.item.quantity,
        deliveredQuantity: line.deliveredQuantity,
        remarks: line.remarks,
      }))
    )
    .returning();

  for (const line of resolvedLines) {
    await executor
      .update(salesOrderItems)
      .set({
        deliveredQuantity: line.item.deliveredQuantity + line.deliveredQuantity,
        updatedAt: new Date(),
      })
      .where(eq(salesOrderItems.id, line.item.id));
  }

  const status = await recalculateSalesOrderStatus(executor, order.id);

  const shipped = resolvedLines.reduce((sum, line) => sum + line.deliveredQuantity, 0);

  return {
    deliveryNote,
    items: insertedItems,
    status,
    outstandingQuantity: Math.max(0, outstanding - shipped),
  };
}

/** Recompute one line's money from quantity x unit price, so the client cannot fake totals. */
export function orderLineTotals(line: { quantity: number; unitPrice: number }) {
  return {
    unitPrice: money(line.unitPrice),
    totalPrice: money(line.quantity * line.unitPrice),
  };
}

/** Order total for the header, computed from the resolved lines. */
export function orderTotal(lines: Array<{ quantity: number; unitPrice: number }>): number {
  return money(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
}

/** A line as submitted by the order form. */
export interface SalesOrderLineInput {
  productId: number;
  quantity: number;
  unitPrice?: number;
}

/** A line ready to insert: catalogue snapshot + server-computed money. */
export interface ResolvedOrderLine {
  productId: number;
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
}

/**
 * Turn the submitted lines into insertable rows.
 *
 * AI Agent Note: product code/description/price are read from the catalogue here, and the line
 * total is always recomputed. Trusting the client's `totalPrice` would let a stale tab (or a
 * hand-crafted request) store an order that does not add up to its own unit prices.
 */
export async function buildSalesOrderLines(
  executor: DbClient,
  lines: SalesOrderLineInput[]
): Promise<{ lines: ResolvedOrderLine[]; total: number }> {
  const productIds = Array.from(new Set(lines.map((line) => line.productId)));

  const catalogue = await executor
    .select({ id: products.id, name: products.name, sku: products.sku, price: products.price })
    .from(products)
    .where(inArray(products.id, productIds));

  const byId = new Map(catalogue.map((product) => [product.id, product]));

  const resolved = lines.map((line) => {
    const product = byId.get(line.productId);

    if (!product) {
      throw new SalesOrderError(
        `Product ${line.productId} no longer exists`,
        400,
        "Remove the line and pick another product."
      );
    }

    const totals = orderLineTotals({
      quantity: line.quantity,
      unitPrice: line.unitPrice ?? Number(product.price),
    });

    return {
      productId: product.id,
      productCode: product.sku,
      description: product.name,
      quantity: line.quantity,
      unitPrice: totals.unitPrice.toFixed(2),
      totalPrice: totals.totalPrice.toFixed(2),
    };
  });

  const total = orderTotal(
    resolved.map((line) => ({ quantity: line.quantity, unitPrice: Number(line.unitPrice) }))
  );

  return { lines: resolved, total };
}

