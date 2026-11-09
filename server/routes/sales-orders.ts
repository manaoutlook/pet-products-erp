import type { Express, Response } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db";
import { deliveryNotes, salesOrderItems, salesOrders } from "@db/schema";
import { requireAuth, requirePermission } from "../middleware";
import { validateBody, validateParams, idParamSchema } from "../validate";
import { generateSalesOrderNumber } from "../numbering";
import { SalesOrderError, buildSalesOrderLines } from "../sales-orders";

/**
 * Sales Order endpoints (the outbound counterpart of /api/purchase-orders).
 *
 * Permission module: `orders`. A sales order is the customer-facing promise to ship goods, so
 * it lives with the rest of the order flow instead of getting a module of its own - a store
 * manager who can raise purchase orders can raise sales orders, and the role screen keeps one
 * checkbox pair ("Orders") for both directions.
 *
 * There is no store scope here on purpose: the customer's delivery address is the scope, and
 * the same order can be shipped from whichever warehouse has stock.
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
  phone: optionalText(20, "Phone number is too long"),
  deliveryAddress: optionalText(500, "Delivery address is too long"),
  orderDate: z.string().datetime("Valid order date is required").optional(),
  specialInstructions: optionalText(2000, "Special instructions are too long"),
  items: z.array(salesOrderLineSchema).min(1, "Add at least one product to the order"),
});

function handleSalesOrderError(res: Response, error: unknown, fallback: string) {
  if (error instanceof SalesOrderError) {
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
          deliveryNotes: {
            columns: { id: true, deliveryNoteNumber: true, deliveryDate: true },
          },
          preparedByUser: { columns: { id: true, username: true } },
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
        const created = await db.transaction(async (tx) => {
          const { lines, total } = await buildSalesOrderLines(tx, body.items);

          const [order] = await tx
            .insert(salesOrders)
            .values({
              orderNumber: generateSalesOrderNumber(),
              customerProfileId: body.customerProfileId ?? null,
              customerName: body.customerName,
              companyName: body.companyName,
              contactPerson: body.contactPerson,
              phone: body.phone,
              deliveryAddress: body.deliveryAddress,
              orderDate: body.orderDate ? new Date(body.orderDate) : new Date(),
              totalAmount: total.toFixed(2),
              specialInstructions: body.specialInstructions,
              status: "open",
              preparedByUserId: req.user!.id,
            })
            .returning();

          await insertSalesOrderLines(tx, order.id, lines);

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

          const { lines, total } = await buildSalesOrderLines(tx, body.items);

          await tx.delete(salesOrderItems).where(eq(salesOrderItems.salesOrderId, salesOrderId));

          const [row] = await tx
            .update(salesOrders)
            .set({
              customerProfileId: body.customerProfileId ?? null,
              customerName: body.customerName,
              companyName: body.companyName,
              contactPerson: body.contactPerson,
              phone: body.phone,
              deliveryAddress: body.deliveryAddress,
              orderDate: body.orderDate ? new Date(body.orderDate) : order.orderDate,
              totalAmount: total.toFixed(2),
              specialInstructions: body.specialInstructions,
              updatedAt: new Date(),
            })
            .where(eq(salesOrders.id, salesOrderId))
            .returning();

          await insertSalesOrderLines(tx, salesOrderId, lines);

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

          const notes = await tx.query.deliveryNotes.findMany({
            where: eq(deliveryNotes.salesOrderId, salesOrderId),
            columns: { id: true },
          });

          if (notes.length > 0) {
            throw new SalesOrderError(
              `Sales order ${order.orderNumber} already has ${notes.length} delivery note(s)`,
              409,
              "Delivered orders cannot be cancelled - raise a return order instead."
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
