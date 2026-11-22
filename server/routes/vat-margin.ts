import type { Express, Response } from "express";
import { z } from "zod";
import { asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@db";
import { deliveryNotes, products, salesOrderItems, salesOrders } from "@db/schema";
import { requirePermission } from "../middleware";
import { validateBody } from "../validate";
import {
  computeVatMarginStatement,
  type VatMarginSourceLine,
} from "../../shared/vat-margin";

import { readVatMarginSettings, saveVatMarginSettings } from "../vat-margin-settings";

/**
 * VAT Margin Calculator endpoints.
 *
 * A VAT company issues the invoice for a sales order, but what SmartLife and the company each
 * keep is agreed afterwards, on a spreadsheet. This route turns one document into that
 * spreadsheet:
 *
 *   GET /api/vat-margin/settings    - the global income tax / margin defaults
 *   PUT /api/vat-margin/settings    - save them
 *   GET /api/vat-margin/documents   - what can be picked, for one document type
 *   GET /api/vat-margin/statement   - the per-line split for one document
 *
 * Permission module: `vatMargin`. The split is partner-only information, so it is granted on its
 * own rather than implied by `orders`: reading a statement needs `vatMargin.read`, saving the
 * global defaults needs `vatMargin.update`.
 *
 * AI Agent Note: the arithmetic lives in `shared/vat-margin.ts`, not here - this file only joins
 * the order lines to the products. Landing price and B2B price are read LIVE from `products`
 * (not from the line snapshot), because the point of the calculator is to reconcile today's
 * catalogue cost against what was invoiced. A product whose price is still blank therefore
 * produces a named error instead of a silent zero: a wrong statement sent to a tax company is
 * worse than no statement.
 */

const DOCUMENT_TYPES = ["sales_order", "delivery_note", "invoice"] as const;
type VatMarginDocumentType = (typeof DOCUMENT_TYPES)[number];

const documentTypeSchema = z.enum(DOCUMENT_TYPES, {
  errorMap: () => ({ message: "Pick Sales Order, Delivery Note or Invoice" }),
});

const documentsQuerySchema = z.object({
  type: documentTypeSchema,
});

const statementQuerySchema = z.object({
  type: documentTypeSchema,
  id: z.coerce.number().int().positive("Pick a document"),
  // Fractions are optional: anything omitted falls back to the saved global setting.
  profitMarginRate: z.coerce.number().optional(),
  incomeTaxRate: z.coerce.number().optional(),
});

/**
 * Fractions, not percentages (0.2 = 20%) - the same unit as `sales_orders.vat_rate`. The screen
 * converts what the operator types with `percentToRate`.
 */
const settingsSchema = z.object({
  incomeTaxRate: z.number().min(0).max(1).optional(),
  profitMarginRate: z.number().min(0).max(1).optional(),
});

const DOCUMENT_TYPE_LABELS: Record<VatMarginDocumentType, string> = {
  sales_order: "Sales Order",
  delivery_note: "Delivery Note",
  invoice: "Invoice",
};

interface VatMarginDocument {
  /** The id to pass back to `/statement` (the delivery note id for a delivery note). */
  id: number;
  type: VatMarginDocumentType;
  /** The number the operator knows: SO-…, DN-…, or the VAT invoice number. */
  reference: string;
  /** Secondary line for the picker: the order number, customer, or the company. */
  description: string;
  date: string | null;
  salesOrderId: number;
}

/** A `decimal` column as a number; `null` stays `null` (the price was never entered). */
function money(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Every document of one type, newest first, in the shape the picker renders.
 *
 * Invoices are sales orders that have been issued a VAT invoice number - that number, not the
 * order number, is what the tax company knows them by. Delivery notes resolve to their order:
 * the statement always covers the whole order, so a partly delivered note cannot produce a
 * different split from the order it came from.
 */
export async function listVatMarginDocuments(
  type: VatMarginDocumentType
): Promise<VatMarginDocument[]> {
  if (type === "delivery_note") {
    const rows = await db
      .select({
        id: deliveryNotes.id,
        reference: deliveryNotes.deliveryNoteNumber,
        date: deliveryNotes.deliveryDate,
        customerName: deliveryNotes.customerName,
        companyName: deliveryNotes.companyName,
        salesOrderId: deliveryNotes.salesOrderId,
        orderNumber: salesOrders.orderNumber,
      })
      .from(deliveryNotes)
      .innerJoin(salesOrders, eq(deliveryNotes.salesOrderId, salesOrders.id))
      .orderBy(asc(deliveryNotes.deliveryNoteNumber));

    return rows.map((row) => ({
      id: row.id,
      type,
      reference: row.reference,
      description: [row.companyName || row.customerName, row.orderNumber].filter(Boolean).join(" · "),
      date: isoDate(row.date),
      salesOrderId: row.salesOrderId,
    }));
  }

  const rows = type === "invoice"
    ? await db
        .select({
          id: salesOrders.id,
          orderNumber: salesOrders.orderNumber,
          invoiceNumber: salesOrders.vatInvoiceNumber,
          date: salesOrders.orderDate,
          customerName: salesOrders.customerName,
          companyName: salesOrders.companyName,
        })
        .from(salesOrders)
        .where(isNotNull(salesOrders.vatInvoiceNumber))
    : await db
        .select({
          id: salesOrders.id,
          orderNumber: salesOrders.orderNumber,
          invoiceNumber: salesOrders.vatInvoiceNumber,
          date: salesOrders.orderDate,
          customerName: salesOrders.customerName,
          companyName: salesOrders.companyName,
        })
        .from(salesOrders);

  rows.sort((a, b) => b.orderNumber.localeCompare(a.orderNumber));

  return rows.map((row) => ({
    id: row.id,
    type,
    reference: type === "invoice" ? row.invoiceNumber ?? row.orderNumber : row.orderNumber,
    description: [row.companyName || row.customerName, type === "invoice" ? row.orderNumber : ""]
      .filter(Boolean)
      .join(" · "),
    date: isoDate(row.date),
    salesOrderId: row.id,
  }));
}

/** Resolve the sales order behind a picked document, or `null` when it no longer exists. */
export async function resolveVatMarginSalesOrderId(
  type: VatMarginDocumentType,
  id: number
): Promise<number | null> {
  if (type === "delivery_note") {
    const note = await db.query.deliveryNotes.findFirst({
      columns: { salesOrderId: true },
      where: eq(deliveryNotes.id, id),
    });
    return note?.salesOrderId ?? null;
  }

  const order = await db.query.salesOrders.findFirst({
    columns: { id: true, vatInvoiceNumber: true },
    where: eq(salesOrders.id, id),
  });
  if (!order) return null;
  // Asking for the invoice of an order that never got one is a request for a document that does
  // not exist - not an empty statement.
  if (type === "invoice" && !order.vatInvoiceNumber) return null;
  return order.id;
}

/**
 * The order lines priced from the Product module.
 *
 * `innerJoin` on products: a line whose product was deleted cannot be costed at all, and the
 * order's own snapshot no longer exists to fall back on.
 */
export async function loadVatMarginSourceLines(
  salesOrderId: number
): Promise<VatMarginSourceLine[]> {
  const rows = await db
    .select({
      productCode: salesOrderItems.productCode,
      description: salesOrderItems.description,
      quantity: salesOrderItems.quantity,
      landingPrice: products.landingPrice,
      b2bPrice: products.b2bPrice,
    })
    .from(salesOrderItems)
    .innerJoin(products, eq(salesOrderItems.productId, products.id))
    .where(eq(salesOrderItems.salesOrderId, salesOrderId));

  return rows.map((row) => ({
    productCode: row.productCode,
    description: row.description,
    quantity: row.quantity,
    landingPrice: money(row.landingPrice),
    b2bPrice: money(row.b2bPrice),
  }));
}

export interface VatMarginOverrides {
  profitMarginRate?: number;
  incomeTaxRate?: number;
}

/**
 * The full statement for one document, or `null` when the document does not exist.
 *
 * Rates come from the query string when the operator has changed a field, and from the saved
 * settings otherwise - so a statement is reproducible from its document plus the two rates.
 * The VAT rate is never an input: it is the rate the order was invoiced at, read from
 * `sales_orders.vat_rate`.
 */
export async function buildVatMarginStatement(
  type: VatMarginDocumentType,
  id: number,
  overrides: VatMarginOverrides = {}
) {
  const salesOrderId = await resolveVatMarginSalesOrderId(type, id);
  if (salesOrderId === null) return null;

  const order = await db.query.salesOrders.findFirst({
    where: eq(salesOrders.id, salesOrderId),
  });
  if (!order) return null;

  const settings = await readVatMarginSettings();
  const sourceLines = await loadVatMarginSourceLines(salesOrderId);

  const statement = computeVatMarginStatement(sourceLines, {
    profitMarginRate: overrides.profitMarginRate ?? settings.profitMarginRate,
    incomeTaxRate: overrides.incomeTaxRate ?? settings.incomeTaxRate,
    vatRate: money(order.vatRate) ?? 0,
  });

  const reference = type === "invoice"
    ? order.vatInvoiceNumber ?? order.orderNumber
    : type === "delivery_note"
      ? (await db.query.deliveryNotes.findFirst({
          columns: { deliveryNoteNumber: true },
          where: eq(deliveryNotes.id, id),
        }))?.deliveryNoteNumber ?? order.orderNumber
      : order.orderNumber;

  return {
    document: {
      id,
      type,
      typeLabel: DOCUMENT_TYPE_LABELS[type],
      reference,
      orderNumber: order.orderNumber,
      invoiceNumber: order.vatInvoiceNumber,
      customerName: order.customerName,
      companyName: order.companyName,
      contactPerson: order.contactPerson,
      orderDate: isoDate(order.orderDate),
      vatCompanyName: order.vatCompanyName,
      vatCompanyTaxId: order.vatCompanyTaxId,
      vatCompanyAddress: order.vatCompanyAddress,
    },
    ...statement,
  };
}

function badQuery(res: Response, message: string) {
  return res.status(400).json({ message, suggestion: "Reload the page and pick the document again." });
}

export function registerVatMarginRoutes(app: Express) {
  app.get("/api/vat-margin/settings", requirePermission("vatMargin", "read"), async (_req, res) => {
    try {
      res.json({ settings: await readVatMarginSettings() });
    } catch (error) {
      console.error("Error reading VAT margin settings:", error);
      res.status(500).json({ message: "Failed to load the VAT margin settings" });
    }
  });

  app.put(
    "/api/vat-margin/settings",
    requirePermission("vatMargin", "update"),
    validateBody(settingsSchema, "Send the rates as fractions (0.2 = 20%)"),
    async (req, res) => {
      try {
        const settings = await saveVatMarginSettings(req.body, req.user?.id ?? null);
        res.json({ settings, message: "VAT margin settings saved" });
      } catch (error) {
        console.error("Error saving VAT margin settings:", error);
        res.status(500).json({ message: "Failed to save the VAT margin settings" });
      }
    }
  );

  app.get("/api/vat-margin/documents", requirePermission("vatMargin", "read"), async (req, res) => {
    const parsed = documentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return badQuery(res, parsed.error.issues[0]?.message ?? "Pick a document type");
    }

    try {
      res.json({ documents: await listVatMarginDocuments(parsed.data.type) });
    } catch (error) {
      console.error("Error listing VAT margin documents:", error);
      res.status(500).json({ message: "Failed to load the documents" });
    }
  });

  app.get("/api/vat-margin/statement", requirePermission("vatMargin", "read"), async (req, res) => {
    const parsed = statementQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return badQuery(res, parsed.error.issues[0]?.message ?? "Pick a document");
    }

    try {
      const statement = await buildVatMarginStatement(parsed.data.type, parsed.data.id, {
        profitMarginRate: parsed.data.profitMarginRate,
        incomeTaxRate: parsed.data.incomeTaxRate,
      });

      if (!statement) {
        return res.status(404).json({
          message: "That document no longer exists",
          suggestion: "Reload the list and pick it again.",
        });
      }

      // A statement with no lines cannot be sent to anyone - say so instead of printing zeros.
      if (statement.lines.length === 0) {
        return res.status(400).json({
          message: "That document has no lines to calculate",
          suggestion: "Check the sales order has products on it.",
        });
      }

      res.json(statement);
    } catch (error) {
      console.error("Error building the VAT margin statement:", error);
      res.status(500).json({ message: "Failed to calculate the VAT margin statement" });
    }
  });
}

export default registerVatMarginRoutes;


