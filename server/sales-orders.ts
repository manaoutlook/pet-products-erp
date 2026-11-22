import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  customerProfiles,
  deliveryNoteItems,
  deliveryNotes,
  products,
  salesOrderItems,
  salesOrders,
} from "@db/schema";
import {
  SALES_ORDER_PRICING_HINT,
  describeMissingSalesOrderPrices,
  findMissingSalesOrderPrices,
} from "../shared/sales-order-prices";
import type { DbClient } from "./db-types";
import { generateDeliveryNoteNumber } from "./numbering";
import { issueDeliveryNoteStock, restoreDeliveryNoteStock } from "./sales-order-stock";

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
 *
 * Units leaving the warehouse is only half of a delivery: the printed note travels with the
 * goods and comes back signed. Until every note carrying those units has its signed copy on
 * file the order reads `awaiting_signature`, and filing the picture is what finally makes it
 * `delivered` - see `attachSignedDocument`.
 */

export type SalesOrderStatus =
  | "open"
  | "partially_delivered"
  | "awaiting_signature"
  | "delivered"
  | "cancelled";

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
 * Derive the order status from its lines and the notes that carried them.
 *
 * Pure on purpose: this is the whole rule ("nothing delivered / some delivered / everything
 * delivered but not signed off / everything delivered and signed") and it is unit-tested
 * without a database. `unsignedNotes` is the number of delivery notes on this order whose
 * signed copy has not been filed yet - a delivery note is printed unsigned and only becomes
 * proof of delivery once the customer's signature comes back.
 */
export function summariseStatus(
  lines: Array<{ quantity: number; deliveredQuantity: number }>,
  current: SalesOrderStatus = "open",
  unsignedNotes = 0
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

  if (ordered > 0 && delivered >= ordered) {
    // Everything shipped, but the paperwork is not closed: the customer has not signed (or
    // the office has not filed the picture of the signed note) for at least one shipment.
    return unsignedNotes > 0 ? "awaiting_signature" : "delivered";
  }
  if (delivered > 0) return "partially_delivered";
  return "open";
}

/**
 * Recompute and persist `sales_orders.status` from its lines and unsigned delivery notes.
 *
 * Always pass the caller's transaction (`db.transaction((tx) => ...)`) so the status change
 * commits together with the delivery note (or signed copy) that caused it.
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

  // A cancelled note never counted as delivery, so it cannot hold the order back either.
  const unsignedNotes = await executor
    .select({ id: deliveryNotes.id })
    .from(deliveryNotes)
    .where(
      and(
        eq(deliveryNotes.salesOrderId, salesOrderId),
        ne(deliveryNotes.status, "cancelled"),
        isNull(deliveryNotes.signedDocumentUrl)
      )
    );

  const status = summariseStatus(lines, order.status as SalesOrderStatus, unsignedNotes.length);


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
      // Snapshot of where the units come off. The note is the goods issue, so this is the
      // inventory row deducted below - a later move of the order must not rewrite it.
      storeId: order.storeId,
      // The order decided which company issues the paperwork; the note carries the same
      // snapshot so a reprint keeps the letterhead that was on the signed sheet.
      vatCompanyId: order.vatCompanyId,
      vatCompanyCode: order.vatCompanyCode,
      vatCompanyName: order.vatCompanyName,
      vatCompanyTaxId: order.vatCompanyTaxId,
      vatCompanyAddress: order.vatCompanyAddress,
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

  // The goods issue: the units leave `delivery_notes.store_id`'s inventory row here, with a
  // `SALES_ORDER` movement pointing at this note. It runs in the same transaction as everything
  // above, so a note that cannot be covered by the shelf never reaches the customer.
  await issueDeliveryNoteStock(executor, {
    deliveryNoteId: deliveryNote.id,
    salesOrderNumber: order.orderNumber,
    storeId: deliveryNote.storeId,
    lines: resolvedLines.map((line) => ({
      productId: line.item.productId,
      productCode: line.item.productCode,
      quantity: line.deliveredQuantity,
    })),
    userId: input.userId,
  });

  const status = await recalculateSalesOrderStatus(executor, order.id);

  const shipped = resolvedLines.reduce((sum, line) => sum + line.deliveredQuantity, 0);

  return {
    deliveryNote,
    items: insertedItems,
    status,
    outstandingQuantity: Math.max(0, outstanding - shipped),
  };
}

export interface AttachSignedDocumentInput {
  deliveryNoteId: number;
  /** Public URL returned by `saveSignedDeliveryNoteDocument`. */
  signedDocumentUrl: string;
  /** Who filed the picture - shown next to the uploaded date. */
  userId: number;
}

/**
 * File the picture of the note the customer signed.
 *
 * The note is otherwise never edited after issue; this is the one exception, and it only ever
 * adds the proof of delivery - the document URL, who filed it and when, plus the "goods received
 * in good condition" tick the printed sheet carries, so a reprint matches the signed copy.
 * A cancelled note is refused, and re-filing replaces the previous picture (a blurry first photo
 * of the sheet is the common case).
 *
 * The signed copy is what closes the delivery, so the order is re-derived here: filing the last
 * outstanding signature flips it from `awaiting_signature` to `delivered`.
 */
export async function attachSignedDocument(
  executor: DbClient,
  input: AttachSignedDocumentInput
): Promise<typeof deliveryNotes.$inferSelect> {
  const [existing] = await executor
    .select()
    .from(deliveryNotes)
    .where(eq(deliveryNotes.id, input.deliveryNoteId));

  if (!existing) {
    throw new SalesOrderError(
      `Delivery note ${input.deliveryNoteId} was not found`,
      404,
      "Refresh the list and try again."
    );
  }

  if (existing.status === "cancelled") {
    throw new SalesOrderError(
      `Delivery note ${existing.deliveryNoteNumber} was cancelled and cannot be signed off`,
      409,
      "Issue a new delivery note for these goods instead."
    );
  }

  const [updated] = await executor
    .update(deliveryNotes)
    .set({
      signedDocumentUrl: input.signedDocumentUrl,
      signedDocumentUploadedAt: new Date(),
      signedDocumentUploadedByUserId: input.userId,
      // The uploaded picture *is* the customer's signature.
      customerConfirmed: true,
      updatedAt: new Date(),
    })
    .where(eq(deliveryNotes.id, existing.id))
    .returning();

  // The order only reads `delivered` once every shipment's signed copy is on file.
  await recalculateSalesOrderStatus(executor, updated.salesOrderId);

  return updated;
}

export interface CancelDeliveryNoteInput {
  deliveryNoteId: number;
  /** Who cancelled it - kept on the note and on the stock movement. */
  userId: number;
  reason?: string | null;
}

export interface CancelDeliveryNoteResult {
  deliveryNote: typeof deliveryNotes.$inferSelect;
  orderStatus: SalesOrderStatus;
  /** Units put back on the shelf; 0 when the note was already cancelled. */
  restoredUnits: number;
}

/**
 * Cancel a delivery note and put its units back on the shelf.
 *
 * Cancelling is the reverse of issuing, never a delete: the note keeps its number and lines
 * (the customer may still hold the paper), its status becomes `cancelled`, and the units it
 * took off come back through a `cancel` / `RETURN` stock movement on the location it shipped
 * from. The order's line tallies are decremented and the status re-derived, so a fully
 * cancelled shipment makes the order deliverable - and cancellable - again.
 *
 * Refused once the goods are real: a note the customer signed (`signedDocumentUrl` or
 * `customerConfirmed`) or an order carrying a VAT invoice must be handled as a return /
 * credit note instead, because neither the customer's proof of delivery nor the tax document
 * can be undone by a status flip.
 *
 * Idempotent: a note that is already cancelled is returned untouched, so a double click never
 * restocks twice. The status flip is conditional for the same reason.
 */
export async function cancelDeliveryNote(
  executor: DbClient,
  input: CancelDeliveryNoteInput
): Promise<CancelDeliveryNoteResult> {
  const note = await executor.query.deliveryNotes.findFirst({
    where: eq(deliveryNotes.id, input.deliveryNoteId),
  });

  if (!note) {
    throw new SalesOrderError(
      `Delivery note ${input.deliveryNoteId} was not found`,
      404,
      "Refresh the list and try again."
    );
  }

  const order = await executor.query.salesOrders.findFirst({
    where: eq(salesOrders.id, note.salesOrderId),
    columns: {
      id: true,
      orderNumber: true,
      status: true,
      vatInvoiceNumber: true,
    },
  });

  if (!order) {
    throw new SalesOrderError(
      `Sales order ${note.salesOrderId} was not found`,
      404,
      "Refresh the list and try again."
    );
  }

  if (note.status === "cancelled") {
    return {
      deliveryNote: note,
      orderStatus: order.status as SalesOrderStatus,
      restoredUnits: 0,
    };
  }

  if (order.status === "cancelled") {
    throw new SalesOrderError(
      `Sales order ${order.orderNumber} is cancelled`,
      409,
      "Refresh the list - this note belongs to a cancelled order."
    );
  }

  if (note.signedDocumentUrl || note.customerConfirmed) {
    throw new SalesOrderError(
      `Delivery note ${note.deliveryNoteNumber} is signed by the customer and cannot be cancelled`,
      409,
      "The goods were received. Record this as a return so the stock and the paperwork agree."
    );
  }

  if (order.vatInvoiceNumber) {
    throw new SalesOrderError(
      `Sales order ${order.orderNumber} carries VAT invoice ${order.vatInvoiceNumber}`,
      409,
      "A tax invoice was already issued for these goods. Raise a return / credit note instead."
    );
  }

  // The lines are joined back to the order for the product id: the note stores the code and
  // description the customer saw, but the shelf is addressed by product.
  const lines = await executor
    .select({
      salesOrderItemId: deliveryNoteItems.salesOrderItemId,
      productId: salesOrderItems.productId,
      productCode: salesOrderItems.productCode,
      quantity: deliveryNoteItems.deliveredQuantity,
    })
    .from(deliveryNoteItems)
    .innerJoin(salesOrderItems, eq(deliveryNoteItems.salesOrderItemId, salesOrderItems.id))
    .where(eq(deliveryNoteItems.deliveryNoteId, note.id));

  const reason = input.reason?.trim() ? input.reason.trim() : null;
  const now = new Date();

  // Conditional flip: two operators clicking Cancel at the same moment must not both restock.
  const [cancelledNote] = await executor
    .update(deliveryNotes)
    .set({
      status: "cancelled",
      cancelledAt: now,
      cancelledByUserId: input.userId,
      cancelReason: reason,
      updatedAt: now,
    })
    .where(and(eq(deliveryNotes.id, note.id), eq(deliveryNotes.status, "issued")))
    .returning();

  if (!cancelledNote) {
    // Lost the race - the other cancellation already restored the stock.
    const [current] = await executor
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, note.id));
    const [currentOrder] = await executor
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, note.salesOrderId));

    return {
      deliveryNote: current ?? note,
      orderStatus: (currentOrder?.status ?? order.status) as SalesOrderStatus,
      restoredUnits: 0,
    };
  }

  const restoredUnits = await restoreDeliveryNoteStock(executor, {
    deliveryNoteId: note.id,
    deliveryNoteNumber: note.deliveryNoteNumber,
    salesOrderNumber: order.orderNumber,
    storeId: note.storeId,
    lines: lines.map((line) => ({
      productId: line.productId,
      productCode: line.productCode,
      quantity: line.quantity,
    })),
    userId: input.userId,
    reason,
  });

  for (const line of lines) {
    await executor
      .update(salesOrderItems)
      .set({
        // Clamped: the tally must never go negative if a note somehow carried more than the
        // line still shows as delivered.
        deliveredQuantity: sql`greatest(${salesOrderItems.deliveredQuantity} - ${line.quantity}, 0)`,
        updatedAt: now,
      })
      .where(
        and(
          eq(salesOrderItems.id, line.salesOrderItemId),
          eq(salesOrderItems.salesOrderId, note.salesOrderId)
        )
      );
  }

  const orderStatus = await recalculateSalesOrderStatus(executor, note.salesOrderId);

  return {
    deliveryNote: cancelledNote,
    orderStatus,
    restoredUnits,
  };
}

/**
 * One-off repair for orders that were closed before signatures were required.
 *
 * Orders delivered under the old rule sit at `delivered` while one of their notes still has no
 * signed copy. Booting runs this single statement so the list stops claiming a delivery is
 * complete when the paper trail is not - a signed copy filed later flips them back through
 * `recalculateSalesOrderStatus`. Safe to run on every boot (it matches nothing once repaired).
 */
export async function resyncUnsignedDeliveredOrders(executor: DbClient): Promise<number> {
  const repaired = await executor
    .update(salesOrders)
    .set({ status: "awaiting_signature", updatedAt: new Date() })
    .where(
      and(
        eq(salesOrders.status, "delivered"),
        sql`exists (
          select 1
            from delivery_notes n
           where n.sales_order_id = ${salesOrders.id}
             and n.status <> 'cancelled'
             and n.signed_document_url is null
        )`
      )
    )
    .returning({ id: salesOrders.id });

  return repaired.length;
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
 * The buyer tax code belongs to Customer Master.
 *
 * When the order names a saved customer, the profile's current `tax_id` is the authority: a
 * stale tab (or a hand-written request) must not be able to put a different code onto the
 * order. Orders without a profile (walk-ins / legacy rows) keep the value the form sent. The
 * code is still snapshotted onto the order so an issued document never changes afterwards.
 */
export async function resolveCustomerTaxId(
  executor: DbClient,
  customerProfileId: number | null | undefined,
  submittedTaxId: string | null
): Promise<string | null> {
  if (!customerProfileId) return submittedTaxId;

  const [profile] = await executor
    .select({ taxId: customerProfiles.taxId })
    .from(customerProfiles)
    .where(eq(customerProfiles.id, customerProfileId))
    .limit(1);

  return profile ? profile.taxId ?? null : submittedTaxId;
}

/**
 * Turn the submitted lines into insertable rows.
 *
 * AI Agent Note: product code/description/price are read from the catalogue here, and the line
 * total is always recomputed. Trusting the client's `totalPrice` would let a stale tab (or a
 * hand-crafted request) store an order that does not add up to its own unit prices.
 *
 * `requirePrices` (default on) refuses a product whose Landing / B2B / B2C price is still blank
 * in the product master. It is relaxed for edits so an order raised before this rule existed
 * stays editable - fixing it means filling the product in, not losing the order.
 */
export async function buildSalesOrderLines(
  executor: DbClient,
  lines: SalesOrderLineInput[],
  options: { requirePrices?: boolean } = {}
): Promise<{ lines: ResolvedOrderLine[]; total: number }> {
  const requirePrices = options.requirePrices ?? true;
  const productIds = Array.from(new Set(lines.map((line) => line.productId)));

  const catalogue = await executor
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      price: products.price,
      landingPrice: products.landingPrice,
      b2bPrice: products.b2bPrice,
      b2cPrice: products.b2cPrice,
    })
    .from(products)
    .where(inArray(products.id, productIds));

  // A product that cannot be priced cannot be sold. Refusing here (rather than letting the
  // line through at 0) keeps every later document honest: the delivery note and the VAT
  // invoice print these numbers, and the VAT margin statement needs landing + B2B prices
  // to work out the split at all.
  if (requirePrices) {
    const missingPrices = findMissingSalesOrderPrices(
      catalogue.map((product) => ({
        productCode: product.sku,
        productName: product.name,
        landingPrice: product.landingPrice,
        b2bPrice: product.b2bPrice,
        b2cPrice: product.b2cPrice,
      }))
    );

    if (missingPrices.length > 0) {
      throw new SalesOrderError(
        describeMissingSalesOrderPrices(missingPrices),
        400,
        SALES_ORDER_PRICING_HINT
      );
    }
  }

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

