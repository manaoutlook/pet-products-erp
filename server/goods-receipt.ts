import { and, desc, eq } from "drizzle-orm";
import {
  goodsReceiptItems,
  goodsReceipts,
  inventory,
  products,
  purchaseOrderActions,
  purchaseOrderItems,
  purchaseOrders,
} from "@db/schema";
import type { DbClient } from "./db-types";
import { applyStockChange, recordOpeningStock, StockError } from "./stock-ledger";
import { generateInventoryBarcode, generateReceiptNumber } from "./numbering";

/**
 * Receiving a purchase order: the one place that turns "the truck arrived" into stock,
 * money and a record.
 *
 * Why this is its own flow instead of editable fields on the purchase order:
 *  - The actual delivery date only exists once the goods land, and it must sit *next to*
 *    the expected date so lateness stays measurable. Overwriting purchase_orders.delivery_date
 *    would erase the promise the supplier made.
 *  - Shipping / customs / brokerage are unknown (often unknowable) at order time.
 *  - Receiving is the moment stock moves, so it belongs in the stock ledger's audit trail
 *    ("who booked these units in, and when"), not in an "edit order" screen.
 *  - A delivery can be short, or arrive in several shipments, so one PO can have many receipts;
 *    each receipt records the lines and quantities it actually carried (goods_receipt_items).
 *    Only a receipt that completes every line closes the order.
 *
 * The service refuses to book more units in than are outstanding, so a double click (or a
 * short-then-full pair of shipments) can never double the stock.
 */

/** The five import costs captured on arrival. All optional; missing means zero. */
export interface LandedCostInput {
  shippingFee?: number | null;
  customsDuty?: number | null;
  customsTax?: number | null;
  brokerageFee?: number | null;
  additionalFee?: number | null;
}

export interface LandedCostBreakdown {
  shippingFee: number;
  customsDuty: number;
  customsTax: number;
  brokerageFee: number;
  additionalFee: number;
  /** Sum of the five fees above. */
  total: number;
}

/** One purchase order line after the receipt's fees have been spread across it. */
export interface LineAllocation {
  itemId: number;
  /** Units on *this* shipment (not the ordered quantity). */
  quantity: number;
  /** quantity x unitPrice, before fees. */
  lineTotal: number;
  /** This line's share of the receipt's fees. */
  allocatedCost: number;
  /** unitPrice + allocatedCost / quantity - the true cost of one unit on this shipment. */
  landedCostPerUnit: number;
}

/** A line that arrived: which order line, and how many units. */
export interface ReceiptLineInput {
  itemId: number;
  quantity: number;
}

export interface ReceiveGoodsInput extends LandedCostInput {
  purchaseOrderId: number;
  userId: number;
  actualDeliveryDate: Date;
  /**
   * Which lines arrived and how many units of each.
   * Omit it to receive everything that is still outstanding (a complete delivery).
   */
  items?: ReceiptLineInput[];
  /** What the "additional fee" was for. */
  additionalFeeNote?: string | null;
  notes?: string | null;
}

export interface ReceiveGoodsResult {
  receipt: typeof goodsReceipts.$inferSelect;
  costs: LandedCostBreakdown;
  /** One entry per line that arrived on this receipt. */
  allocations: LineAllocation[];
  /** True when this receipt completed the last outstanding line. */
  fullyReceived: boolean;
  /** Units still owed by the supplier after this receipt. */
  outstandingQuantity: number;
}

/**
 * Round to 2 decimals, the precision of every money column here. VND has no cents, but the
 * schema is NUMERIC(15,2) and import quotes are decimal, so keep the type honest.
 */
function money(value: number | null | undefined): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Normalise the raw form input into the six figures shown on the receipt. */
export function landedCostBreakdown(input: LandedCostInput): LandedCostBreakdown {
  const shippingFee = money(input.shippingFee);
  const customsDuty = money(input.customsDuty);
  const customsTax = money(input.customsTax);
  const brokerageFee = money(input.brokerageFee);
  const additionalFee = money(input.additionalFee);

  return {
    shippingFee,
    customsDuty,
    customsTax,
    brokerageFee,
    additionalFee,
    total: money(shippingFee + customsDuty + customsTax + brokerageFee + additionalFee),
  };
}

/**
 * Spread the receipt's total fees across the lines by value.
 *
 * AI Agent Note: the last line absorbs the rounding remainder, so the allocations always
 * add back up to the receipt total. Without that, allocating 100 VND over three equal lines
 * gives 33.33 x 3 = 99.99 and the landed cost of the order silently loses a cent.
 */
export function allocateLandedCost(
  totalAdditionalCost: number,
  lines: Array<{ id: number; quantity: number; unitPrice: number }>
): LineAllocation[] {
  const grandTotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  let allocated = 0;

  return lines.map((line, index) => {
    const lineTotal = money(line.quantity * line.unitPrice);
    const isLast = index === lines.length - 1;

    const share = isLast
      ? money(totalAdditionalCost - allocated)
      : money(grandTotal > 0 ? (totalAdditionalCost * lineTotal) / grandTotal : 0);

    allocated = money(allocated + share);

    return {
      itemId: line.id,
      quantity: line.quantity,
      lineTotal,
      allocatedCost: share,
      landedCostPerUnit:
        line.quantity > 0 ? money(line.unitPrice + share / line.quantity) : money(line.unitPrice),
    };
  });
}


/**
 * Book goods in: create the receipt, stock what actually arrived, spread *this shipment's* fees
 * over the units that carried them, and advance the order.
 *
 * AI Agent Note: always pass the caller's transaction (`db.transaction((tx) => receiveGoods(tx, ...))`).
 * The receipt row, the stock movements and the status change must commit together - a
 * receipt that says "goods arrived" while the stock ledger stayed empty is worse than no
 * receipt at all.
 *
 * Partial deliveries are the normal case, not an exception: `input.items` says which lines
 * arrived and how many units. Leave it out to receive everything still outstanding. The order
 * only becomes `delivered` once every line is complete, so a short delivery stays open for the
 * rest of the shipment instead of quietly closing itself.
 */
export async function receiveGoods(
  executor: DbClient,
  input: ReceiveGoodsInput
): Promise<ReceiveGoodsResult> {
  const order = await executor.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, input.purchaseOrderId),
  });

  if (!order) {
    throw new StockError("Purchase order not found", 404);
  }

  if (order.status === "cancelled") {
    throw new StockError(
      `Purchase order ${order.orderNumber} is cancelled`,
      400,
      "Create a new purchase order instead of receiving a cancelled one."
    );
  }

  // Idempotency guard for completed orders: stock must never be added twice for the same
  // delivery. Orders received before line tracking existed are covered here too.
  if (order.status === "delivered") {
    throw new StockError(
      `Purchase order ${order.orderNumber} has already been received`,
      409,
      "Its goods receipts are complete - raise a new purchase order for anything still missing."
    );
  }

  // Existing business rule: stock is not booked in before the supplier is paid.
  const paymentSent = await executor.query.purchaseOrderActions.findFirst({
    where: and(
      eq(purchaseOrderActions.purchaseOrderId, order.id),
      eq(purchaseOrderActions.actionType, "payment_sent")
    ),
  });

  if (!paymentSent) {
    throw new StockError(
      "Payment must be sent before goods can be received",
      400,
      "Record 'Payment Sent' on the order first."
    );
  }

  const orderItems = await executor.query.purchaseOrderItems.findMany({
    where: eq(purchaseOrderItems.purchaseOrderId, order.id),
  });

  if (orderItems.length === 0) {
    throw new StockError("This purchase order has no items to receive", 400);
  }

  const itemsById = new Map(orderItems.map((item) => [item.id, item]));
  const receivedUnits = (item: (typeof orderItems)[number]) => item.deliveredQuantity ?? 0;
  const outstandingUnits = (item: (typeof orderItems)[number]) =>
    Math.max(0, item.quantity - receivedUnits(item));

  // No explicit lines means "everything still owed" - the one-click complete delivery.
  const requested: ReceiptLineInput[] = input.items?.length
    ? input.items
    : orderItems
        .filter((item) => outstandingUnits(item) > 0)
        .map((item) => ({ itemId: item.id, quantity: outstandingUnits(item) }));

  const seen = new Set<number>();
  const lines = requested.map((request) => {
    const item = itemsById.get(request.itemId);

    if (!item) {
      throw new StockError(
        `Line ${request.itemId} is not part of purchase order ${order.orderNumber}`,
        400,
        "Reload the order - its lines may have changed."
      );
    }

    if (seen.has(item.id)) {
      throw new StockError(
        `Line ${item.id} is listed twice on this receipt`,
        400,
        "Send one quantity per line."
      );
    }
    seen.add(item.id);

    if (!Number.isInteger(request.quantity) || request.quantity <= 0) {
      throw new StockError(
        "Received quantity must be a whole number greater than zero",
        400,
        "Enter how many units actually arrived on this line."
      );
    }

    const outstanding = outstandingUnits(item);

    // The stock ledger must never be credited for units the supplier has not delivered.
    if (request.quantity > outstanding) {
      throw new StockError(
        `Only ${outstanding} of ${item.quantity} units are outstanding on line ${item.id}`,
        409,
        "Receive at most the outstanding quantity, or correct the order lines."
      );
    }

    return { item, quantity: request.quantity };
  });

  if (lines.length === 0) {
    const existingReceipts = await executor.query.goodsReceipts.findMany({
      where: eq(goodsReceipts.purchaseOrderId, order.id),
      orderBy: [desc(goodsReceipts.createdAt)],
    });

    throw new StockError(
      `Purchase order ${order.orderNumber} has already been received in full`,
      409,
      existingReceipts.length > 0
        ? `Booked in on ${existingReceipts.length} receipt(s), the latest being ${existingReceipts[0].receiptNumber}.`
        : "See the order history for the receipt that booked it in."
    );
  }

  const costs = landedCostBreakdown(input);
  // Fees are spread over the units on *this* shipment only - a later shipment carries its own.
  const allocations = allocateLandedCost(
    costs.total,
    lines.map((line) => ({
      id: line.item.id,
      quantity: line.quantity,
      unitPrice: Number(line.item.unitPrice),
    }))
  );

  // What this shipment carried, line by line. `allocations` is index-aligned with `lines`.
  const receiptLines = lines.map((line, index) => ({
    ...line,
    allocation: allocations[index],
  }));

  const actualDeliveryDate =
    input.actualDeliveryDate instanceof Date
      ? input.actualDeliveryDate
      : new Date(input.actualDeliveryDate);

  const [receipt] = await executor
    .insert(goodsReceipts)
    .values({
      purchaseOrderId: order.id,
      receiptNumber: generateReceiptNumber(),
      actualDeliveryDate,
      shippingFee: costs.shippingFee.toFixed(2),
      customsDuty: costs.customsDuty.toFixed(2),
      customsTax: costs.customsTax.toFixed(2),
      brokerageFee: costs.brokerageFee.toFixed(2),
      additionalFee: costs.additionalFee.toFixed(2),
      additionalFeeNote: input.additionalFeeNote?.trim() || null,
      totalAdditionalCost: costs.total.toFixed(2),
      notes: input.notes?.trim() || null,
      receivedByUserId: input.userId,
    })
    .returning();

  await executor.insert(goodsReceiptItems).values(
    receiptLines.map((line) => ({
      goodsReceiptId: receipt.id,
      purchaseOrderItemId: line.item.id,
      quantity: line.quantity,
      unitPrice: Number(line.item.unitPrice).toFixed(2),
      allocatedCost: line.allocation.allocatedCost.toFixed(2),
      landedCostPerUnit: line.allocation.landedCostPerUnit.toFixed(2),
    }))
  );

  // Stock in, per line, at the destination warehouse (falls back to the DC pool when the
  // order was raised before destination warehouses existed).
  for (const line of receiptLines) {
    const item = line.item;
    const receivedQuantity = line.quantity;
    const [currentInventory] = await executor
      .select({ id: inventory.id, quantity: inventory.quantity })
      .from(inventory)
      .where(
        and(
          eq(inventory.productId, item.productId),
          order.destinationStoreId
            ? eq(inventory.storeId, order.destinationStoreId)
            : eq(inventory.inventoryType, "DC")
        )
      )
      .limit(1);

    if (currentInventory) {
      await applyStockChange(executor, {
        inventoryId: currentInventory.id,
        delta: receivedQuantity,
        reason: "po_receipt",
        transactionType: "PURCHASE_ORDER",
        productId: item.productId,
        storeId: order.destinationStoreId ?? null,
        refType: "purchase_order",
        refId: order.id,
        userId: input.userId,
        note: `Goods receipt ${receipt.receiptNumber}`,
      });
    } else {
      const product = await executor.query.products.findFirst({
        where: eq(products.id, item.productId),
      });

      if (!product) {
        throw new StockError(`Product with ID ${item.productId} not found`, 400);
      }

      const [createdInventory] = await executor
        .insert(inventory)
        .values({
          productId: item.productId,
          quantity: receivedQuantity,
          inventoryType: "DC",
          storeId: order.destinationStoreId,
          barcode: generateInventoryBarcode(
            "DC",
            item.productId.toString(),
            order.destinationStoreId
          ),
          supplierId: order.supplierId,
          purchaseDate: actualDeliveryDate.toISOString().split("T")[0],
        })
        .returning({ id: inventory.id });

      // The new row starts at receivedQuantity - record that as its opening balance so the
      // ledger still adds up to inventory.quantity for this row.
      await recordOpeningStock(executor, {
        inventoryId: createdInventory.id,
        quantity: receivedQuantity,
        reason: "po_receipt",
        transactionType: "PURCHASE_ORDER",
        productId: item.productId,
        storeId: order.destinationStoreId ?? null,
        refType: "purchase_order",
        refId: order.id,
        userId: input.userId,
      });
    }
  }

  // Advance the running delivered quantity and re-average the line's true unit cost.
  //
  // AI Agent Note: two shipments rarely carry the same freight, so the line's landed cost is a
  // quantity-weighted average of every receipt that has landed so far. Overwriting it with the
  // latest shipment's figure would misprice the units that arrived earlier.
  const outstandingByItem = new Map<number, number>(
    orderItems.map((item) => [item.id, outstandingUnits(item)])
  );

  for (const { item, quantity, allocation } of receiptLines) {
    const previousUnits = receivedUnits(item);
    const previousUnitCost =
      item.landedCostPerUnit != null
        ? Number(item.landedCostPerUnit)
        : Number(item.unitPrice);
    const mergedUnits = previousUnits + quantity;

    const blendedUnitCost =
      mergedUnits > 0
        ? money(
            (previousUnits * previousUnitCost + quantity * allocation.landedCostPerUnit) /
              mergedUnits
          )
        : allocation.landedCostPerUnit;

    await executor
      .update(purchaseOrderItems)
      .set({
        deliveredQuantity: mergedUnits,
        landedCostPerUnit: blendedUnitCost.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrderItems.id, item.id));

    outstandingByItem.set(item.id, Math.max(0, item.quantity - mergedUnits));
  }

  const outstandingQuantity = Array.from(outstandingByItem.values()).reduce(
    (sum, units) => sum + units,
    0
  );
  const fullyReceived = outstandingQuantity === 0;

  // AI Agent Note: only the status changes - deliveryDate stays the *expected* date so the
  // actual date on the goods receipt can be compared against it. A partial delivery leaves the
  // status alone: the order is still owed goods.
  if (fullyReceived) {
    await executor
      .update(purchaseOrders)
      .set({ status: "delivered", updatedAt: new Date() })
      .where(eq(purchaseOrders.id, order.id));
  }

  await executor.insert(purchaseOrderActions).values({
    purchaseOrderId: order.id,
    actionType: "goods_receipt",
    actionData: {
      reference: receipt.receiptNumber,
      // Only the units on this shipment - the running total lives on the order lines.
      quantity: receiptLines.reduce((sum, line) => sum + line.quantity, 0),
      partial: !fullyReceived,
      notes: input.notes ?? undefined,
    },
    performedByUserId: input.userId,
  });

  return { receipt, costs, allocations, fullyReceived, outstandingQuantity };
}

