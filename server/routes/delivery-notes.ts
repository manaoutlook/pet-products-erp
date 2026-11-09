import type { Express, Response } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db";
import { deliveryNoteItems, deliveryNotes } from "@db/schema";
import { requireAuth, requirePermission } from "../middleware";
import { validateBody, validateParams, idParamSchema } from "../validate";
import { SalesOrderError, issueDeliveryNote } from "../sales-orders";

/**
 * Delivery Note endpoints - the outbound mirror of `/api/purchase-orders/:id/goods-receipt`.
 *
 * A note is created *from* a sales order rather than typed from scratch: the customer block and
 * the ordered quantities are copied from the order, so the note can never disagree with what the
 * customer actually bought. Everything that moves (the note, its lines, the order line tallies
 * and the order status) commits in one transaction inside `issueDeliveryNote`.
 *
 * Permission module: `orders` - see the note in routes/sales-orders.ts.
 */

const deliveryNoteSchema = z.object({
  salesOrderId: z.number().int().positive("Pick the sales order this note delivers"),
  deliveryDate: z.string().datetime("Valid delivery date is required").optional(),
  remarks: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      return trimmed.length > 0 ? trimmed : null;
    })
    .superRefine((value, ctx) => {
      if (value !== null && value.length > 2000) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Remarks are too long" });
      }
    }),
  // "Goods received in good condition." ticked by the customer.
  customerConfirmed: z.boolean().optional(),
  /**
   * Lines that travel on this note. Omit to ship everything still outstanding; send explicit
   * lines to leave part of the order behind.
   */
  items: z
    .array(
      z.object({
        salesOrderItemId: z.number().int().positive("Line id is required"),
        deliveredQuantity: z
          .number()
          .int()
          .positive("Delivered quantity must be a whole number above zero"),
        remarks: z.string().max(500).optional().nullable(),
      })
    )
    .min(1, "Deliver at least one line")
    .optional(),
});

function handleDeliveryNoteError(res: Response, error: unknown, fallback: string) {
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

export function registerDeliveryNoteRoutes(app: Express) {
  app.get(
    "/api/delivery-notes",
    requireAuth,
    requirePermission("orders", "read"),
    async (_req, res) => {
      try {
        const notes = await db.query.deliveryNotes.findMany({
          with: {
            // Light summary: the list shows which order each note belongs to.
            salesOrder: {
              columns: { id: true, orderNumber: true, customerName: true, status: true },
            },
            deliveredByUser: { columns: { id: true, username: true } },
            items: {
              columns: {
                id: true,
                productCode: true,
                description: true,
                orderedQuantity: true,
                deliveredQuantity: true,
              },
            },
          },
          orderBy: [desc(deliveryNotes.updatedAt)],
        });

        res.json(notes);
      } catch (error) {
        return handleDeliveryNoteError(res, error, "Failed to fetch delivery notes");
      }
    }
  );

  app.get(
    "/api/delivery-notes/:id",
    requireAuth,
    requirePermission("orders", "read"),
    validateParams(idParamSchema),
    async (req, res) => {
      try {
        const note = await db.query.deliveryNotes.findFirst({
          where: eq(deliveryNotes.id, Number(req.params.id)),
          with: {
            salesOrder: {
              columns: {
                id: true,
                orderNumber: true,
                orderDate: true,
                customerName: true,
                specialInstructions: true,
                status: true,
              },
            },
            deliveredByUser: { columns: { id: true, username: true } },
            items: { orderBy: [deliveryNoteItems.id] },
          },
        });

        if (!note) {
          return res.status(404).json({ message: "Delivery note not found" });
        }

        res.json(note);
      } catch (error) {
        return handleDeliveryNoteError(res, error, "Failed to fetch the delivery note");
      }
    }
  );

  app.post(
    "/api/delivery-notes",
    requireAuth,
    requirePermission("orders", "create"),
    validateBody(
      deliveryNoteSchema,
      "Pick a sales order and enter the quantity that actually left the warehouse"
    ),
    async (req, res) => {
      const body = req.body as z.infer<typeof deliveryNoteSchema>;

      try {
        const result = await db.transaction((tx) =>
          issueDeliveryNote(tx, {
            salesOrderId: body.salesOrderId,
            deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : new Date(),
            userId: req.user!.id,
            remarks: body.remarks,
            customerConfirmed: body.customerConfirmed,
            items: body.items?.map((line) => ({
              salesOrderItemId: line.salesOrderItemId,
              deliveredQuantity: line.deliveredQuantity,
              remarks: line.remarks ?? null,
            })),
          })
        );

        res.status(201).json({
          message: `Delivery note ${result.deliveryNote.deliveryNoteNumber} issued`,
          ...result,
        });
      } catch (error) {
        return handleDeliveryNoteError(res, error, "Failed to create the delivery note");
      }
    }
  );
}
