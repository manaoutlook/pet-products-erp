import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db";
import {
  deliveryNotes,
  salesOrderItems,
  salesOrders,
  userStoreAssignments,
  vatCompanies,
} from "@db/schema";
import { requireAuth, requirePermission } from "../middleware";
import { validateBody, validateParams, idParamSchema } from "../validate";
import { generateSalesOrderNumber } from "../numbering";
import { SalesOrderError, buildSalesOrderLines, resolveCustomerTaxId } from "../sales-orders";
import {
  SalesOrderStockError,
  assertStockAvailable,
} from "../sales-order-stock";
import {
  SalesOrderInvoiceError,
  getSalesOrderInvoice,
  issueSalesOrderInvoice,
} from "../sales-order-invoices";
import { vatCompanyMissingFields } from "../../shared/vat-company";
import { isAdminRole } from "../../shared/permissions";

/**
 * Sales Order endpoints (the outbound counterpart of /api/purchase-orders).
 *
 * Permission module: `orders`. A sales order is the customer-facing promise to ship goods, so
 * it lives with the rest of the order flow instead of getting a module of its own - a store
 * manager who can raise purchase orders can raise sales orders, and the role screen keeps one
 * checkbox pair ("Orders") for both directions.
 *
 * There is no store scope on the permission here on purpose: the customer's delivery address is
 * the scope. Which *warehouse* the units leave from is a property of the order
 * (`sales_orders.store_id`, default the DC); saving an order checks that location can cover it,
 * and each delivery note copies it and takes the units off that inventory row - see
 * server/sales-order-stock.ts.
 */

/** Trimmed text that collapses "" to null, so empty inputs do not store empty strings. */
function optionalText(max: number, message: string) {
  return z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      return trimmed.length > 0 ? trimmed : null;
    })
    .superRefine((value, ctx) => {
      if (value !== null && value.length > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      }
    });
}

const salesOrderLineSchema = z.object({
  productId: z.number().int().positive("Pick a product for every line"),
  quantity: z.number().int().positive("Quantity must be a whole number above zero"),
  // VND amount. Optional so the screen can leave the catalogue price in place.
  unitPrice: z.number().min(0, "Unit price cannot be negative").optional(),
});

const salesOrderSchema = z.object({
  customerProfileId: z.number().int().positive().optional().nullable(),
  customerName: z
    .string({ required_error: "Customer name is required" })
    .trim()
    .min(1, "Customer name is required")
    .max(200),
  companyName: optionalText(200, "Company name is too long"),
  contactPerson: optionalText(200, "Contact person is too long"),
  /** Printed against the buyer on a VAT invoice; copied from the customer profile by the form. */
  customerTaxId: optionalText(50, "Tax code is too long"),
  phone: optionalText(20, "Phone number is too long"),
  deliveryAddress: optionalText(500, "Delivery address is too long"),
  /**
   * Which location the goods leave from: a store id, or null for the Distribution Centre.
   * Saving the order checks that location can cover the lines; a delivery note copies it and
   * takes the units off that location's inventory.
   */
  storeId: z
    .number()
    .int()
    .positive('Pick a valid "Deliver from" location')
    .optional()
    .nullable(),
  orderDate: z.string().datetime("Valid order date is required").optional(),
  specialInstructions: optionalText(2000, "Special instructions are too long"),
  /**
   * Which licensed company issues this order's VAT paperwork, or null/omitted for "No VAT".
   *
   * The company's name, tax code and address are snapshotted onto the order (and later onto
   * each delivery note) so a reprint keeps the letterhead that was on the signed document.
   */
  vatCompanyId: z.number().int().positive("Pick a valid VAT company").optional().nullable(),
  items: z.array(salesOrderLineSchema).min(1, "Add at least one product to the order"),
});

function handleSalesOrderError(res: Response, error: unknown, fallback: string) {
  if (
    error instanceof SalesOrderError ||
    error instanceof SalesOrderInvoiceError ||
    error instanceof SalesOrderStockError
  ) {
    return res.status(error.status).json({
      message: error.message,
      suggestion: error.suggestion,
    });
  }

  console.error(`${fallback}:`, error);
  return res.status(500).json({
    message: fallback,
    suggestion: "Please try again later",
  });
}

/**
 * The "Deliver from" location a request may actually save.
 *
 * Only an administrator may choose the location. Everybody else ships from the store they
 * are assigned to - the same store the till sells from - or from the Distribution Centre
 * when they have no assignment. The value in the body is ignored rather than rejected, so
 * a stale dialog (or a user whose assignment changed mid-session) still produces an order
 * that obeys the rule instead of a mystery 403.
 */
async function resolveDeliverFromStoreId(
  req: Request,
  requestedStoreId: number | null | undefined
): Promise<number | null> {
  if (isAdminRole(req.user?.role)) return requestedStoreId ?? null;

  const assignment = await db.query.userStoreAssignments.findFirst({
    where: eq(userStoreAssignments.userId, req.user!.id),
    orderBy: [asc(userStoreAssignments.id)],
  });

  return assignment?.storeId ?? null;
}

/** The VAT company block stored on an order / delivery note. All null = "No VAT". */
interface VatCompanySnapshot {
  vatCompanyId: number | null;
  vatCompanyCode: string | null;
  vatCompanyName: string | null;
  vatCompanyTaxId: string | null;
  vatCompanyAddress: string | null;
  /**
   * The rate this company charged when the order was saved, as a fraction ("0.0800" = 8%).
   * Stored on the order (`sales_orders.vat_rate`) because the invoice prints VAT at the rate
   * of the day it was raised - correcting the company's rate later must not change it.
   * "0" = the order carries no VAT company.
   */
  vatRate: string;
}

const NO_VAT_COMPANY: VatCompanySnapshot = {
  vatCompanyId: null,
  vatCompanyCode: null,
  vatCompanyName: null,
  vatCompanyTaxId: null,
  vatCompanyAddress: null,
  vatRate: "0",
};

/**
 * Resolve the selected VAT company into the block that is stored on the order.
 *
 * AI Agent Note: the server is the authority on whether a company may issue paperwork. The
 * screen hides incomplete companies, but a stale tab (or a hand-written request) must not be
 * able to put a VAT company with a blank tax code onto a document. Inactive companies are
 * refused too: an invoice printed under a closed company is not a valid invoice.
 */
async function resolveVatCompanySnapshot(
  executor: Parameters<Parameters<typeof db.transaction>[0]>[0],
  vatCompanyId: number | null | undefined
): Promise<VatCompanySnapshot> {
  if (!vatCompanyId) return NO_VAT_COMPANY;

  const company = await executor.query.vatCompanies.findFirst({
    where: eq(vatCompanies.id, vatCompanyId),
  });

  if (!company) {
    throw new SalesOrderError(
      "The selected VAT company no longer exists",
      400,
      "Pick another company, or save the order as No VAT."
    );
  }

  if (!company.isActive) {
    throw new SalesOrderError(
      `VAT company ${company.code} - ${company.name} is inactive`,
      409,
      "Pick an active company, or reactivate it under Master Data -> VAT Companies."
    );
  }

  const missing = vatCompanyMissingFields(company);
  if (missing.length > 0) {
    throw new SalesOrderError(
      `VAT company ${company.code} - ${company.name} cannot issue documents yet`,
      400,
      `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing. ` +
        "Complete the company under Master Data -> VAT Companies."
    );
  }

  return {
    vatCompanyId: company.id,
    vatCompanyCode: company.code,
    vatCompanyName: company.name,
    vatCompanyTaxId: company.taxId,
    vatCompanyAddress: company.address,
    // The company's own rate, snapshotted now - see VatCompanySnapshot.vatRate.
    vatRate: company.vatRate,
  };
}

export function registerSalesOrderRoutes(app: Express) {
  app.get("/api/sales-orders", requireAuth, requirePermission("orders", "read"), async (_req, res) => {
    try {
      const orders = await db.query.salesOrders.findMany({
        with: {
          items: {
            columns: {
              id: true,
              productId: true,
              productCode: true,
              description: true,
              quantity: true,
              unitPrice: true,
              totalPrice: true,
              deliveredQuantity: true,
            },
          },
          // Light summary only: the list needs to know whether a shipment already went out.
          // `status` lets the client tell a live shipment from a cancelled one - only active
          // notes block cancelling the order.
          deliveryNotes: {
            columns: {
              id: true,
              deliveryNoteNumber: true,
              deliveryDate: true,
              signedDocumentUrl: true,
              status: true,
            },
          },
          preparedByUser: { columns: { id: true, username: true } },
          // Which warehouse/shop the units leave from. Null = the Distribution Centre.
          store: { columns: { id: true, name: true, type: true } },
        },
        orderBy: [desc(salesOrders.updatedAt)],
      });

      res.json(orders);
    } catch (error) {
      return handleSalesOrderError(res, error, "Failed to fetch sales orders");
    }
  });

  app.get(
    "/api/sales-orders/:id",
    requireAuth,
    requirePermission("orders", "read"),
    validateParams(idParamSchema),
    async (req, res) => {
      try {
        const order = await db.query.salesOrders.findFirst({
          where: eq(salesOrders.id, Number(req.params.id)),
          with: {
            items: { orderBy: [salesOrderItems.id] },
            deliveryNotes: {
              columns: {
                id: true,
                deliveryNoteNumber: true,
                deliveryDate: true,
                status: true,
              },
            },
            preparedByUser: { columns: { id: true, username: true } },
            customerProfile: true,
            store: { columns: { id: true, name: true, type: true } },
          },
        });

        if (!order) {
          return res.status(404).json({ message: "Sales order not found" });
        }

        res.json(order);
      } catch (error) {
        return handleSalesOrderError(res, error, "Failed to fetch the sales order");
      }
    }
  );

  // ---------------------------------------------------------------------------------------
  // VAT invoice of an order
  // ---------------------------------------------------------------------------------------
  // POST issues the number from the selected company's own sequence and stores it on the
  // order; GET re-opens the same document. The invoice is never rendered from live data - the
  // seller, buyer and lines are the snapshots stored when the order was raised.
  app.get(
    "/api/sales-orders/:id/vat-invoice",
    requireAuth,
    requirePermission("orders", "read"),
    validateParams(idParamSchema),
    async (req, res) => {
      try {
        const invoice = await getSalesOrderInvoice(Number(req.params.id));
        res.json({ invoice });
      } catch (error) {
        return handleSalesOrderError(res, error, "Failed to load the VAT invoice");
      }
    }
  );

  app.post(
    "/api/sales-orders/:id/vat-invoice",
    requireAuth,
    requirePermission("orders", "update"),
    validateParams(idParamSchema),
    async (req, res) => {
      try {
        const invoice = await issueSalesOrderInvoice(Number(req.params.id));
        res.json({ invoice, message: `VAT invoice ${invoice.invoiceNumber} issued` });
      } catch (error) {
        return handleSalesOrderError(res, error, "Failed to issue the VAT invoice");
      }
    }
  );
}

/**
 * Insert the lines of an order inside the caller's transaction.
 * Shared by POST (create) and PUT (replace), which differ only in whether the header
 * already exists.
 */
async function insertSalesOrderLines(
  executor: Parameters<Parameters<typeof db.transaction>[0]>[0],
  salesOrderId: number,
  lines: Awaited<ReturnType<typeof buildSalesOrderLines>>["lines"]
) {
  if (lines.length === 0) return;

  await executor.insert(salesOrderItems).values(
    lines.map((line) => ({
      salesOrderId,
      productId: line.productId,
      productCode: line.productCode,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      totalPrice: line.totalPrice,
      deliveredQuantity: 0,
    }))
  );
}

export function registerSalesOrderWriteRoutes(app: Express) {
  app.post(
    "/api/sales-orders",
    requireAuth,
    requirePermission("orders", "create"),
    validateBody(salesOrderSchema, "Provide a customer, at least one product and a quantity"),
    async (req, res) => {
      const body = req.body as z.infer<typeof salesOrderSchema>;

      try {
        // Admins choose where the units leave from; for everybody else it is the store they
        // are assigned to (or the Distribution Centre when they have none).
        const storeId = await resolveDeliverFromStoreId(req, body.storeId);

        const created = await db.transaction(async (tx) => {
          const { lines, total } = await buildSalesOrderLines(tx, body.items);
          const vatCompany = await resolveVatCompanySnapshot(tx, body.vatCompanyId);
          const customerTaxId = await resolveCustomerTaxId(
            tx,
            body.customerProfileId,
            body.customerTaxId
          );

          const [order] = await tx
            .insert(salesOrders)
            .values({
              orderNumber: generateSalesOrderNumber(),
              customerProfileId: body.customerProfileId ?? null,
              customerName: body.customerName,
              companyName: body.companyName,
              contactPerson: body.contactPerson,
              customerTaxId,
              phone: body.phone,
              deliveryAddress: body.deliveryAddress,
              // Null = the Distribution Centre (same convention as a purchase order).
              storeId,
              ...vatCompany,
              orderDate: body.orderDate ? new Date(body.orderDate) : new Date(),
              totalAmount: total.toFixed(2),
              specialInstructions: body.specialInstructions,
              status: "open",
              preparedByUserId: req.user!.id,
            })
            .returning();

          await insertSalesOrderLines(tx, order.id, lines);

          // The order is a promise, not a goods issue: check the location can cover it (so the
          // shop cannot sell what it does not have) but leave the shelf alone. The units leave
          // the ledger when a delivery note is issued - see server/sales-order-stock.ts.
          await assertStockAvailable(tx, {
            storeId: order.storeId,
            lines,
          });

          return order;
        });

        res.status(201).json(created);
      } catch (error) {
        return handleSalesOrderError(res, error, "Failed to create the sales order");
      }
    }
  );

  app.put(
    "/api/sales-orders/:id",
    requireAuth,
    requirePermission("orders", "update"),
    validateParams(idParamSchema),
    validateBody(salesOrderSchema, "Provide a customer, at least one product and a quantity"),
    async (req, res) => {
      const salesOrderId = Number(req.params.id);
      const body = req.body as z.infer<typeof salesOrderSchema>;

      try {
        // The same rule as create: only an admin moves an order to another location.
        const storeId = await resolveDeliverFromStoreId(req, body.storeId);

        const updated = await db.transaction(async (tx) => {
          const order = await tx.query.salesOrders.findFirst({
            where: eq(salesOrders.id, salesOrderId),
          });

          if (!order) {
            throw new SalesOrderError("Sales order not found", 404);
          }

          if (order.status === "cancelled") {
            throw new SalesOrderError(
              `Sales order ${order.orderNumber} is cancelled`,
              400,
              "A cancelled order cannot be edited - create a new one."
            );
          }

          // A numbered VAT invoice is a legal document. Changing the lines or the company
          // afterwards would print something different under the same number.
          if (order.vatInvoiceNumber) {
            throw new SalesOrderError(
              `Sales order ${order.orderNumber} already has VAT invoice ${order.vatInvoiceNumber}`,
              409,
              "An invoiced order cannot be edited - raise a new order for the correction."
            );
          }

          // Once part of the order has shipped, the lines are what the delivery notes point
          // at. Rewriting them would orphan a signed note, so the order is frozen instead.
          const existing = await tx.query.salesOrderItems.findMany({
            where: eq(salesOrderItems.salesOrderId, salesOrderId),
            columns: { id: true, deliveredQuantity: true },
          });

          if (existing.some((item) => item.deliveredQuantity > 0)) {
            throw new SalesOrderError(
              `Sales order ${order.orderNumber} already has delivered units`,
              409,
              "Cancel this order and raise a new one for the change; the delivery notes stay valid."
            );
          }

          // Prices are only enforced when the order is first raised: an order created before the
          // product master was filled in must stay editable, otherwise a missing B2B price
          // would lock the order (and its delivery notes) forever.
          const { lines, total } = await buildSalesOrderLines(tx, body.items, {
            requirePrices: false,
          });
          const vatCompany = await resolveVatCompanySnapshot(tx, body.vatCompanyId);
          const customerTaxId = await resolveCustomerTaxId(
            tx,
            body.customerProfileId,
            body.customerTaxId
          );

          await tx.delete(salesOrderItems).where(eq(salesOrderItems.salesOrderId, salesOrderId));

          const [row] = await tx
            .update(salesOrders)
            .set({
              customerProfileId: body.customerProfileId ?? null,
              customerName: body.customerName,
              companyName: body.companyName,
              contactPerson: body.contactPerson,
              customerTaxId,
              phone: body.phone,
              deliveryAddress: body.deliveryAddress,
              // The shipping location; moved freely until goods actually leave (the delivery
              // note snapshots whichever location it ships from).
              storeId,
              // Re-snapshot the VAT company on every save: the order has not shipped yet,
              // so correcting its letterhead is allowed while the document is still a draft.
              ...vatCompany,
              orderDate: body.orderDate ? new Date(body.orderDate) : order.orderDate,
              totalAmount: total.toFixed(2),
              specialInstructions: body.specialInstructions,
              updatedAt: new Date(),
            })
            .where(eq(salesOrders.id, salesOrderId))
            .returning();

          await insertSalesOrderLines(tx, salesOrderId, lines);

          await assertStockAvailable(tx, {
            storeId: row.storeId,
            lines,
          });

          return row;
        });

        res.json(updated);
      } catch (error) {
        return handleSalesOrderError(res, error, "Failed to update the sales order");
      }
    }
  );

  app.post(
    "/api/sales-orders/:id/cancel",
    requireAuth,
    requirePermission("orders", "update"),
    validateParams(idParamSchema),
    async (req, res) => {
      const salesOrderId = Number(req.params.id);

      try {
        const cancelled = await db.transaction(async (tx) => {
          const order = await tx.query.salesOrders.findFirst({
            where: eq(salesOrders.id, salesOrderId),
          });

          if (!order) {
            throw new SalesOrderError("Sales order not found", 404);
          }

          if (order.status === "cancelled") {
            return order;
          }

          // Cancelling an invoiced order would leave a valid tax invoice for a cancelled
          // order. The invoice has to be dealt with first (a credit note is not implemented).
          if (order.vatInvoiceNumber) {
            throw new SalesOrderError(
              `Sales order ${order.orderNumber} carries VAT invoice ${order.vatInvoiceNumber}`,
              409,
              "An invoiced order cannot be cancelled here. Raise a return instead."
            );
          }

          // Only a *live* shipment blocks cancelling: once every note is cancelled its units have
          // already gone back on the shelf, so the order is just a promise again.
          const notes = await tx.query.deliveryNotes.findMany({
            where: and(
              eq(deliveryNotes.salesOrderId, salesOrderId),
              ne(deliveryNotes.status, "cancelled")
            ),
            columns: { id: true, deliveryNoteNumber: true },
          });

          if (notes.length > 0) {
            const numbers = notes.map((note) => note.deliveryNoteNumber).join(", ");
            throw new SalesOrderError(
              `Sales order ${order.orderNumber} has ${notes.length} active delivery note(s) (${numbers})`,
              409,
              "Cancel those delivery notes first - that returns their units to stock - then cancel the order."
            );
          }

          const [row] = await tx
            .update(salesOrders)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(eq(salesOrders.id, salesOrderId))
            .returning();

          return row;
        });

        res.json(cancelled);
      } catch (error) {
        return handleSalesOrderError(res, error, "Failed to cancel the sales order");
      }
    }
  );

  app.delete(
    "/api/sales-orders/:id",
    requireAuth,
    requirePermission("orders", "delete"),
    validateParams(idParamSchema),
    async (req, res) => {
      const salesOrderId = Number(req.params.id);

      try {
        await db.transaction(async (tx) => {
          const order = await tx.query.salesOrders.findFirst({
            where: eq(salesOrders.id, salesOrderId),
            with: { deliveryNotes: { columns: { id: true } } },
          });

          if (!order) {
            throw new SalesOrderError("Sales order not found", 404);
          }

          // The issued invoice would keep pointing at a deleted order.
          if (order.vatInvoiceNumber) {
            throw new SalesOrderError(
              `Sales order ${order.orderNumber} carries VAT invoice ${order.vatInvoiceNumber}`,
              409,
              "An invoiced order cannot be deleted - it has to stay for the tax record."
            );
          }

          // delivery_note_items points at the order lines, so deleting the order would cascade
          // the lines and take the printed notes' rows with them.
          if (order.deliveryNotes.length > 0) {
            throw new SalesOrderError(
              `Sales order ${order.orderNumber} has delivery notes and cannot be deleted`,
              409,
              "Cancel it instead - the delivery history has to stay auditable."
            );
          }

          await tx.delete(salesOrders).where(eq(salesOrders.id, salesOrderId));
        });

        res.json({ message: "Sales order deleted" });
      } catch (error) {
        return handleSalesOrderError(res, error, "Failed to delete the sales order");
      }
    }
  );
}
