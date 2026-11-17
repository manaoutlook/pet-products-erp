import { and, eq, isNull } from "drizzle-orm";
import { db } from "@db";
import { salesOrderItems, salesOrders } from "@db/schema";
import { generateVatCompanyInvoiceNumber } from "./invoice-counter";
import { computeSaleTotals, toVatRate } from "../shared/tax";
import { vatCompanyMissingFields } from "../shared/vat-company";
import type { InvoiceLine, SalesOrderInvoicePayload } from "../shared/invoice";

/**
 * The VAT invoice issued for a Sales Order.
 *
 * AI Agent Note - why this is not a `sales_transactions` row:
 * The till invoice is the record of a counter sale that moved stock and took payment. A sales
 * order invoice is the tax document for goods shipped against an order; the money and the
 * goods are already on the order and its delivery notes. What it needs is exactly two extra
 * facts, both stored on `sales_orders`:
 *
 *   - WHO issues it: `vat_company_id` + the name/tax-id/address snapshot taken when the order
 *     was raised (never a live read, so a later edit cannot rewrite an issued invoice);
 *   - WHICH number it has: `vat_invoice_number`, allocated once from that company's own
 *     sequence (`CI-...` / `HI-...`) and then never changed.
 *
 * The numbers printed are the stored order totals plus VAT at the rate stored on the order
 * (copied from the issuing company when the order was saved); they are not derived from
 * anything else. A correction is a new order with a new number - an issued invoice is never
 * edited.
 */

export class SalesOrderInvoiceError extends Error {
  status: number;
  suggestion?: string;

  constructor(message: string, status = 400, suggestion?: string) {
    super(message);
    this.name = "SalesOrderInvoiceError";
    this.status = status;
    this.suggestion = suggestion;
  }
}

type OrderWithItems = typeof salesOrders.$inferSelect & {
  items: Array<typeof salesOrderItems.$inferSelect>;
};

/** Shape the stored order into the document payload. Pure, so the route and tests agree. */
export function buildSalesOrderInvoicePayload(order: OrderWithItems): SalesOrderInvoicePayload {
  const lines: InvoiceLine[] = order.items.map((item, index) => ({
    lineNumber: index + 1,
    productCode: item.productCode,
    description: item.description,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    lineTotal: Number(item.totalPrice),
  }));

  // The order total is VAT-exclusive; VAT is added on top at the rate snapshotted from the
  // issuing company when the order was saved (`sales_orders.vat_rate`), so an invoice keeps
  // its rate even after that company's rate is corrected.
  const subtotal = Number(order.totalAmount);
  const totals = computeSaleTotals(subtotal, true, toVatRate(order.vatRate));

  return {
    salesOrderId: order.id,
    orderNumber: order.orderNumber,
    invoiceNumber: order.vatInvoiceNumber ?? "",
    invoiceDate: (order.vatInvoiceIssuedAt ?? order.orderDate ?? new Date()).toISOString(),
    seller: {
      name: order.vatCompanyName ?? "",
      taxId: order.vatCompanyTaxId ?? "",
      address: order.vatCompanyAddress ?? "",
      phone: null,
      email: null,
      bankAccount: null,
    },
    sellerMissingFields: vatCompanyMissingFields({
      name: order.vatCompanyName,
      taxId: order.vatCompanyTaxId,
      address: order.vatCompanyAddress,
    }),
    buyer: {
      // A business buyer is addressed by its company; a consumer has only a name.
      name: order.companyName?.trim() || order.customerName,
      companyName: order.companyName ?? null,
      taxId: order.customerTaxId ?? null,
      address: order.deliveryAddress ?? null,
      phone: order.phone ?? null,
      email: null,
    },
    lines,
    subtotal: totals.subtotal,
    vatRate: totals.vatRate,
    vatAmount: totals.vatAmount,
    total: totals.total,
    currency: "VND",
  };
}


/** The invoice of an order that has already been issued, or a 404 explaining what to do. */
export async function getSalesOrderInvoice(orderId: number): Promise<SalesOrderInvoicePayload> {
  const order = await db.query.salesOrders.findFirst({
    where: eq(salesOrders.id, orderId),
    with: { items: { orderBy: [salesOrderItems.id] } },
  });

  if (!order) {
    throw new SalesOrderInvoiceError("Sales order not found", 404);
  }

  if (!order.vatInvoiceNumber) {
    throw new SalesOrderInvoiceError(
      `No VAT invoice has been issued for ${order.orderNumber}`,
      404,
      "Issue the invoice from the order first - the number comes from the VAT company's sequence."
    );
  }

  return buildSalesOrderInvoicePayload(order as OrderWithItems);
}

/**
 * Issue (or re-open) the VAT invoice of an order.
 *
 * The number is taken from the selected company's counter inside the same transaction as the
 * order update, so a failed request cannot burn a number out of the tax book. Issuing twice
 * returns the first number instead of allocating a second one.
 */
export async function issueSalesOrderInvoice(
  orderId: number
): Promise<SalesOrderInvoicePayload> {
  return db.transaction(async (tx) => {
    const order = await tx.query.salesOrders.findFirst({
      where: eq(salesOrders.id, orderId),
      with: { items: { orderBy: [salesOrderItems.id] } },
    });

    if (!order) {
      throw new SalesOrderInvoiceError("Sales order not found", 404);
    }

    if (!order.vatCompanyId || !order.vatCompanyCode || !order.vatCompanyName) {
      throw new SalesOrderInvoiceError(
        `${order.orderNumber} is not a VAT sales order`,
        409,
        "Edit the order, choose the VAT company, and save it before issuing an invoice."
      );
    }

    if (order.status === "cancelled") {
      throw new SalesOrderInvoiceError(
        `${order.orderNumber} is cancelled and cannot be invoiced`,
        409,
        "Raise a new sales order for the customer instead."
      );
    }

    if (order.items.length === 0) {
      throw new SalesOrderInvoiceError(
        `${order.orderNumber} has no lines to invoice`,
        409,
        "Add the products to the order first."
      );
    }

    const missing = vatCompanyMissingFields({
      name: order.vatCompanyName,
      taxId: order.vatCompanyTaxId,
      address: order.vatCompanyAddress,
    });

    if (missing.length > 0) {
      throw new SalesOrderInvoiceError(
        `VAT company ${order.vatCompanyCode} cannot issue an invoice yet`,
        409,
        `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing. ` +
          "Complete it under Master Data -> VAT Companies, then raise a new order."
      );
    }

    // Already issued: return the same document. Never allocate a second number.
    if (order.vatInvoiceNumber) {
      return buildSalesOrderInvoicePayload(order as OrderWithItems);
    }

    const invoiceNumber = await generateVatCompanyInvoiceNumber(
      order.vatCompanyId,
      order.vatCompanyCode,
      tx
    );
    const issuedAt = new Date();

    // Conditional update: if a concurrent request already wrote a number, this matches no row
    // and the caller is told to reload instead of receiving a number that was not stored.
    const [updated] = await tx
      .update(salesOrders)
      .set({
        vatInvoiceNumber: invoiceNumber,
        vatInvoiceIssuedAt: issuedAt,
        updatedAt: issuedAt,
      })
      .where(and(eq(salesOrders.id, orderId), isNull(salesOrders.vatInvoiceNumber)))
      .returning();

    if (!updated) {
      throw new SalesOrderInvoiceError(
        "The invoice was already issued by another user",
        409,
        "Reload the order and print the issued invoice."
      );
    }

    return buildSalesOrderInvoicePayload({
      ...order,
      vatInvoiceNumber: invoiceNumber,
      vatInvoiceIssuedAt: issuedAt,
    } as OrderWithItems);
  });
}
