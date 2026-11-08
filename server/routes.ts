import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { registerStoreRoutes } from "./routes/stores";
import { db } from "@db";
import {
  products, inventory, orders, orderItems, users,
  roles, stores, userStoreAssignments, regions,
  categories, brands, suppliers, purchaseOrders,
  purchaseOrderItems, purchaseOrderActions, customerProfiles, insertCustomerProfileSchema,
  insertPurchaseOrderActionSchema, selectPurchaseOrderActionSchema,
  insertUserSchema, updateUserSchema, salesTransactions, salesTransactionItems,
  salesTransactionActions, invoiceCounters,
  transferRequests, transferRequestItems, transferActions, transferHistory,
  insertTransferRequestSchema, insertTransferRequestItemSchema, insertTransferActionSchema,
  selectTransferRequestSchema, selectTransferRequestItemSchema
} from "@db/schema";
import { sql } from "drizzle-orm";
import { eq, and, or, desc, gte, lt, isNull, gt } from "drizzle-orm";
import { requireRole, requireAuth, requirePermission } from "./middleware";
import { importProducts } from "./product-import";
import { importInventory } from "./inventory-import";
import { importBrands, importCategories, importSuppliers } from "./master-data-import";
import {
  bulkDeleteBrands,
  bulkDeleteCategories,
  bulkDeleteSuppliers,
} from "./master-data-bulk-delete";
import { z } from "zod";
import { validateBody, validateParams, idParamSchema } from "./validate";
import { resolveScope, scopeDenies, scopeStoreFilter } from "./scoping";
import {
  applyStockChange,
  recordOpeningStock,
  recordStockMovement,
  recordStockMovements,
  StockError,
} from "./stock-ledger";
import { adjustStock, listStockTake } from "./stock-adjust";
import { crypto } from "./auth";
import { createSale, refundSale, cancelSale, SaleError } from "./sales";

// Schema validations
const createPurchaseOrderSchema = z.object({
  supplierId: z.number().positive("Supplier ID is required"),
  // AI Agent Note: destinationStoreId is the specific Warehouse (Store Type WAREHOUSE) receiving the goods.
  destinationStoreId: z.number().positive("Destination Warehouse is required").optional(),
  deliveryDate: z.string().datetime("Valid delivery date is required"),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.number().positive("Product ID is required"),
    quantity: z.number().positive("Quantity must be positive"),
    unitPrice: z.number().positive("Unit price must be positive"), // VND amount
  })).min(1, "At least one item is required"),
});

const updatePurchaseOrderSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']),
  deliveryDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});

// Shared body schemas for the master data screens (Categories, Brands,
// Suppliers): the checkbox selection uses one, the CSV/Excel import the other.
const masterDataBulkDeleteSchema = z.object({
  ids: z
    .array(z.number().int().positive())
    .min(1, "Select at least one entry")
    .max(1000, "Delete at most 1000 entries at a time"),
});

const masterDataImportSchema = z.object({
  rows: z
    .array(z.record(z.unknown()))
    .min(1, "At least one row is required")
    .max(5000, "Too many rows - import 5000 rows at a time"),
  // Update entries that already exist (matched by name)
  updateExisting: z.boolean().optional(),
});

// --- POS / stock schemas ---------------------------------------------------
// AI Agent Note: these bodies used to be hand-checked inside the handlers, so a
// string "12" or a missing field only failed later, inside Postgres, as a 500.
const saleItemSchema = z.object({
  productId: z.number().int().positive("productId must be a positive integer"),
  quantity: z.number().int().positive("quantity must be a positive integer"),
});

const createSaleSchema = z.object({
  items: z.array(saleItemSchema).min(1, "Add at least one item"),
  paymentMethod: z.string().min(1, "Payment method is required").max(50),
  customerProfileId: z.number().int().positive().nullish(),
  transactionType: z.enum(['STORE_SALE', 'DC_SALE']).optional(),
});

const refundSaleSchema = z.object({
  refundAmount: z.number().positive("Refund amount must be greater than zero").optional(),
  reason: z.string().max(500, "Reason must be 500 characters or fewer").optional(),
  items: z.array(z.object({
    id: z.number().int().positive(),
    quantity: z.number().int().positive(),
  })).optional(),
});

const cancelSaleSchema = z.object({
  reason: z.string().max(500, "Reason must be 500 characters or fewer").optional(),
});

const checkStockSchema = z.object({
  items: z.array(saleItemSchema).min(1, "Provide at least one item"),
  storeId: z.number().int().positive().nullish(),
});

// Stock adjust / stock-take: either a signed delta or a counted quantity, never both.
const adjustStockSchema = z.object({
  delta: z.number().int().refine((value) => value !== 0, {
    message: "delta must be a non-zero whole number",
  }).optional(),
  countedQuantity: z.number().int().min(0, "countedQuantity cannot be negative").optional(),
  reason: z.string().trim()
    .min(3, "A reason is required for a stock adjustment")
    .max(200, "Reason must be 200 characters or fewer"),
  source: z.enum(['stock_adjust', 'stock_take']).optional(),
}).refine(
  (value) => (value.delta === undefined) !== (value.countedQuantity === undefined),
  { message: "Send either delta or countedQuantity, not both" },
);

// --- access control schemas ----------------------------------------------
const roleBodySchema = z.object({
  name: z.string().min(1, "Role name is required").max(100),
  description: z.string().max(500).nullish(),
  isSystemAdmin: z.boolean().optional(),
  permissions: z.record(z.any()).nullish(),
});

const rolePermissionsSchema = z.object({
  permissions: z.record(z.any()).refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one permission",
  }),
});


// Helper functions
function generateOrderNumber(): string {
  return `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function generateInventoryBarcode(
  inventoryType: 'DC' | 'STORE',
  productSku: string,
  storeId?: number | null
): string {
  const prefix = inventoryType === 'DC' ? 'DC' : 'ST';
  const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');

  // AI Agent Note: In multiple DC mode, storePrefix should always be populated even for Warehouses.
  const storePrefix = storeId ? storeId.toString().padStart(3, '0') : '000';
  return `${prefix}${storePrefix}${productSku}${randomNum}`;
}

// AI Agent Note: Builds human readable name lists for validation messages, e.g.
// ["A"] => "A", ["A", "B"] => "A and B", ["A", "B", "C"] => "A, B and C".
// Long lists are truncated so the message stays readable in a toast.
function formatNameList(names: string[], maxNames = 5): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];

  const shown = names.slice(0, maxNames);
  const remaining = names.length - shown.length;

  if (remaining > 0) {
    return `${shown.join(", ")} and ${remaining} more`;
  }

  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

// AI Agent Note: Names pasted from documents/PDFs can carry Unicode whitespace
// variants (U+00A0, U+202F narrow no-break space, ...). Collapse them into plain
// spaces so lookups, uniqueness checks and searches behave predictably.
function normalizeWhitespace(value: string): string {
  return value
    .replace(/[\s\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u3000]+/g, " ")
    .trim();
}

// AI Agent Note: Human readable summary of a master data CSV/Excel import, e.g.
// "Import finished: 3 created, 1 updated, 2 failed".
function buildMasterDataImportMessage(result: {
  created: number;
  updated: number;
  skipped: number;
  createdParents: number;
  errors: { length: number };
}): string {
  const parts: string[] = [];
  if (result.created) parts.push(`${result.created} created`);
  if (result.updated) parts.push(`${result.updated} updated`);
  if (result.skipped) parts.push(`${result.skipped} skipped`);
  if (result.createdParents) {
    parts.push(
      `${result.createdParents} parent categor${result.createdParents === 1 ? "y" : "ies"} created`
    );
  }
  if (result.errors.length) parts.push(`${result.errors.length} failed`);

  return parts.length ? `Import finished: ${parts.join(", ")}` : "Nothing to import";
}

// AI Agent Note: "Deleted 3 brands · 1 could not be deleted" style summary of a
// master data bulk delete (mirrors the products bulk delete response).
function buildBulkDeleteMessage(singular: string, deletedCount: number, failedCount: number): string {
  const base = `Deleted ${deletedCount} ${singular}${deletedCount === 1 ? "" : "s"}`;
  return failedCount === 0 ? base : `${base} · ${failedCount} could not be deleted`;
}

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  // Add middleware to log all API requests
  app.use('/api', (req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });

  app.use('/api', requireAuth);

  // Store Management endpoints live in server/routes/stores.ts (backlog P2 #9).
  registerStoreRoutes(app);

  // Purchase Orders endpoints
  app.get("/api/purchase-orders", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // AI Agent Note: this used to be findMany() with no filter at all, so every
      // user saw every region's purchase orders.
      const scope = await resolveScope(user);
      const storeFilter = scopeStoreFilter(scope, purchaseOrders.destinationStoreId);

      const allPurchaseOrders = await db.query.purchaseOrders.findMany({
        where: storeFilter,
        with: {
          supplier: true,
          items: {
            with: {
              product: true
            }
          },
          actions: {
            with: {
              performedByUser: true
            }
          },
          destinationStore: true
        },
        orderBy: [desc(purchaseOrders.updatedAt)],
      });
      res.json(allPurchaseOrders);
    } catch (error) {
      console.error('Error fetching purchase orders:', error);
      res.status(500).json({
        message: "Failed to fetch purchase orders",
        suggestion: "Please try again later"
      });
    }
  });

  app.post("/api/purchase-orders", requireAuth, async (req, res) => {
    try {
      const result = createPurchaseOrderSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      const { supplierId, destinationStoreId, deliveryDate, notes, items } = result.data;

      // Generate unique order number
      const orderNumber = generateOrderNumber();

      // Calculate total amount in VND
      const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

      // Create purchase order
      const [newPurchaseOrder] = await db
        .insert(purchaseOrders)
        .values({
          orderNumber,
          supplierId: parseInt(supplierId),
          destinationStoreId: destinationStoreId || null,
          deliveryDate: new Date(deliveryDate),
          status: 'pending',
          totalAmount: totalAmount.toString(), // Store as string for decimal
          notes: notes || null
        })
        .returning();

      // Create purchase order items
      await Promise.all(items.map(item =>
        db.insert(purchaseOrderItems)
          .values({
            purchaseOrderId: newPurchaseOrder.id,
            productId: parseInt(item.productId),
            quantity: parseInt(item.quantity),
            unitPrice: parseFloat(item.unitPrice).toString(), // Store as string for decimal
            totalPrice: (parseInt(item.quantity) * parseFloat(item.unitPrice)).toString(), // Store as string for decimal
            deliveredQuantity: 0
          })
      ));

      // Fetch the complete purchase order with items and supplier
      const purchaseOrderWithDetails = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, newPurchaseOrder.id),
        with: {
          supplier: true,
          items: {
            with: {
              product: true
            }
          }
        }
      });

      res.json({
        message: "Purchase order created successfully",
        purchaseOrder: purchaseOrderWithDetails
      });
    } catch (error) {
      console.error('Error creating purchase order:', error);
      res.status(500).json({
        message: "Failed to create purchase order",
        suggestion: "Please try again later"
      });
    }
  });

  // Purchase Order Actions endpoints
  app.get("/api/purchase-orders/:id/actions", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      const actions = await db.query.purchaseOrderActions.findMany({
        where: eq(purchaseOrderActions.purchaseOrderId, parseInt(id)),
        with: {
          performedByUser: true
        },
        orderBy: [desc(purchaseOrderActions.performedAt)],
      });

      res.json(actions);
    } catch (error) {
      console.error('Error fetching purchase order actions:', error);
      res.status(500).json({
        message: "Failed to fetch purchase order actions",
        suggestion: "Please try again later"
      });
    }
  });

  app.post("/api/purchase-orders/:id/actions", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { actionType, actionData } = req.body;

      if (!actionType) {
        return res.status(400).json({
          message: "Action type is required",
        });
      }

      const validActionTypes = ['cancel', 'print', 'invoice_received', 'payment_sent', 'goods_receipt'];
      if (!validActionTypes.includes(actionType)) {
        return res.status(400).json({
          message: "Invalid action type",
          validTypes: validActionTypes
        });
      }

      // Check if purchase order exists
      const purchaseOrder = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, parseInt(id)),
      });

      if (!purchaseOrder) {
        return res.status(404).json({
          message: "Purchase order not found"
        });
      }

      // Business logic based on action type
      if (actionType === 'invoice_received') {
        // Auto-confirm pending orders when invoice is received
        if (purchaseOrder.status === 'pending') {
          await db
            .update(purchaseOrders)
            .set({
              status: 'confirmed',
              updatedAt: new Date()
            })
            .where(eq(purchaseOrders.id, parseInt(id)));
        }
      }

      if (actionType === 'cancel') {
        if (purchaseOrder.status === 'delivered' || purchaseOrder.status === 'cancelled') {
          return res.status(400).json({
            message: "Cannot cancel a delivered or already cancelled order"
          });
        }
        // Update order status to cancelled
        await db
          .update(purchaseOrders)
          .set({
            status: 'cancelled',
            updatedAt: new Date()
          })
          .where(eq(purchaseOrders.id, parseInt(id)));
      }

      // For goods_receipt, update inventory
      if (actionType === 'goods_receipt') {
        console.log('Processing goods receipt for order:', id);

        // Check if payment is sent first
        const paymentAction = await db.query.purchaseOrderActions.findFirst({
          where: and(
            eq(purchaseOrderActions.purchaseOrderId, parseInt(id)),
            eq(purchaseOrderActions.actionType, 'payment_sent')
          )
        });

        console.log('Payment action found:', paymentAction ? 'yes' : 'no');

        if (!paymentAction) {
          return res.status(400).json({
            message: "Payment must be sent before processing goods receipt"
          });
        }

        // Auto-deliver the order and update inventory
        console.log('Updating order status to delivered...');
        await db
          .update(purchaseOrders)
          .set({
            status: 'delivered',
            updatedAt: new Date()
          })
          .where(eq(purchaseOrders.id, parseInt(id)));

        // Update inventory (same logic as status update)
        console.log('Updating inventory...');
        const purchaseOrderItemList = await db.query.purchaseOrderItems.findMany({
          where: eq(purchaseOrderItems.purchaseOrderId, parseInt(id))
        });

        console.log('Found', purchaseOrderItemList.length, 'purchase order items to process');

        for (const item of purchaseOrderItemList) {
          // AI Agent Note: Search inventory in the specific destination warehouse/store
          const [currentInventory] = await db
            .select({
              id: inventory.id,
              quantity: inventory.quantity
            })
            .from(inventory)
            .where(
              and(
                eq(inventory.productId, item.productId),
                purchaseOrder.destinationStoreId
                  ? eq(inventory.storeId, purchaseOrder.destinationStoreId)
                  : eq(inventory.inventoryType, 'DC')
              )
            )
            .limit(1);

          if (currentInventory) {
            console.log('Updating existing inventory item:', currentInventory.id, 'quantity:', currentInventory.quantity, '->', currentInventory.quantity + item.quantity);
            await applyStockChange(db, {
              inventoryId: currentInventory.id,
              delta: item.quantity,
              reason: 'po_receipt',
              productId: item.productId,
              storeId: purchaseOrder.destinationStoreId ?? null,
              refType: 'purchase_order',
              refId: purchaseOrder.id,
              userId: req.user?.id ?? null,
            });
          } else {
            const barcode = generateInventoryBarcode('DC', item.productId.toString(), purchaseOrder.destinationStoreId);
            console.log('Creating new inventory item for product:', item.productId);

            // Check if product exists first
            const product = await db.query.products.findFirst({
              where: eq(products.id, item.productId)
            });

            if (!product) {
              console.error('Product not found for ID:', item.productId);
              return res.status(400).json({
                message: `Product with ID ${item.productId} not found`
              });
            }

            const [createdInventory] = await db
              .insert(inventory)
              .values({
                productId: item.productId,
                quantity: item.quantity,
                inventoryType: 'DC',
                storeId: purchaseOrder.destinationStoreId, // Explicitly link to the DC/Warehouse
                barcode,
                supplierId: purchaseOrder.supplierId,
                purchaseDate: new Date().toISOString().split('T')[0] // YYYY-MM-DD format
              })
              .returning({ id: inventory.id });

            // The new row starts at item.quantity - record that as its opening balance,
            // otherwise the ledger never adds up to inventory.quantity for this row.
            await recordOpeningStock(db, {
              inventoryId: createdInventory.id,
              quantity: item.quantity,
              reason: 'po_receipt',
              productId: item.productId,
              storeId: purchaseOrder.destinationStoreId ?? null,
              refType: 'purchase_order',
              refId: purchaseOrder.id,
              userId: req.user?.id ?? null,
            });
          }

          console.log('Updating purchase order item delivered quantity:', item.id);
          await db
            .update(purchaseOrderItems)
            .set({
              deliveredQuantity: item.quantity,
              updatedAt: new Date()
            })
            .where(eq(purchaseOrderItems.id, item.id));
        }
      }

      // Create action record
      const [newAction] = await db
        .insert(purchaseOrderActions)
        .values({
          purchaseOrderId: parseInt(id),
          actionType,
          actionData: actionData || null,
          performedByUserId: req.user!.id,
        })
        .returning({
          ...purchaseOrderActions,
          performedByUser: true
        });

      // Fetch complete action with user info
      const actionWithUser = await db.query.purchaseOrderActions.findFirst({
        where: eq(purchaseOrderActions.id, newAction.id),
        with: {
          performedByUser: true
        }
      });

      res.json({
        message: `Action '${actionType}' logged successfully`,
        action: actionWithUser
      });
    } catch (error) {
      console.error('Error creating purchase order action:', error);
      res.status(500).json({
        message: "Failed to log action",
        suggestion: "Please try again later"
      });
    }
  });

  app.get("/api/purchase-orders/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      const purchaseOrder = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, parseInt(id)),
        with: {
          supplier: true,
          items: {
            with: {
              product: true
            }
          },
          destinationStore: true
        }
      });

      if (!purchaseOrder) {
        return res.status(404).json({
          message: "Purchase order not found",
          suggestion: "Please verify the purchase order ID"
        });
      }

      res.json(purchaseOrder);
    } catch (error) {
      console.error('Error fetching purchase order:', error);
      res.status(500).json({
        message: "Failed to fetch purchase order",
        suggestion: "Please try again later"
      });
    }
  });

  app.put("/api/purchase-orders/:id/status", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const result = updatePurchaseOrderSchema.safeParse(req.body);

      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      const { status, deliveryDate, notes } = result.data;

      // Get the current purchase order
      const currentPO = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, parseInt(id)),
        with: {
          items: true
        }
      });

      if (!currentPO) {
        return res.status(404).json({
          message: "Purchase order not found",
          suggestion: "Please verify the purchase order ID"
        });
      }

      // Update purchase order
      const [updatedPO] = await db
        .update(purchaseOrders)
        .set({
          status,
          ...(deliveryDate && { deliveryDate: new Date(deliveryDate) }),
          ...(notes && { notes }),
          updatedAt: new Date()
        })
        .where(eq(purchaseOrders.id, parseInt(id)))
        .returning();

      // If status changed to 'delivered', update inventory
      if (status === 'delivered' && currentPO.status !== 'delivered') {
        for (const item of currentPO.items) {
          // AI Agent Note: Search inventory in the specific destination warehouse/store
          const [currentInventory] = await db
            .select({
              id: inventory.id,
              quantity: inventory.quantity
            })
            .from(inventory)
            .where(
              and(
                eq(inventory.productId, item.productId),
                currentPO.destinationStoreId
                  ? eq(inventory.storeId, currentPO.destinationStoreId)
                  : eq(inventory.inventoryType, 'DC')
              )
            )
            .limit(1);

          if (currentInventory) {
            // Update existing inventory
            await applyStockChange(db, {
              inventoryId: currentInventory.id,
              delta: item.quantity,
              reason: 'po_receipt',
              productId: item.productId,
              storeId: currentPO.destinationStoreId ?? null,
              refType: 'purchase_order',
              refId: currentPO.id,
              userId: req.user?.id ?? null,
            });
          } else {
            // Create new inventory entry
            const barcode = generateInventoryBarcode('DC', item.productId.toString(), currentPO.destinationStoreId);
            const [createdInventory] = await db
              .insert(inventory)
              .values({
                productId: item.productId,
                quantity: item.quantity,
                inventoryType: 'DC',
                storeId: currentPO.destinationStoreId, // Explicitly link to the DC/Warehouse
                barcode,
                supplierId: currentPO.supplierId,
                purchaseDate: new Date()
              })
              .returning({ id: inventory.id });

            await recordOpeningStock(db, {
              inventoryId: createdInventory.id,
              quantity: item.quantity,
              reason: 'po_receipt',
              productId: item.productId,
              storeId: currentPO.destinationStoreId ?? null,
              refType: 'purchase_order',
              refId: currentPO.id,
              userId: req.user?.id ?? null,
            });
          }

          // Update delivered quantity in purchase order item
          await db
            .update(purchaseOrderItems)
            .set({
              deliveredQuantity: item.quantity,
              updatedAt: new Date()
            })
            .where(eq(purchaseOrderItems.id, item.id));
        }
      }

      // Fetch updated purchase order with all details
      const purchaseOrderWithDetails = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, updatedPO.id),
        with: {
          supplier: true,
          items: {
            with: {
              product: true
            }
          }
        }
      });

      res.json({
        message: "Purchase order updated successfully",
        purchaseOrder: purchaseOrderWithDetails
      });
    } catch (error) {
      console.error('Error updating purchase order:', error);
      res.status(500).json({
        message: "Failed to update purchase order",
        suggestion: "Please try again later"
      });
    }
  });

  app.get("/api/purchase-orders/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      const purchaseOrder = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, parseInt(id)),
        with: {
          supplier: true,
          items: {
            with: {
              product: true
            }
          }
        }
      });

      if (!purchaseOrder) {
        return res.status(404).json({
          message: "Purchase order not found",
          suggestion: "Please verify the purchase order ID"
        });
      }

      res.json(purchaseOrder);
    } catch (error) {
      console.error('Error fetching purchase order:', error);
      res.status(500).json({
        message: "Failed to fetch purchase order",
        suggestion: "Please try again later"
      });
    }
  });

  app.get("/api/customer-profiles", requirePermission('customerProfiles', 'read'), async (req, res) => {
    try {
      const allCustomerProfiles = await db.query.customerProfiles.findMany({
        orderBy: [desc(customerProfiles.updatedAt)],
      });
      res.json(allCustomerProfiles);
    } catch (error) {
      console.error('Error fetching customer profiles:', error);
      res.status(500).json({
        message: "Failed to fetch customer profiles",
        suggestion: "Please try again later"
      });
    }
  });

  app.post("/api/customer-profiles", requirePermission('customerProfiles', 'create'), async (req, res) => {
    try {
      const result = insertCustomerProfileSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      const { phoneNumber, name, email, address, photo, petBirthday, petType } = result.data;

      // Check if customer profile exists
      const existingProfile = await db.query.customerProfiles.findFirst({
        where: eq(customerProfiles.phoneNumber, phoneNumber),
      });

      if (existingProfile) {
        return res.status(400).json({
          message: "Customer profile with this phone number already exists",
          suggestion: "Please use a different phone number"
        });
      }

      const [newCustomerProfile] = await db
        .insert(customerProfiles)
        .values({
          phoneNumber,
          name,
          email,
          address,
          photo: photo || null,
          petBirthday: petBirthday ? new Date(petBirthday) : null,
          petType,
        })
        .returning();

      res.json({
        message: "Customer profile created successfully",
        customerProfile: newCustomerProfile,
      });
    } catch (error) {
      console.error('Error creating customer profile:', error);
      res.status(500).json({
        message: "Failed to create customer profile",
        suggestion: "Please try again later"
      });
    }
  });

  app.put("/api/customer-profiles/:id", requirePermission('customerProfiles', 'update'), async (req, res) => {
    try {
      const { id } = req.params;
      const result = insertCustomerProfileSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      const { phoneNumber, name, email, address, photo, petBirthday, petType } = result.data;

      // Check if phone number is already used by another profile
      const existingProfile = await db.query.customerProfiles.findFirst({
        where: and(
          eq(customerProfiles.phoneNumber, phoneNumber),
          sql`id != ${id}`
        ),
      });

      if (existingProfile) {
        return res.status(400).json({
          message: "Phone number already exists",
          suggestion: "Please use a different phone number"
        });
      }

      const [updatedProfile] = await db
        .update(customerProfiles)
        .set({
          phoneNumber,
          name,
          email,
          address,
          photo: photo || null,
          petBirthday: petBirthday ? new Date(petBirthday) : null,
          petType,
          updatedAt: new Date()
        })
        .where(eq(customerProfiles.id, parseInt(id)))
        .returning();

      res.json({
        message: "Customer profile updated successfully",
        customerProfile: updatedProfile,
      });
    } catch (error) {
      console.error('Error updating customer profile:', error);
      res.status(500).json({
        message: "Failed to update customer profile",
        suggestion: "Please try again later"
      });
    }
  });

  app.delete("/api/customer-profiles/:id", requirePermission('customerProfiles', 'delete'), async (req, res) => {
    try {
      const { id } = req.params;

      // Check if customer profile exists
      const profile = await db.query.customerProfiles.findFirst({
        where: eq(customerProfiles.id, parseInt(id)),
      });

      if (!profile) {
        return res.status(404).json({
          message: "Customer profile not found",
          suggestion: "Please verify the profile ID"
        });
      }

      await db
        .delete(customerProfiles)
        .where(eq(customerProfiles.id, parseInt(id)));

      res.json({ message: "Customer profile deleted successfully" });
    } catch (error) {
      console.error('Error deleting customer profile:', error);
      res.status(500).json({
        message: "Failed to delete customer profile",
        suggestion: "Please try again later"
      });
    }
  });



  // Roles endpoints
  app.get("/api/roles", requirePermission('users', 'read'), async (req, res) => {
    try {
      const allRoles = await db.query.roles.findMany({
        orderBy: roles.name,
      });
      res.json(allRoles);
    } catch (error) {
      console.error('Error fetching roles:', error);
      res.status(500).send("Failed to fetch roles");
    }
  });

  app.post("/api/roles", requirePermission('users', 'create'), validateBody(roleBodySchema, "Provide a role name and optional permissions"), async (req, res) => {
    try {
      const { name, description, isSystemAdmin, permissions } = req.body;

      if (!name) {
        return res.status(400).send("Role name is required");
      }

      // Set default permissions - Admin gets all permissions by default
      const defaultPermissions = permissions || (name === 'admin' ? {
        products: { create: true, read: true, update: true, delete: true },
        orders: { create: true, read: true, update: true, delete: true },
        inventory: { create: true, read: true, update: true, delete: true },
        users: { create: true, read: true, update: true, delete: true },
        stores: { create: true, read: true, update: true, delete: true },
        masterData: { create: true, read: true, update: true, delete: true },
        pos: { create: true, read: true, update: true, delete: true },
        receipts: { create: true, read: true, update: true, delete: true },
        customerProfiles: { create: true, read: true, update: true, delete: true }
      } : {
        products: { create: false, read: true, update: false, delete: false },
        orders: { create: false, read: false, update: false, delete: false },
        inventory: { create: false, read: false, update: false, delete: false },
        users: { create: false, read: false, update: false, delete: false },
        stores: { create: false, read: false, update: false, delete: false },
        masterData: { create: false, read: false, update: false, delete: false },
        pos: { create: false, read: false, update: false, delete: false },
        receipts: { create: false, read: false, update: false, delete: false },
        customerProfiles: { create: false, read: false, update: false, delete: false }
      });

      const [newRole] = await db
        .insert(roles)
        .values({
          name,
          description,
          isSystemAdmin: !!isSystemAdmin,
          permissions: defaultPermissions,
        })
        .returning();

      res.json({
        message: "Role created successfully",
        role: newRole,
      });
    } catch (error) {
      console.error('Error creating role:', error);
      res.status(500).send("Failed to create role");
    }
  });

  app.put("/api/roles/:id", requirePermission('users', 'update'), validateParams(idParamSchema, "Use a numeric role id"), validateBody(roleBodySchema, "Provide a role name"), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, isSystemAdmin } = req.body;

      if (!name) {
        return res.status(400).send("Role name is required");
      }

      // Prevent updating admin role name
      const roleToUpdate = await db.query.roles.findFirst({
        where: eq(roles.id, parseInt(id)),
      });

      if (roleToUpdate?.name === 'admin' && name !== 'admin') {
        return res.status(400).send("Cannot modify admin role name");
      }

      const [updatedRole] = await db
        .update(roles)
        .set({
          name,
          description,
          isSystemAdmin: !!isSystemAdmin,
          updatedAt: new Date(),
        })
        .where(eq(roles.id, parseInt(id)))
        .returning();

      res.json({
        message: "Role updated successfully",
        role: updatedRole,
      });
    } catch (error) {
      console.error('Error updating role:', error);
      res.status(500).send("Failed to update role");
    }
  });

  app.delete("/api/roles/:id", requirePermission('users', 'delete'), validateParams(idParamSchema, "Use a numeric role id"), async (req, res) => {
    try {
      const id = Number(req.params.id);

      // Check if role exists and is not admin
      const roleToDelete = await db.query.roles.findFirst({
        where: eq(roles.id, id),
      });

      if (!roleToDelete) {
        return res.status(404).send("Role not found");
      }

      if (roleToDelete.name === 'admin') {
        return res.status(400).send("Cannot delete admin role");
      }

      // Check if role is assigned to any users
      const usersWithRole = await db.query.users.findMany({
        where: eq(users.roleId, id),
      });

      if (usersWithRole.length > 0) {
        return res.status(400).send("Cannot delete role that is assigned to users");
      }

      await db
        .delete(roles)
        .where(eq(roles.id, id));

      res.json({ message: "Role deleted successfully" });
    } catch (error) {
      console.error('Error deleting role:', error);
      res.status(500).send("Failed to delete role");
    }
  });

  // Add new endpoint for updating role permissions
  app.put("/api/roles/:id/permissions", requirePermission('users', 'update'), validateParams(idParamSchema, "Use a numeric role id"), validateBody(rolePermissionsSchema, "Send a permissions object"), async (req, res) => {
    try {
      const { id } = req.params;
      const { permissions } = req.body;

      // Prevent modifying admin role permissions
      const roleToUpdate = await db.query.roles.findFirst({
        where: eq(roles.id, parseInt(id)),
      });

      if (!roleToUpdate) {
        return res.status(404).send("Role not found");
      }

      if (roleToUpdate.name === 'admin') {
        return res.status(400).send("Cannot modify admin role permissions");
      }

      const [updatedRole] = await db
        .update(roles)
        .set({
          permissions,
          updatedAt: new Date(),
        })
        .where(eq(roles.id, parseInt(id)))
        .returning();

      res.json({
        message: "Role permissions updated successfully",
        role: updatedRole,
      });
    } catch (error) {
      console.error('Error updating role permissions:', error);
      res.status(500).send("Failed to update role permissions");
    }
  });

  // Region Management endpoints - admin and regional managers only
  app.get("/api/regions", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Global managers and admins can see all regions
      // Regional managers can only see their own region
      let whereCondition = undefined;

      if (user.role?.hierarchyLevel === 'regional_manager') {
        // Regional managers can only see regions they manage
        whereCondition = eq(regions.managerUserId, user.id);
      }

      const allRegions = await db.query.regions.findMany({
        where: whereCondition,
        with: {
          managerUser: true,
        },
        orderBy: [desc(regions.updatedAt)],
      });

      res.json(allRegions);
    } catch (error) {
      console.error('Error fetching regions:', error);
      res.status(500).json({
        message: "Failed to fetch regions",
        suggestion: "Please try again later"
      });
    }
  });

  app.post("/api/regions", requirePermission('stores', 'create'), async (req, res) => {
    try {
      const { name, description, managerUserId } = req.body;

      if (!name) {
        return res.status(400).json({
          message: "Region name is required",
          suggestion: "Provide a name for the region"
        });
      }

      // Check if region name already exists
      const existingRegion = await db.query.regions.findFirst({
        where: eq(regions.name, name),
      });

      if (existingRegion) {
        return res.status(400).json({
          message: "Region with this name already exists",
          suggestion: "Please use a different region name"
        });
      }

      // Validate manager user if provided
      if (managerUserId) {
        const managerUser = await db.query.users.findFirst({
          where: eq(users.id, managerUserId),
          with: {
            role: true,
          },
        });

        if (!managerUser) {
          return res.status(400).json({
            message: "Manager user not found",
            suggestion: "Select a valid user as region manager"
          });
        }

        if (managerUser.role?.hierarchyLevel !== 'regional_manager') {
          return res.status(400).json({
            message: "Manager must have regional_manager role",
            suggestion: "Assign regional_manager role to the user first"
          });
        }

        // Check if user is already managing another region
        const existingManagedRegion = await db.query.regions.findFirst({
          where: eq(regions.managerUserId, managerUserId),
        });

        if (existingManagedRegion) {
          return res.status(400).json({
            message: "User is already managing another region",
            suggestion: "Select a different user or remove them from their current region"
          });
        }
      }

      const [newRegion] = await db
        .insert(regions)
        .values({
          name,
          description: description || null,
          managerUserId: managerUserId || null,
        })
        .returning();

      // Fetch the complete region with manager
      const regionWithManager = await db.query.regions.findFirst({
        where: eq(regions.id, newRegion.id),
        with: {
          managerUser: true,
        },
      });

      res.json({
        message: "Region created successfully",
        region: regionWithManager,
      });
    } catch (error) {
      console.error('Error creating region:', error);
      res.status(500).json({
        message: "Failed to create region",
        suggestion: "Please try again later"
      });
    }
  });

  app.put("/api/regions/:id", requirePermission('stores', 'update'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, managerUserId } = req.body;

      if (!name) {
        return res.status(400).json({
          message: "Region name is required",
          suggestion: "Provide a name for the region"
        });
      }

      // Check if another region has the same name
      const existingRegion = await db.query.regions.findFirst({
        where: and(
          eq(regions.name, name),
          sql`id != ${id}`
        ),
      });

      if (existingRegion) {
        return res.status(400).json({
          message: "Region with this name already exists",
          suggestion: "Please use a different region name"
        });
      }

      // Validate manager user if provided
      if (managerUserId) {
        const managerUser = await db.query.users.findFirst({
          where: eq(users.id, managerUserId),
          with: {
            role: true,
          },
        });

        if (!managerUser) {
          return res.status(400).json({
            message: "Manager user not found",
            suggestion: "Select a valid user as region manager"
          });
        }

        if (managerUser.role?.hierarchyLevel !== 'regional_manager') {
          return res.status(400).json({
            message: "Manager must have regional_manager role",
            suggestion: "Assign regional_manager role to the user first"
          });
        }

        // Check if user is already managing another region (excluding current)
        const existingManagedRegion = await db.query.regions.findFirst({
          where: and(
            eq(regions.managerUserId, managerUserId),
            sql`id != ${id}`
          ),
        });

        if (existingManagedRegion) {
          return res.status(400).json({
            message: "User is already managing another region",
            suggestion: "Select a different user or remove them from their current region"
          });
        }
      }

      const [updatedRegion] = await db
        .update(regions)
        .set({
          name,
          description: description || null,
          managerUserId: managerUserId || null,
          updatedAt: new Date(),
        })
        .where(eq(regions.id, parseInt(id)))
        .returning();

      if (!updatedRegion) {
        return res.status(404).json({
          message: "Region not found",
          suggestion: "Please verify the region ID"
        });
      }

      // Fetch the complete region with manager
      const regionWithManager = await db.query.regions.findFirst({
        where: eq(regions.id, updatedRegion.id),
        with: {
          managerUser: true,
        },
      });

      res.json({
        message: "Region updated successfully",
        region: regionWithManager,
      });
    } catch (error) {
      console.error('Error updating region:', error);
      res.status(500).json({
        message: "Failed to update region",
        suggestion: "Please try again later"
      });
    }
  });

  app.delete("/api/regions/:id", requirePermission('stores', 'delete'), async (req, res) => {
    try {
      const { id } = req.params;

      // Check if region exists
      const region = await db.query.regions.findFirst({
        where: eq(regions.id, parseInt(id)),
      });

      if (!region) {
        return res.status(404).json({
          message: "Region not found",
          suggestion: "Please verify the region ID"
        });
      }

      // Check if region has any stores assigned
      const storesInRegion = await db.query.stores.findMany({
        where: eq(stores.regionId, parseInt(id)),
        limit: 1,
      });

      if (storesInRegion.length > 0) {
        return res.status(400).json({
          message: "Cannot delete region with assigned stores",
          suggestion: "Reassign or remove all stores from this region first"
        });
      }

      await db
        .delete(regions)
        .where(eq(regions.id, parseInt(id)));

      res.json({
        message: "Region deleted successfully"
      });
    } catch (error) {
      console.error('Error deleting region:', error);
      res.status(500).json({
        message: "Failed to delete region",
        suggestion: "Please try again later"
      });
    }
  });

  // Category Management endpoints
  app.get("/api/categories", requirePermission('masterData', 'read'), async (req, res) => {
    try {
      const allCategories = await db.query.categories.findMany({
        orderBy: [desc(categories.updatedAt)],
      });
      res.json(allCategories);
    } catch (error) {
      console.error('Error fetching categories:', error);
      res.status(500).send("Failed to fetch categories");
    }
  });

  app.post("/api/categories", requirePermission("masterData", "create"), async (req, res) => {
    try {
      const { name, description, parentId } = req.body;
      const categoryName = typeof name === "string" ? normalizeWhitespace(name) : "";

      if (!categoryName) {
        return res.status(400).send("Category name is required");
      }

      // Check if category exists
      const existingCategory = await db.query.categories.findFirst({
        where: eq(categories.name, categoryName),
      });

      if (existingCategory) {
        return res.status(400).send("Category name already exists");
      }

      const [newCategory] = await db
        .insert(categories)
        .values({
          name: categoryName,
          description,
          parentId: parentId || null,
        })
        .returning();

      res.json({
        message: "Category created successfully",
        category: newCategory,
      });
    } catch (error) {
      console.error("Error creating category:", error);
      res.status(500).send("Failed to create category");
    }
  });

  app.put("/api/categories/:id", requirePermission("masterData", "update"), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, parentId } = req.body;
      const categoryName = typeof name === "string" ? normalizeWhitespace(name) : "";

      if (!categoryName) {
        return res.status(400).send("Category name is required");
      }

      // Check if category exists
      const existingCategory = await db.query.categories.findFirst({
        where: and(
          eq(categories.name, categoryName),
          sql`id != ${id}`
        ),
      });

      if (existingCategory) {
        return res.status(400).send("Category name already exists");
      }

      const [updatedCategory] = await db
        .update(categories)
        .set({
          name: categoryName,
          description,
          parentId: parentId || null,
          updatedAt: new Date(),
        })
        .where(eq(categories.id, parseInt(id)))
        .returning();

      if (!updatedCategory) {
        return res.status(404).send("Category not found");
      }

      res.json({
        message: "Category updated successfully",
        category: updatedCategory,
      });
    } catch (error) {
      console.error("Error updating category:", error);
      res.status(500).send("Failed to update category");
    }
  });

  app.delete("/api/categories/:id", requirePermission('masterData', 'delete'), async (req, res) => {
    try {
      const categoryId = parseInt(req.params.id, 10);

      if (Number.isNaN(categoryId)) {
        return res.status(400).json({
          code: "INVALID_CATEGORY_ID",
          message: "Invalid category id",
        });
      }

      const category = await db.query.categories.findFirst({
        where: eq(categories.id, categoryId),
      });

      if (!category) {
        return res.status(404).json({
          code: "CATEGORY_NOT_FOUND",
          message: "Category not found",
        });
      }

      // Rule 1: a category that has sub categories cannot be deleted
      const subCategories = await db.query.categories.findMany({
        where: eq(categories.parentId, categoryId),
        columns: { name: true },
        orderBy: [categories.name],
      });

      if (subCategories.length > 0) {
        const subCategoryNames = subCategories.map((sub) => sub.name);
        const quotedNames = subCategoryNames.map((name) => `"${name}"`);

        const message = subCategoryNames.length === 1
          ? `Cannot delete category "${category.name}" because sub category ${quotedNames[0]} exists. Please delete or move this sub category first.`
          : `Cannot delete category "${category.name}" because ${subCategoryNames.length} sub categories exist (${formatNameList(quotedNames)}). Please delete or move these sub categories first.`;

        return res.status(409).json({
          code: "CATEGORY_HAS_SUB_CATEGORIES",
          message,
          subCategoryCount: subCategoryNames.length,
          subCategories: subCategoryNames,
        });
      }

      // Rule 2: a category that is assigned to products cannot be deleted
      const categoryProducts = await db.query.products.findMany({
        where: eq(products.categoryId, categoryId),
        columns: { name: true },
        orderBy: [products.name],
      });

      if (categoryProducts.length > 0) {
        const productNames = categoryProducts.map((product) => product.name);
        const quotedNames = productNames.map((name) => `"${name}"`);

        const message = productNames.length === 1
          ? `Cannot delete category "${category.name}" because product ${quotedNames[0]} is associated to this category. Please remove the product association first.`
          : `Cannot delete category "${category.name}" because ${productNames.length} products are associated to this category (${formatNameList(quotedNames)}). Please remove the product associations first.`;

        return res.status(409).json({
          code: "CATEGORY_HAS_PRODUCTS",
          message,
          productCount: productNames.length,
          products: productNames,
        });
      }

      await db
        .delete(categories)
        .where(eq(categories.id, categoryId));

      res.json({ message: "Category deleted successfully" });
    } catch (error) {
      console.error('Error deleting category:', error);
      res.status(500).json({
        code: "CATEGORY_DELETE_FAILED",
        message: "Failed to delete category"
      });
    }
  });

  // CSV/Excel import for the Categories screen. Rows are matched by name; the
  // optional "Parent Category" column is resolved by name and created as a root
  // category when it does not exist yet.
  app.post("/api/categories/import", requirePermission("masterData", "create"), async (req, res) => {
    const parsed = masterDataImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid import request",
        errors: parsed.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    try {
      const result = await importCategories(parsed.data.rows, {
        updateExisting: parsed.data.updateExisting,
      });

      res.json({
        message: buildMasterDataImportMessage(result),
        ...result,
      });
    } catch (error) {
      console.error('Error importing categories:', error);
      res.status(500).json({ message: "Failed to import categories" });
    }
  });

  // Bulk delete for the Categories screen (checkbox selection in the list). Each
  // category keeps the same rules as the single delete endpoint; protected
  // categories are reported back instead of aborting the batch.
  app.post("/api/categories/bulk-delete", requirePermission('masterData', 'delete'), async (req, res) => {
    const parsed = masterDataBulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid delete request",
        suggestion: parsed.error.issues[0]?.message ?? "Provide an array of category ids",
      });
    }

    try {
      const { deleted, failed } = await bulkDeleteCategories(parsed.data.ids);

      res.json({
        message: buildBulkDeleteMessage("category", deleted.length, failed.length),
        deletedCount: deleted.length,
        failedCount: failed.length,
        deleted,
        failed,
      });
    } catch (error) {
      console.error('Error bulk deleting categories:', error);
      res.status(500).json({ message: "Failed to delete categories" });
    }
  });

  // Role Mapping endpoint
  app.get("/api/roles/mapping", requirePermission('users', 'read'), async (req, res) => {
    try {
      // Fetch roles with users and role types
      const roles = await db.query.roles.findMany({
        with: {
          users: {
            columns: {
              id: true,
              username: true,
              password: false, // Exclude sensitive data
              roleId: true,
              createdAt: false,
              updatedAt: false
            }
          }
        },
      });

      res.json({
        roles,
      });
    } catch (error) {
      console.error('Error fetching role mapping:', error);
      res.status(500).json({
        message: "Failed to fetch role mapping",
        suggestion: "Please try again later"
      });
    }
  });

  // User management endpoints
  app.get("/api/users", requirePermission('users', 'read'), async (req, res) => {
    try {
      const allUsers = await db.query.users.findMany({
        with: {
          role: true,
        },
      });

      // Remove sensitive information
      const sanitizedUsers = allUsers.map(({ password, ...user }) => user);
      res.json(sanitizedUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).send("Failed to fetch users");
    }
  });

  app.post("/api/users", requirePermission('users', 'create'), validateBody(insertUserSchema, "Provide a username, password and role"), async (req, res) => {
    try {
      const { username, password, roleId } = req.body;

      // Check if user exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.username, username),
      });

      if (existingUser) {
        return res.status(400).send("Username already exists");
      }

      // Hash password using the crypto utility
      const hashedPassword = await crypto.hash(password);

      const [newUser] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
          roleId,
        })
        .returning();

      // Fetch the complete user with role
      const userWithRole = await db.query.users.findFirst({
        where: eq(users.id, newUser.id),
        with: {
          role: true,
        },
      });

      res.json({
        message: "User created successfully",
        user: userWithRole,
      });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).send("Failed to create user");
    }
  });

  app.put("/api/users/:id", requirePermission('users', 'update'), validateParams(idParamSchema, "Use a numeric user id"), validateBody(updateUserSchema, "Provide the fields to update"), async (req, res) => {
    try {
      const id = Number(req.params.id);

      // Validate input
      const { username, roleId, password } = req.body;

      if (!username && !roleId && !password) {
        return res.status(400).json({
          message: "No updates provided",
          suggestion: "Provide either username or roleId to update"
        });
      }

      // Verify user exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.id, id),
        with: {
          role: true,
        },
      });

      if (!existingUser) {
        return res.status(404).json({
          message: "User not found",
          suggestion: "Please verify the user ID"
        });
      }

      // Check if new username is already taken by another user
      if (username) {
        const duplicateUser = await db.query.users.findFirst({
          where: and(
            eq(users.username, username),
            sql`id != ${id}`
          ),
        });

        if (duplicateUser) {
          return res.status(400).json({
            message: "Username already exists",
            suggestion: "Please choose a different username"
          });
        }
      }

      //If password provided, hash it
      const hashedPassword = password ? await crypto.hash(password) : existingUser.password;


      // If roleId provided, verify it exists
      if (roleId) {
        const role = await db.query.roles.findFirst({
          where: eq(roles.id, roleId),
        });

        if (!role) {
          return res.status(400).json({
            message: "Invalid role ID",
            suggestion: "Please provide a valid role ID"
          });
        }
      }

      // Update user
      const [updatedUser] = await db
        .update(users)
        .set({
          ...(username && { username }),
          ...(roleId && { roleId }),
          ...(password && { password: hashedPassword }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();

      // Fetch updated user with role information
      const userWithRole = await db.query.users.findFirst({
        where: eq(users.id, updatedUser.id),
        with: {
          role: true,
        },
      });

      res.json({
        message: "User updated successfully",
        user: userWithRole,
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({
        message: "Failed to update user",
        suggestion: "Please try again later"
      });
    }
  });

  app.delete("/api/users/:id", requirePermission('users', 'delete'), validateParams(idParamSchema, "Use a numeric user id"), async (req, res) => {
    try {
      const id = Number(req.params.id);

      // Prevent deleting the last admin
      const adminRole = await db.query.roles.findFirst({
        where: eq(roles.name, 'admin'),
      });

      if (adminRole) {
        const adminUsers = await db.query.users.findMany({
          where: eq(users.roleId, adminRole.id),
        });

        if (adminUsers.length <= 1) {
          const userToDelete = await db.query.users.findFirst({
            where: eq(users.id, id),
            with: {
              role: true,
            },
          });

          if (userToDelete?.role.name === 'admin') {
            return res.status(400).send("Cannot delete the last admin user");
          }
        }
      }

      await db
        .delete(users)
        .where(eq(users.id, id));

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).send("Failed to delete user");
    }
  });

  // User-Store Assignment endpoints
  app.get("/api/store-assignments", requirePermission('stores', 'read'), async (req, res) => {
    try {
      const assignments = await db.query.userStoreAssignments.findMany({
        with: {
          user: true,
          store: true,
        },
      });
      res.json(assignments);
    } catch (error) {
      console.error('Error fetching store assignments:', error);
      res.status(500).send("Failed to fetch store assignments");
    }
  });

  app.get("/api/store-assignments/users", requirePermission('users', 'read'), async (req, res) => {
    try {
      // Get all non-system admin users
      const petStoreUsers = await db
        .select({
          id: users.id,
          username: users.username,
          role: {
            id: roles.id,
            name: roles.name,
            isSystemAdmin: roles.isSystemAdmin
          }
        })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(eq(roles.isSystemAdmin, false));

      console.log('Pet Store users found:', petStoreUsers.length);
      res.json(petStoreUsers);
    } catch (error) {
      console.error('Error fetching pet store users:', error);
      res.status(500).json({
        message: "Failed to fetch pet store users",
        suggestion: "Please try again later"
      });
    }
  });

  app.post("/api/store-assignments", requirePermission('users', 'create'), async (req, res) => {
    try {
      const { userId, storeId } = req.body;

      if (!userId || !storeId) {
        return res.status(400).send("User ID and Store ID are required");
      }

      // Check if user exists and has pet store role
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        with: {
          role: true
        }
      });

      if (!user) {
        return res.status(404).send("User not found");
      }

      if (user.role?.isSystemAdmin) {
        return res.status(400).send("System administrators cannot be assigned to specific stores as they have global access");
      }

      // Check if store exists
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, storeId)
      });

      if (!store) {
        return res.status(404).send("Store not found");
      }

      // Check if assignment already exists
      const existingAssignment = await db.query.userStoreAssignments.findFirst({
        where: and(
          eq(userStoreAssignments.userId, userId),
          eq(userStoreAssignments.storeId, storeId)
        )
      });

      if (existingAssignment) {
        return res.status(400).send("User is already assigned to this store");
      }

      const [newAssignment] = await db
        .insert(userStoreAssignments)
        .values({
          userId,
          storeId
        })
        .returning();

      const assignmentWithDetails = await db.query.userStoreAssignments.findFirst({
        where: eq(userStoreAssignments.id, newAssignment.id),
        with: {
          user: true,
          store: true
        }
      });

      res.json({
        message: "Store assignment created successfully",
        assignment: assignmentWithDetails
      });
    } catch (error) {
      console.error('Error creating store assignment:', error);
      res.status(500).send("Failed to create store assignment");
    }
  });

  app.delete("/api/store-assignments/:id", requirePermission('users', 'delete'), async (req, res) => {
    try {
      const { id } = req.params;

      const [assignment] = await db
        .select()
        .from(userStoreAssignments)
        .where(eq(userStoreAssignments.id, parseInt(id)))
        .limit(1);

      if (!assignment) {
        return res.status(404).send("Assignment not found");
      }

      await db
        .delete(userStoreAssignments)
        .where(eq(userStoreAssignments.id, parseInt(id)));

      res.json({ message: "Store assignment deleted successfully" });
    } catch (error) {
      console.error('Error deleting store assignment:', error);
      res.status(500).send("Failed to delete store assignment");
    }
  });

  // Stats API
  app.get("/api/stats", requirePermission('users', 'read'), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // AI Agent Note: aggregates need the same store filter as the lists, otherwise
      // a manager's revenue tile still sums every store's orders.
      const scope = await resolveScope(user);
      const storeFilter = scopeStoreFilter(scope, orders.storeId);

      const [orderStats] = await db
        .select({
          totalOrders: sql<number>`count(*)`,
          revenue: sql<number>`sum(total)`,
        })
        .from(orders)
        .where(
          and(
            gte(orders.createdAt, new Date(new Date().setDate(new Date().getDate() - 30))),
            lt(orders.createdAt, new Date()),
            storeFilter
          )
        );

      res.json({
        last30Days: {
          orders: orderStats.totalOrders ?? 0,
          revenue: orderStats.revenue ?? 0,
        }
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).send("Failed to fetch stats");
    }
  });

  //// Orders trend for chart
  app.get("/api/stats/orders-trend", requirePermission('users', 'read'), async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const scope = await resolveScope(user);
    const storeFilter = scopeStoreFilter(scope, orders.storeId);

    const trend = await db
      .select({
        date: sql<string>`date_trunc('day', created_at)::date`,
        orders: sql<number>`count(*)`,
      })
      .from(orders)
      .where(storeFilter)
      .groupBy(sql`date_trunc('day', created_at)`)
      .orderBy(sql`date_trunc('day', created_at)`)
      .limit(30);

    res.json(trend);
  });

  // Products API - available to all authenticated users
  app.get("/api/products", requireAuth, async (req, res) => {
    try {
      const allProducts = await db.query.products.findMany({
        with: {
          category: true,
          inventory: true,
          brand: true,
          supplier: true,
        },
        orderBy: [desc(products.updatedAt)],
      });
      res.json(allProducts);
    } catch (error) {
      console.error('Error fetching products:', error);
      res.status(500).send("Failed to fetch products");
    }
  });

  // Products API - Get products available in a specific store with stock > 0
  app.get("/api/products/available-in-store", requireAuth, async (req, res) => {
    try {
      const { storeId } = req.query;

      if (!storeId) {
        return res.status(400).json({
          message: "storeId query parameter is required",
          suggestion: "Provide a storeId to filter products"
        });
      }

      // Parse storeId - if it's "DC", treat as null for DC inventory
      const parsedStoreId = storeId === 'DC' ? null : parseInt(storeId as string);

      if (storeId !== 'DC' && isNaN(parsedStoreId!)) {
        return res.status(400).json({
          message: "Invalid storeId format",
          suggestion: "storeId must be a number or 'DC'"
        });
      }

      // Get products that have inventory > 0 in the specified store
      const productsWithInventory = await db
        .select({
          id: products.id,
          name: products.name,
          sku: products.sku,
          price: products.price,
          landingPrice: products.landingPrice,
          b2bPrice: products.b2bPrice,
          b2cPrice: products.b2cPrice,
          description: products.description,
          categoryId: products.categoryId,
          brandId: products.brandId,
          minStock: products.minStock,
          category: {
            id: categories.id,
            name: categories.name,
          },
          brand: {
            id: brands.id,
            name: brands.name,
          },
          inventory: {
            id: inventory.id,
            quantity: inventory.quantity,
            storeId: inventory.storeId,
            inventoryType: inventory.inventoryType,
          },
        })
        .from(products)
        .innerJoin(inventory, eq(products.id, inventory.productId))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .leftJoin(brands, eq(products.brandId, brands.id))
        .where(
          and(
            gt(inventory.quantity, 0),
            parsedStoreId === null
              ? isNull(inventory.storeId)
              : eq(inventory.storeId, parsedStoreId)
          )
        )
        .orderBy(products.name);

      res.json(productsWithInventory);
    } catch (error) {
      console.error('Error fetching products available in store:', error);
      res.status(500).json({
        message: "Failed to fetch products available in store",
        suggestion: "Please try again later"
      });
    }
  });

  // Products schema
  const insertProductSchema = z.object({
    name: z.string().min(1, "Product name is required"),
    description: z.string().nullable().optional(),
    sku: z.string().min(1, "SKU is required"),
    // `price` is no longer entered in the product form. It is kept as the
    // effective selling price and derived from the price tiers below.
    price: z.number().min(0, "Price must be positive").optional(),
    // Optional price tiers - omitted/null when not provided.
    // B2C (retail) price is mandatory: it is the selling price used by the
    // product list and POS, and it is what the legacy `price` is derived from.
    landingPrice: z.number().min(0, "Landing price must be positive").nullable().optional(),
    b2bPrice: z.number().min(0, "B2B price must be positive").nullable().optional(),
    b2cPrice: z
      .number({
        required_error: "B2C price is required",
        invalid_type_error: "B2C price is required",
      })
      .min(0, "B2C price must be positive"),
    categoryId: z.number().positive("Category ID is required"),
    minStock: z.number().int().min(0, "Minimum stock must be positive").optional(),
    // Brands are optional: the UI sends `null` when "No brand" is selected
    brandId: z.number().positive("Brand ID is required").nullable().optional(),
    // Suppliers are optional: the UI sends `null` when "No supplier" is selected
    supplierId: z.number().positive("Supplier ID is required").nullable().optional(),
    // Optional physical attributes: weight is in kilograms, dimensions in centimetres.
    weightKg: z.number().min(0, "Weight must be positive").nullable().optional(),
    lengthCm: z.number().min(0, "Length must be positive").nullable().optional(),
    widthCm: z.number().min(0, "Width must be positive").nullable().optional(),
    heightCm: z.number().min(0, "Height must be positive").nullable().optional(),
  });


  // The product form no longer collects a separate price, so the legacy
  // `price` column (used by POS/sales) is derived from the price tiers,
  // preferring the retail (B2C) value.
  const derivePrice = ({
    price,
    landingPrice,
    b2bPrice,
    b2cPrice,
  }: {
    price?: number | null;
    landingPrice?: number | null;
    b2bPrice?: number | null;
    b2cPrice?: number | null;
  }): number | undefined => {
    if (price !== undefined && price !== null) return price;
    return b2cPrice ?? b2bPrice ?? landingPrice ?? undefined;
  };

  // Decimal columns are stored as strings; null means "not set".
  const toDecimalOrNull = (value: number | null | undefined) =>
    value === undefined || value === null ? null : String(value);

  // Products API - Create product
  app.post("/api/products", requirePermission('products', 'create'), async (req, res) => {
    try {
      const result = insertProductSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      const { name, sku, price, description, categoryId, minStock, brandId, supplierId, landingPrice, b2bPrice, b2cPrice, weightKg, lengthCm, widthCm, heightCm } = result.data;


      // Check if SKU already exists
      const existingProduct = await db.query.products.findFirst({
        where: eq(products.sku, sku),
      });

      if (existingProduct) {
        return res.status(400).json({
          message: "SKU already exists",
          suggestion: "Please use a different SKU"
        });
      }

      // Check if category exists
      const category = await db.query.categories.findFirst({
        where: eq(categories.id, categoryId),
      });

      if (!category) {
        return res.status(400).json({
          message: "Category not found",
          suggestion: "Please select a valid category"
        });
      }

      // Check if brand exists (only when a brand was actually selected).
      // Note: brandId is optional, so we must never query with `undefined` —
      // postgres-js throws UNDEFINED_VALUE for undefined bind parameters.
      if (brandId !== undefined && brandId !== null) {
        const brand = await db.query.brands.findFirst({
          where: eq(brands.id, brandId),
        });

        if (!brand) {
          return res.status(400).json({
            message: "Brand not found",
            suggestion: "Please select a valid brand"
          });
        }
      }

      // Check if supplier exists (only when a supplier was actually selected).
      if (supplierId !== undefined && supplierId !== null) {
        const supplier = await db.query.suppliers.findFirst({
          where: eq(suppliers.id, supplierId),
        });

        if (!supplier) {
          return res.status(400).json({
            message: "Supplier not found",
            suggestion: "Please select a valid supplier"
          });
        }
      }

      const [newProduct] = await db
        .insert(products)
        .values({
          name,
          sku,
          price: String(derivePrice({ price, landingPrice, b2bPrice, b2cPrice }) ?? 0),
          landingPrice: toDecimalOrNull(landingPrice),
          b2bPrice: toDecimalOrNull(b2bPrice),
          b2cPrice: toDecimalOrNull(b2cPrice),
          description: description ?? null,
          categoryId,
          minStock: minStock ?? 0,
          brandId: brandId ?? null,
          supplierId: supplierId ?? null,
          // Optional physical attributes (nullable when not provided).
          weightKg: toDecimalOrNull(weightKg),
          lengthCm: toDecimalOrNull(lengthCm),
          widthCm: toDecimalOrNull(widthCm),
          heightCm: toDecimalOrNull(heightCm),
        })
        .returning();

      // Fetch the complete product with category, brand and supplier
      const productWithCategoryAndBrand = await db.query.products.findFirst({
        where: eq(products.id, newProduct.id),
        with: {
          category: true,
          brand: true,
          supplier: true,
        },
      });

      res.json({
        message: "Product created successfully",
        product: productWithCategoryAndBrand,
      });
    } catch (error) {
      console.error('Error creating product:', error);
      res.status(500).json({
        message: "Failed to create product",
        suggestion: "Please try again later"
      });
    }
  });

  // Products API - Update product
  app.put("/api/products/:id", requirePermission('products', 'update'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, sku, price, categoryId, minStock, brandId, supplierId, landingPrice, b2bPrice, b2cPrice, weightKg, lengthCm, widthCm, heightCm } = req.body;


      if (!name || !sku || !categoryId) {
        return res.status(400).send("Name, SKU, and category are required");
      }

      // B2C (retail) price is mandatory, so it can never be cleared. It is
      // allowed to be omitted (PATCH-like update), but not to be null/negative.
      if (b2cPrice === null || (b2cPrice !== undefined && (typeof b2cPrice !== 'number' || b2cPrice < 0))) {
        return res.status(400).json({
          message: "B2C price is required",
          suggestion: "Provide a B2C (retail) price of 0 or more",
        });
      }

      // Check if another product has the same SKU
      const [existingProduct] = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.sku, sku),
            sql`id != ${id}`
          )
        )
        .limit(1);

      if (existingProduct) {
        return res.status(400).send("Another product with this SKU already exists");
      }

      // Check if category exists
      const category = await db.query.categories.findFirst({
        where: eq(categories.id, categoryId),
      });

      if (!category) {
        return res.status(400).json({
          message: "Category not found",
          suggestion: "Please select a valid category"
        });
      }

      // Check if brand exists (only when a brand was actually selected).
      // Querying with `undefined` makes postgres-js throw UNDEFINED_VALUE.
      if (brandId !== undefined && brandId !== null) {
        const brand = await db.query.brands.findFirst({
          where: eq(brands.id, brandId),
        });

        if (!brand) {
          return res.status(400).json({
            message: "Brand not found",
            suggestion: "Please select a valid brand"
          });
        }
      }

      // Check if supplier exists (only when a supplier was actually selected).
      if (supplierId !== undefined && supplierId !== null) {
        const supplier = await db.query.suppliers.findFirst({
          where: eq(suppliers.id, supplierId),
        });

        if (!supplier) {
          return res.status(400).json({
            message: "Supplier not found",
            suggestion: "Please select a valid supplier"
          });
        }
      }

      // Only include columns that were actually provided — `undefined` values
      // are rejected by the postgres driver.
      const updateValues: Partial<typeof products.$inferInsert> = {
        name,
        sku,
        categoryId,
        brandId: brandId || null,
        updatedAt: new Date(),
      };

      // An explicit `null` clears the stored supplier.
      if (supplierId !== undefined) {
        updateValues.supplierId = supplierId ?? null;
      }

      // The form no longer sends `price`; derive it from the tiers when the
      // client provided any of them (explicit `price` still wins).
      const derivedPrice = derivePrice({ price, landingPrice, b2bPrice, b2cPrice });
      if (derivedPrice !== undefined) {
        updateValues.price = String(derivedPrice);
      }

      if (description !== undefined) {
        updateValues.description = description;
      }

      if (minStock !== undefined) {
        updateValues.minStock = minStock;
      }

      // Optional price tiers: only touched when the client sent them, and an
      // explicit `null` clears the stored value.
      if (landingPrice !== undefined) {
        updateValues.landingPrice = toDecimalOrNull(landingPrice);
      }

      if (b2bPrice !== undefined) {
        updateValues.b2bPrice = toDecimalOrNull(b2bPrice);
      }

      if (b2cPrice !== undefined) {
        updateValues.b2cPrice = toDecimalOrNull(b2cPrice);
      }

      // Optional physical attributes: only touched when the client sent them,
      // and an explicit `null` clears the stored value.
      if (weightKg !== undefined) {
        updateValues.weightKg = toDecimalOrNull(weightKg);
      }

      if (lengthCm !== undefined) {
        updateValues.lengthCm = toDecimalOrNull(lengthCm);
      }

      if (widthCm !== undefined) {
        updateValues.widthCm = toDecimalOrNull(widthCm);
      }

      if (heightCm !== undefined) {
        updateValues.heightCm = toDecimalOrNull(heightCm);
      }

      const [updatedProduct] = await db
        .update(products)
        .set(updateValues)
        .where(eq(products.id, parseInt(id)))
        .returning();

      if (!updatedProduct) {
        return res.status(404).send("Product not found");
      }

      res.json({
        message: "Product updated successfully",
        product: updatedProduct,
      });
    } catch (error) {
      console.error('Error updating product:', error);
      res.status(500).send("Failed to update product");
    }
  });

  // Products API - Bulk import (CSV/Excel) used by the Products page.
  // The file is parsed in the browser and posted as rows of canonical fields.
  app.post("/api/products/import", requirePermission('products', 'create'), async (req, res) => {
    try {
      const importProductsSchema = z.object({
        rows: z
          .array(z.record(z.unknown()))
          .min(1, "At least one row is required")
          .max(5000, "Too many rows - import 5000 products at a time"),
        // Update products that already exist (matched by SKU)
        updateExisting: z.boolean().optional(),
        // Create categories/brands/suppliers that are not in the database yet
        createMissing: z.boolean().optional(),
      });

      const parsed = importProductsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: parsed.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }

      const result = await importProducts(parsed.data.rows, {
        updateExisting: parsed.data.updateExisting,
        createMissing: parsed.data.createMissing,
      });

      const parts: string[] = [];
      if (result.created) parts.push(`${result.created} created`);
      if (result.updated) parts.push(`${result.updated} updated`);
      if (result.skipped) parts.push(`${result.skipped} skipped`);
      if (result.errors.length) parts.push(`${result.errors.length} failed`);

      res.json({
        message: parts.length
          ? `Import finished: ${parts.join(', ')}`
          : 'Nothing to import',
        ...result,
      });
    } catch (error) {
      console.error('Error importing products:', error);
      res.status(500).json({
        message: "Failed to import products",
        suggestion: "Please check the file format and try again",
      });
    }
  });

  // Products API - Delete product
  app.delete("/api/products/:id", requirePermission('products', 'delete'), async (req, res) => {
    try {
      const { id } = req.params;

      // Check if product exists
      const product = await db.query.products.findFirst({
        where: eq(products.id, parseInt(id)),
      });

      if (!product) {
        return res.status(404).json({
          message: "Product not found",
          suggestion: "Please verify the product ID"
        });
      }

      // Check if product is used in any orders
      const orderItem = await db.query.orderItems.findFirst({
        where: eq(orderItems.productId, parseInt(id)),
      });

      if (orderItem) {
        return res.status(400).json({
          message: "Cannot delete product that is used in orders",
          suggestion: "Archive the product instead"
        });
      }

      // Delete any inventory items for this product
      await db
        .delete(inventory)
        .where(eq(inventory.productId, parseInt(id)));

      // Delete the product
      await db
        .delete(products)
        .where(eq(products.id, parseInt(id)));

      res.json({ message: "Product deleted successfully" });
    } catch (error) {
      console.error('Error deleting product:', error);
      res.status(500).json({
        message: "Failed to delete product",
        suggestion: "Please try again later"
      });
    }
  });

  // Products API - Bulk delete products (multi-select action on the product list)
  app.post("/api/products/bulk-delete", requirePermission('products', 'delete'), async (req, res) => {
    const bulkDeleteSchema = z.object({
      ids: z
        .array(z.number().int().positive())
        .min(1, "Select at least one product")
        .max(1000, "Delete at most 1000 products at a time"),
    });

    const parsed = bulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid delete request",
        suggestion: parsed.error.issues[0]?.message ?? "Provide an array of product ids",
      });
    }

    // De-duplicate so a repeated id cannot be counted (or deleted) twice.
    const ids = Array.from(new Set(parsed.data.ids));
    const deleted: number[] = [];
    const failed: { id: number; name: string | null; message: string }[] = [];

    // Each product keep the same rules as the single delete endpoint: a product
    // used in any order cannot be removed. Failures are collected so one bad row
    // does not abort the whole batch.
    for (const id of ids) {
      try {
        const product = await db.query.products.findFirst({
          where: eq(products.id, id),
        });

        if (!product) {
          failed.push({ id, name: null, message: "Product not found" });
          continue;
        }

        const orderItem = await db.query.orderItems.findFirst({
          where: eq(orderItems.productId, id),
        });

        if (orderItem) {
          failed.push({
            id,
            name: product.name,
            message: "Used in orders - archive the product instead",
          });
          continue;
        }

        // Delete any inventory items for this product first, then the product.
        await db.delete(inventory).where(eq(inventory.productId, id));
        await db.delete(products).where(eq(products.id, id));
        deleted.push(id);
      } catch (error) {
        console.error(`Error deleting product ${id}:`, error);
        failed.push({ id, name: null, message: "Failed to delete product" });
      }
    }

    const message =
      failed.length === 0
        ? `Deleted ${deleted.length} product${deleted.length === 1 ? "" : "s"}`
        : `Deleted ${deleted.length} product${deleted.length === 1 ? "" : "s"} · ${failed.length} could not be deleted`;

    res.json({
      message,
      deletedCount: deleted.length,
      failedCount: failed.length,
      deleted,
      failed,
    });
  });

  // Orders API
  app.get("/api/orders", requirePermission('orders', 'read'), async (req, res) => {
    try {
      const allOrders = await db.query.orders.findMany({
        with: {
          items: {
            with: {
              product: true,
            },
          },
        },
        orderBy: [desc(orders.createdAt)],
      });
      res.json(allOrders);
    } catch (error) {
      console.error('Error fetching orders:', error);
      res.status(500).send("Failed to fetch orders");
    }
  });

  // Inventory Management endpoints
  // Update inventory endpoint to include supplier data
  app.get("/api/inventory", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).send("Unauthorized");
      }

      // AI Agent Note: the list was unfiltered, so a cashier assigned to one store
      // could read every store's stock. DC (warehouse) rows have a NULL store_id and
      // are shared company stock the POS sells from, so they stay visible; other
      // stores' rows do not.
      const scope = await resolveScope(user);
      const storeFilter = scopeStoreFilter(scope, inventory.storeId);

      const inventoryItems = await db.query.inventory.findMany({
        where: storeFilter ? or(storeFilter, isNull(inventory.storeId)) : undefined,
        with: {
          product: true,
          store: true,
          supplier: true, // Add supplier relation
        },
      });

      res.json(inventoryItems);
    } catch (error) {
      console.error('Error fetching inventory:', error);
      res.status(500).send("Failed to fetch inventory");
    }
  });

  app.post("/api/inventory", requireAuth, async (req, res) => {
    try {
      const { productId, storeId, supplierId, quantity, location, inventoryType } = req.body;

      if (!productId || !quantity || !inventoryType) {
        return res.status(400).send("Product, quantity, and inventory type are required");
      }

      // Verify product exists
      const product = await db.query.products.findFirst({
        where: eq(products.id, parseInt(productId)),
      });

      if (!product) {
        return res.status(404).send("Product not found");
      }

      // Generate barcode
      const barcode = generateInventoryBarcode(
        inventoryType as 'DC' | 'STORE',
        product.sku,
        storeId ? parseInt(storeId) : null
      );

      // Create inventory item with supplier
      // AI Agent Note: the opening quantity is a stock movement like any other. Without it
      // every manually created row would look like unexplained drift to `npm run stock:reconcile`.
      const newInventory = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(inventory)
          .values({
            productId: parseInt(productId),
            storeId: storeId ? parseInt(storeId) : null,
            supplierId: supplierId ? parseInt(supplierId) : null,
            quantity: parseInt(quantity),
            location,
            inventoryType,
            barcode,
          })
          .returning();

        await recordOpeningStock(tx, {
          inventoryId: created.id,
          quantity: created.quantity,
          reason: 'adjustment',
          productId: created.productId,
          storeId: created.storeId,
          refType: 'inventory_create',
          refId: created.id,
          userId: req.user?.id ?? null,
        });

        return created;
      });

      // Fetch complete inventory item with relations
      const inventoryWithRelations = await db.query.inventory.findFirst({
        where: eq(inventory.id, newInventory.id),
        with: {
          product: true,
          store: true,
          supplier: true,
        },
      });

      res.json({
        message: "Inventory item created successfully",
        inventory: inventoryWithRelations,
      });
    } catch (error) {
      console.error('Error creating inventory:', error);
      res.status(500).send("Failed to create inventory item");
    }
  });

  // Inventory API - Bulk import (CSV/Excel) used by the Inventory Management page.
  // The file is parsed in the browser and posted as rows of canonical fields.
  app.post("/api/inventory/import", requirePermission('inventory', 'create'), async (req, res) => {
    try {
      const importInventorySchema = z.object({
        rows: z
          .array(z.record(z.unknown()))
          .min(1, "At least one row is required")
          .max(5000, "Too many rows - import 5000 rows at a time"),
        // Update inventory that already exists (matched by product + store + type)
        updateExisting: z.boolean().optional(),
      });

      const parsed = importInventorySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: parsed.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }

      const result = await importInventory(parsed.data.rows, {
        updateExisting: parsed.data.updateExisting,
        userId: req.user?.id ?? null,
      });

      const parts: string[] = [];
      if (result.created) parts.push(`${result.created} created`);
      if (result.updated) parts.push(`${result.updated} updated`);
      if (result.skipped) parts.push(`${result.skipped} skipped`);
      if (result.errors.length) parts.push(`${result.errors.length} failed`);

      res.json({
        message: parts.length
          ? `Import finished: ${parts.join(', ')}`
          : 'Nothing to import',
        ...result,
      });
    } catch (error) {
      console.error('Error importing inventory:', error);
      res.status(500).json({
        message: "Failed to import inventory",
        suggestion: "Please check the file format and try again",
      });
    }
  });

  app.put("/api/inventory/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { productId, storeId, supplierId, quantity, location, inventoryType } = req.body;

      if (!productId || !quantity || !inventoryType) {
        return res.status(400).send("Product, quantity, and inventory type are required");
      }

      // Verify inventory item exists
      const existingInventory = await db.query.inventory.findFirst({
        where: eq(inventory.id, parseInt(id)),
      });

      if (!existingInventory) {
        return res.status(404).send("Inventory item not found");
      }

      // Verify product exists
      const product = await db.query.products.findFirst({
        where: eq(products.id, parseInt(productId)),
      });

      if (!product) {
        return res.status(404).send("Product not found");
      }

      // Update inventory item with supplier
      const nextQuantity = parseInt(quantity);

      // AI Agent Note: this endpoint sets the quantity outright, so the interesting number
      // is the difference. Recording it as an 'adjustment' movement with the real delta is
      // what makes an unexplained correction visible in the ledger instead of silent.
      // The delta is computed from a read inside the same transaction that writes the row,
      // so a concurrent change cannot make the movement disagree with the stored quantity.
      const updatedInventory = await db.transaction(async (tx) => {
        const current = await tx.query.inventory.findFirst({
          where: eq(inventory.id, parseInt(id)),
        });

        const [row] = await tx
          .update(inventory)
          .set({
            productId: parseInt(productId),
            storeId: storeId ? parseInt(storeId) : null,
            supplierId: supplierId ? parseInt(supplierId) : null,
            quantity: nextQuantity,
            location,
            inventoryType,
            updatedAt: new Date(),
          })
          .where(eq(inventory.id, parseInt(id)))
          .returning();

        const quantityDelta = nextQuantity - (current?.quantity ?? nextQuantity);
        if (quantityDelta !== 0) {
          await recordStockMovement(tx, {
            inventoryId: row.id,
            delta: quantityDelta,
            reason: 'adjustment',
            productId: row.productId,
            storeId: row.storeId,
            quantityAfter: nextQuantity,
            refType: 'inventory_edit',
            refId: row.id,
            userId: req.user?.id ?? null,
          });
        }

        return row;
      });

      // Fetch complete inventory item with relations
      const inventoryWithRelations = await db.query.inventory.findFirst({
        where: eq(inventory.id, updatedInventory.id),
        with: {
          product: true,
          store: true,
          supplier: true,
        },
      });

      res.json({
        message: "Inventory item updated successfully",
        inventory: inventoryWithRelations,
      });
    } catch (error) {
      console.error('Error updating inventory:', error);
      res.status(500).send("Failed to update inventory item");
    }
  });
  // ---------------------------------------------------------------------------
  // Stock adjust / stock-take (P1 #2)
  //
  // AI Agent Note: correcting a count used to mean PUT /api/inventory/:id, which only
  // overwrites the number. These two endpoints are the supported path: the correction is
  // written through the stock ledger with a required reason, and /stock-take gives the
  // screen the system quantity next to the last count so the difference is visible.
  // ---------------------------------------------------------------------------

  app.get("/api/inventory/stock-take", requirePermission('inventory', 'read'), async (req, res) => {
    try {
      const scope = await resolveScope(req.user!);
      const rows = await listStockTake(scope);
      res.json(rows);
    } catch (error) {
      console.error('Error building stock take list:', error);
      res.status(500).json({
        message: "Failed to load the stock take list",
        suggestion: "Refresh the page and try again",
      });
    }
  });

  app.post("/api/inventory/:id/adjust", requirePermission('inventory', 'update'), async (req, res) => {
    try {
      const parsedId = idParamSchema.safeParse(req.params);
      if (!parsedId.success) {
        return res.status(400).json({
          message: "Invalid inventory id",
          suggestion: "Reload the stock list and try again",
        });
      }

      const body = adjustStockSchema.safeParse(req.body);
      if (!body.success) {
        return res.status(400).json({
          message: body.error.issues[0]?.message ?? "Invalid adjustment",
          suggestion: "Send either delta or countedQuantity, plus a reason",
        });
      }

      const scope = await resolveScope(req.user!);
      const target = await db.query.inventory.findFirst({
        where: eq(inventory.id, parsedId.data.id),
        columns: { id: true, storeId: true },
      });

      if (!target) {
        return res.status(404).json({
          message: "Inventory item not found",
          suggestion: "Reload the stock list and try again",
        });
      }

      // AI Agent Note: without this a user could adjust another store's stock by guessing
      // the id. DC rows (store_id NULL) are shared company stock, same rule as the list.
      if (target.storeId !== null && scopeDenies(scope, target.storeId)) {
        return res.status(403).json({
          message: "You do not have access to that store",
          suggestion: "Ask an administrator to assign you to the store",
        });
      }

      const result = await adjustStock({
        inventoryId: target.id,
        delta: body.data.delta,
        countedQuantity: body.data.countedQuantity,
        reason: body.data.reason,
        // The module derives stock_take vs stock_adjust itself when no source is given.
        source: body.data.source,
        userId: req.user?.id ?? null,
      });

      res.json({
        message: result.movementWritten
          ? "Stock adjusted"
          : "Counted quantity matches the system - nothing to change",
        adjustment: result,
      });
    } catch (error) {
      if (error instanceof StockError) {
        return res.status(error.status).json({
          message: error.message,
          suggestion: error.suggestion,
        });
      }
      console.error('Error adjusting stock:', error);
      res.status(500).json({
        message: "Failed to adjust stock",
        suggestion: "Nothing was changed - refresh the page and try again",
      });
    }
  });



  app.delete("/api/inventory/:id", requirePermission('inventory', 'delete'), async (req, res) => {
    try {
      const { id } = req.params;

      // Check if inventory item exists
      const [inventoryItem] = await db
        .select()
        .from(inventory)
        .where(eq(inventory.id, parseInt(id)))
        .limit(1);

      if (!inventoryItem) {
        return res.status(404).send("Inventory item not found");
      }

      await db
        .delete(inventory)
        .where(eq(inventory.id, parseInt(id)));

      res.json({ message: "Inventory item deleted successfully" });
    } catch (error) {
      console.error('Error deleting inventory item:', error);
      res.status(500).send("Failed to delete inventory item");
    }
  });

  // Store Performance API endpoints
  app.get("/api/stores/performance", requireAuth, async (req, res) => {
    try {
      // Get current month's start and end dates
      const currentMonthStart = new Date();
      currentMonthStart.setDate(1);
      currentMonthStart.setHours(0, 0, 0, 0);
      const nextMonthStart = new Date(currentMonthStart);
      nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);
      nextMonthStart.setHours(0, 0, 0, 0);

      const startDate = currentMonthStart;
      const endDate = nextMonthStart;

      // Get performance metrics for each store
      const storeMetrics = await db
        .select({
          storeId: stores.id,
          storeName: stores.name,
          totalSales: sql`sum(${orderItems.price} * ${orderItems.quantity})`,
          orderCount: sql`count(distinct ${orders.id})`,
          inventoryCount: sql`count(distinct ${inventory.id})`
        })
        .from(stores)
        .leftJoin(orders, eq(orders.storeId, stores.id))
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .leftJoin(inventory, eq(inventory.storeId, stores.id))
        .where(
          and(
            gte(orders.createdAt, startDate),
            lt(orders.createdAt, endDate)
          )
        )
        .groupBy(stores.id, stores.name);

      // Get historical performance data for trending
      const historicalData = await db
        .select({
          storeId: stores.id,
          month: sql<string>`date_trunc('month', ${orders.createdAt})::date`,
          revenue: sql<number>`sum(${orders.total})`,
          orderCount: sql<number>`count(distinct ${orders.id})`
        })
        .from(stores)
        .leftJoin(orders, eq(orders.storeId, stores.id))
        .where(
          gte(
            orders.createdAt,
            sql`date_trunc('month', current_date - interval '6 months')`
          )
        )
        .groupBy(stores.id, sql`date_trunc('month', ${orders.createdAt})`)
        .orderBy([stores.id, sql`date_trunc('month', ${orders.createdAt})`]);

      // Get inventory status
      const inventoryStatus = await db
        .select({
          storeId: stores.id,
          totalItems: sql<number>`count(distinct ${inventory.productId})`,
          lowStockItems: sql<number>`
            count(distinct case
              when ${inventory.quantity} <= ${products.minStock}
              then ${inventory.productId}
              else null
            end)
          `
        })
        .from(stores)
        .leftJoin(inventory, eq(inventory.storeId, stores.id))
        .leftJoin(products, eq(inventory.productId, products.id))
        .groupBy(stores.id);

      res.json({
        currentMetrics: storeMetrics,
        historicalData,
        inventoryStatus
      });
    } catch (error) {
      console.error('Error fetching store performance:', error);
      res.status(500).json({
        message: "Failed to fetch store performance metrics",
        suggestion: "Please try again later"
      });
    }
  });

  // Brand Management endpoints
  app.get("/api/brands", requirePermission('masterData', 'read'), async (req, res) => {
    try {
      const allBrands = await db.query.brands.findMany({
        orderBy: [desc(brands.updatedAt)],
      });
      res.json(allBrands);
    } catch (error) {
      console.error('Error fetching brands:', error);
      res.status(500).send("Failed to fetch brands");
    }
  });

  app.post("/api/brands", requirePermission('masterData', 'create'), async (req, res) => {
    try {
      const { name, description } = req.body;

      if (!name) {
        return res.status(400).send("Brand name is required");
      }

      // Check if brand exists
      const existingBrand = await db.query.brands.findFirst({
        where: eq(brands.name, name),
      });

      if (existingBrand) {
        return res.status(400).send("Brand name already exists");
      }

      const [newBrand] = await db
        .insert(brands)
        .values({
          name,
          description,
        })
        .returning();

      res.json({
        message: "Brand created successfully",
        brand: newBrand,
      });
    } catch (error) {
      console.error('Error creating brand:', error);
      res.status(500).send("Failed to create brand");
    }
  });

  app.put("/api/brands/:id", requirePermission('masterData', 'update'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description } = req.body;

      if (!name) {
        return res.status(400).send("Brand name is required");
      }

      // Check if brand exists
      const existingBrand = await db.query.brands.findFirst({
        where: and(
          eq(brands.name, name),
          sql`id != ${id}`
        ),
      });

      if (existingBrand) {
        return res.status(400).send("Brand name already exists");
      }

      const [updatedBrand] = await db
        .update(brands)
        .set({
          name,
          description,
          updatedAt: new Date(),
        })
        .where(eq(brands.id, parseInt(id)))
        .returning();

      if (!updatedBrand) {
        return res.status(404).send("Brand not found");
      }

      res.json({
        message: "Brand updated successfully",
        brand: updatedBrand,
      });
    } catch (error) {
      console.error('Error updating brand:', error);
      res.status(500).send("Failed to update brand");
    }
  });

  app.delete("/api/brands/:id", requirePermission('masterData', 'delete'), async (req, res) => {
    try {
      const { id } = req.params;

      // Check if brand is used by any products
      const productsWithBrand = await db.query.products.findMany({
        where: eq(products.brandId, parseInt(id)),
        limit: 1,
      });

      if (productsWithBrand.length > 0) {
        return res.status(400).send("Cannot delete brand that is assigned to products");
      }

      await db
        .delete(brands)
        .where(eq(brands.id, parseInt(id)));

      res.json({ message: "Brand deleted successfully" });
    } catch (error) {
      console.error('Error deleting brand:', error);
      res.status(500).send("Failed to delete brand");
    }
  });

  // CSV/Excel import for the Brands screen (matched by name).
  app.post("/api/brands/import", requirePermission('masterData', 'create'), async (req, res) => {
    const parsed = masterDataImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid import request",
        errors: parsed.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    try {
      const result = await importBrands(parsed.data.rows, {
        updateExisting: parsed.data.updateExisting,
      });

      res.json({
        message: buildMasterDataImportMessage(result),
        ...result,
      });
    } catch (error) {
      console.error('Error importing brands:', error);
      res.status(500).json({ message: "Failed to import brands" });
    }
  });

  // Bulk delete for the Brands screen. Brands assigned to products are reported
  // back as failures (same rule as the single delete endpoint).
  app.post("/api/brands/bulk-delete", requirePermission('masterData', 'delete'), async (req, res) => {
    const parsed = masterDataBulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid delete request",
        suggestion: parsed.error.issues[0]?.message ?? "Provide an array of brand ids",
      });
    }

    try {
      const { deleted, failed } = await bulkDeleteBrands(parsed.data.ids);

      res.json({
        message: buildBulkDeleteMessage("brand", deleted.length, failed.length),
        deletedCount: deleted.length,
        failedCount: failed.length,
        deleted,
        failed,
      });
    } catch (error) {
      console.error('Error bulk deleting brands:', error);
      res.status(500).json({ message: "Failed to delete brands" });
    }
  });

  // Supplier Management endpoints - admin only
  app.get("/api/suppliers", requirePermission('masterData', 'read'), async (req, res) => {
    try {
      const allSuppliers = await db.query.suppliers.findMany({
        orderBy: [desc(suppliers.updatedAt)],
      });
      res.json(allSuppliers);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
      res.status(500).send("Failed to fetch suppliers");
    }
  });

  app.post("/api/suppliers", requirePermission('masterData', 'create'), async (req, res) => {
    try {
      const { name, contactInfo, address } = req.body;

      if (!name || !contactInfo || !address) {
        return res.status(400).send("Name, contact information, and address are required");
      }

      const [newSupplier] = await db
        .insert(suppliers)
        .values({
          name,
          contactInfo,
          address,
        })
        .returning();

      res.json({
        message: "Supplier created successfully",
        supplier: newSupplier,
      });
    } catch (error) {
      console.error('Error creating supplier:', error);
      res.status(500).send("Failed to create supplier");
    }
  });

  app.put("/api/suppliers/:id", requirePermission('masterData', 'update'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, contactInfo, address } = req.body;

      if (!name || !contactInfo || !address) {
        return res.status(400).send("Name, contact information, and address are required");
      }

      const [updatedSupplier] = await db
        .update(suppliers)
        .set({
          name,
          contactInfo,
          address,
          updatedAt: new Date(),
        })
        .where(eq(suppliers.id, parseInt(id)))
        .returning();

      if (!updatedSupplier) {
        return res.status(404).send("Supplier not found");
      }

      res.json({
        message: "Supplier updated successfully",
        supplier: updatedSupplier,
      });
    } catch (error) {
      console.error('Error updating supplier:', error);
      res.status(500).send("Failed to update supplier");
    }
  });

  app.delete("/api/suppliers/:id", requirePermission('masterData', 'delete'), async (req, res) => {
    try {
      const { id } = req.params;

      // Check if supplier exists
      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, parseInt(id)))
        .limit(1);

      if (!supplier) {
        return res.status(404).send("Supplier not found");
      }

      // Check if supplier has any inventory
      const [inventoryCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(inventory)
        .where(eq(inventory.supplierId, parseInt(id)));

      if (inventoryCount.count > 0) {
        return res.status(400).send("Cannot delete supplier with existing inventory");
      }

      await db
        .delete(suppliers)
        .where(eq(suppliers.id, parseInt(id)));

      res.json({ message: "Supplier deleted successfully" });
    } catch (error) {
      console.error('Error deleting supplier:', error);
      res.status(500).send("Failed to delete supplier");
    }
  });

  // CSV/Excel import for the Suppliers screen (matched by name). Name, contact
  // information and address are mandatory because the create form requires them.
  app.post("/api/suppliers/import", requirePermission('masterData', 'create'), async (req, res) => {
    const parsed = masterDataImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid import request",
        errors: parsed.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    try {
      const result = await importSuppliers(parsed.data.rows, {
        updateExisting: parsed.data.updateExisting,
      });

      res.json({
        message: buildMasterDataImportMessage(result),
        ...result,
      });
    } catch (error) {
      console.error('Error importing suppliers:', error);
      res.status(500).json({ message: "Failed to import suppliers" });
    }
  });

  // Bulk delete for the Suppliers screen. Suppliers that still have inventory or
  // products are reported back as failures (same rules as the single endpoint).
  app.post("/api/suppliers/bulk-delete", requirePermission('masterData', 'delete'), async (req, res) => {
    const parsed = masterDataBulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid delete request",
        suggestion: parsed.error.issues[0]?.message ?? "Provide an array of supplier ids",
      });
    }

    try {
      const { deleted, failed } = await bulkDeleteSuppliers(parsed.data.ids);

      res.json({
        message: buildBulkDeleteMessage("supplier", deleted.length, failed.length),
        deletedCount: deleted.length,
        failedCount: failed.length,
        deleted,
        failed,
      });
    } catch (error) {
      console.error('Error bulk deleting suppliers:', error);
      res.status(500).json({ message: "Failed to delete suppliers" });
    }
  });

  // POS Sales Transaction API endpoints
  // Create new sales transaction
  app.post("/api/sales-transactions", requirePermission('pos', 'create'), validateBody(createSaleSchema, "Each item must have productId and positive quantity"), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { items, paymentMethod, customerProfileId, transactionType } = req.body;

      const transaction = await createSale({
        userId: user.id,
        items,
        paymentMethod,
        customerProfileId,
        transactionType,
      });

      res.json({
        message: "Sales transaction completed successfully",
        transaction,
      });
    } catch (error) {
      if (error instanceof SaleError) {
        return res.status(error.status).json({
          message: error.message,
          ...(error.suggestion ? { suggestion: error.suggestion } : {}),
        });
      }
      console.error('Error creating sales transaction:',
        error instanceof Error ? error.message : 'unknown error');
      res.status(500).json({
        message: "Failed to complete sales transaction",
        suggestion: "Please try again later"
      });
    }
  });

  // Get sales transactions with filtering
  app.get("/api/sales-transactions", requireAuth, async (req, res) => {
    try {
      const {
        search,
        store_id,
        transaction_type,
        cashier_user_id,
        status,
        start_date,
        end_date,
        limit = '50',
        offset = '0'
      } = req.query as {
        search?: string;
        store_id?: string;
        transaction_type?: string;
        cashier_user_id?: string;
        status?: string;
        start_date?: string;
        end_date?: string;
        limit?: string;
        offset?: string;
      };

      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Build where conditions
      const whereConditions = [];

      // Store filtering: the user's scope decides what is visible, and an explicit
      // ?store_id= may only narrow it - it must never replace it.
      const scope = await resolveScope(user);

      if (store_id) {
        const storeIdNum = parseInt(store_id, 10);
        if (Number.isNaN(storeIdNum)) {
          return res.status(400).json({
            message: "Invalid store filter",
            suggestion: "store_id must be a number"
          });
        }
        // AI Agent Note: ?store_id= used to replace the user's scope entirely, so any
        // cashier could read another store's receipts by editing the URL.
        if (scopeDenies(scope, storeIdNum)) {
          return res.status(403).json({
            message: "You do not have access to that store",
            suggestion: "Choose one of your assigned stores"
          });
        }
        whereConditions.push(eq(salesTransactions.storeId, storeIdNum));
      } else {
        // Outside global scope a cashier still sees the sales they rang up themselves,
        // but the store filter is always applied - it is never dropped.
        const storeFilter = scopeStoreFilter(scope, salesTransactions.storeId);
        if (storeFilter) {
          whereConditions.push(or(storeFilter, eq(salesTransactions.cashierUserId, user.id)));
        }
      }

      if (transaction_type) {
        whereConditions.push(eq(salesTransactions.transactionType, transaction_type));
      }

      if (cashier_user_id) {
        whereConditions.push(eq(salesTransactions.cashierUserId, parseInt(cashier_user_id)));
      }

      if (status) {
        whereConditions.push(eq(salesTransactions.status, status));
      }

      if (start_date) {
        whereConditions.push(sql`${salesTransactions.transactionDate} >= ${start_date}`);
      }

      if (end_date) {
        whereConditions.push(sql`${salesTransactions.transactionDate} <= ${end_date}`);
      }

      // Handle search by modifying where conditions
      if (search && typeof search === 'string') {
        const searchTerm = search.trim();
        if (searchTerm) {
          // Add search conditions to existing where conditions
          whereConditions.push(sql`
            (${salesTransactions.invoiceNumber} ILIKE ${`%${searchTerm}%`} OR
             CAST(${salesTransactions.id} AS TEXT) = ${searchTerm} OR
             EXISTS (
               SELECT 1 FROM customer_profiles cp
               WHERE cp.id = ${salesTransactions.customerProfileId}
               AND (cp.name ILIKE ${`%${searchTerm}%`} OR cp.phone_number ILIKE ${`%${searchTerm}%`})
             ))
          `);
        }
      }

      const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

      const transactions = await db.query.salesTransactions.findMany({
        where: whereClause,
        with: {
          items: {
            with: {
              product: true,
            },
          },
          store: true,
          cashierUser: true,
          customerProfile: true,
        },
        limit: parseInt(limit),
        offset: parseInt(offset),
        orderBy: [desc(salesTransactions.transactionDate)],
      });

      res.json(transactions);
    } catch (error) {
      console.error('Error fetching sales transactions:', error);
      res.status(500).json({
        message: "Failed to fetch sales transactions",
        suggestion: "Please try again later"
      });
    }
  });

  // Get specific sales transaction
  app.get("/api/sales-transactions/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      // Check if ID is numeric (transaction ID) or string (invoice number)
      const isNumericId = /^\d+$/.test(id);

      let whereCondition;
      if (isNumericId) {
        // Search by transaction ID
        whereCondition = eq(salesTransactions.id, parseInt(id));
      } else {
        // Search by invoice number
        whereCondition = eq(salesTransactions.invoiceNumber, id);
      }

      const transaction = await db.query.salesTransactions.findFirst({
        where: whereCondition,
        with: {
          items: {
            with: {
              product: true,
              inventory: true,
            },
          },
          actions: {
            with: {
              performedByUser: true,
            },
            orderBy: [desc(salesTransactionActions.performedAt)],
          },
          store: true,
          cashierUser: true,
          customerProfile: true,
        },
      });

      if (!transaction) {
        return res.status(404).json({
          message: "Sales transaction not found",
          suggestion: "Verify the transaction ID or invoice number"
        });
      }

      // AI Agent Note: guessing an id/invoice number used to return another store's
      // receipt. The scope is checked after the lookup so a foreign receipt is a
      // clear 403 instead of a misleading 404.
      const scope = await resolveScope(req.user!);
      if (scopeDenies(scope, transaction.storeId) && transaction.cashierUserId !== req.user!.id) {
        return res.status(403).json({
          message: "You do not have access to this transaction",
          suggestion: "Ask an administrator to assign you to the store"
        });
      }

      // Format transaction data for receipt generation
      const receiptData = {
        invoiceNumber: transaction.invoiceNumber,
        transactionDate: transaction.transactionDate,
        cashierName: transaction.cashierUser?.username || 'Unknown',
        storeName: transaction.store?.name,
        items: transaction.items.map(item => ({
          productId: item.productId,
          product: {
            id: item.product.id,
            name: item.product.name,
            sku: item.product.sku,
            price: item.unitPrice,
          },
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
        })),
        subtotal: parseFloat(transaction.totalAmount) / 1.1, // Remove 10% tax
        tax: parseFloat(transaction.totalAmount) - (parseFloat(transaction.totalAmount) / 1.1),
        total: parseFloat(transaction.totalAmount),
        paymentMethod: transaction.paymentMethod,
      };

      res.json({
        transaction,
        receiptData,
      });
    } catch (error) {
      console.error('Error fetching sales transaction:', error);
      res.status(500).json({
        message: "Failed to fetch sales transaction",
        suggestion: "Please try again later"
      });
    }
  });

  // Process refund for sales transaction
  app.post("/api/sales-transactions/:id/refund", requirePermission('receipts', 'update'), validateParams(idParamSchema, "Use a numeric transaction id"), validateBody(refundSaleSchema, "Check the refund amount and quantities"), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const transactionId = Number(req.params.id);

      const { refundAmount, reason, items } = req.body;

      const result = await refundSale({
        transactionId,
        userId: user.id,
        refundAmount,
        reason,
        items,
      });

      res.json({
        message: "Refund processed successfully",
        refundAmount: result.refundAmount,
      });
    } catch (error) {
      if (error instanceof SaleError) {
        return res.status(error.status).json({
          message: error.message,
          ...(error.suggestion ? { suggestion: error.suggestion } : {}),
        });
      }
      console.error('Error processing refund:',
        error instanceof Error ? error.message : 'unknown error');
      res.status(500).json({
        message: "Failed to process refund",
        suggestion: "Please try again later"
      });
    }
  });

  // Cancel sales transaction
  app.post("/api/sales-transactions/:id/cancel", requirePermission('receipts', 'update'), validateParams(idParamSchema, "Use a numeric transaction id"), validateBody(cancelSaleSchema, "Check the cancellation reason"), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const transactionId = Number(req.params.id);

      await cancelSale({ transactionId, userId: user.id, reason: req.body?.reason });

      res.json({ message: "Transaction cancelled successfully" });
    } catch (error) {
      if (error instanceof SaleError) {
        return res.status(error.status).json({
          message: error.message,
          ...(error.suggestion ? { suggestion: error.suggestion } : {}),
        });
      }
      console.error('Error cancelling transaction:',
        error instanceof Error ? error.message : 'unknown error');
      res.status(500).json({
        message: "Failed to cancel transaction",
        suggestion: "Please try again later"
      });
    }
  });

  // Get invoice counters
  app.get("/api/invoice-counters", requirePermission('users', 'read'), async (req, res) => {
    try {
      const counters = await db.query.invoiceCounters.findMany({
        with: {
          store: true,
        },
        orderBy: [invoiceCounters.counterType, invoiceCounters.storeId],
      });

      res.json(counters);
    } catch (error) {
      console.error('Error fetching invoice counters:', error);
      res.status(500).json({
        message: "Failed to fetch invoice counters",
        suggestion: "Please try again later"
      });
    }
  });

  // Check stock availability for POS
  app.post("/api/inventory/check-stock", requireAuth, validateBody(checkStockSchema, "Each item must have productId and quantity"), async (req, res) => {
    try {
      const { items, storeId } = req.body;

      const stockCheckResults = [];

      for (const item of items) {
        // Find available inventory - prioritize store inventory over DC
        let inventoryItem = null;

        if (storeId) {
          // First check store-specific inventory
          inventoryItem = await db.query.inventory.findFirst({
            where: and(
              eq(inventory.productId, item.productId),
              eq(inventory.storeId, storeId)
            ),
            with: {
              product: true,
            },
          });
        }

        // If no store inventory, check DC inventory
        if (!inventoryItem) {
          inventoryItem = await db.query.inventory.findFirst({
            where: and(
              eq(inventory.productId, item.productId),
              eq(inventory.inventoryType, 'DC')
            ),
            with: {
              product: true,
            },
          });
        }

        if (!inventoryItem) {
          stockCheckResults.push({
            productId: item.productId,
            productName: 'Unknown Product',
            requestedQuantity: item.quantity,
            availableQuantity: 0,
            sufficientStock: false,
            message: 'Product not available in inventory',
            inventoryType: null,
            storeId: null,
          });
        } else {
          const sufficientStock = inventoryItem.quantity >= item.quantity;
          stockCheckResults.push({
            productId: item.productId,
            productName: inventoryItem.product.name,
            requestedQuantity: item.quantity,
            availableQuantity: inventoryItem.quantity,
            sufficientStock,
            message: sufficientStock
              ? 'Stock available'
              : `Insufficient stock. Available: ${inventoryItem.quantity}, Requested: ${item.quantity}`,
            inventoryType: inventoryItem.inventoryType,
            storeId: inventoryItem.storeId,
            inventoryId: inventoryItem.id,
          });
        }
      }

      const allItemsAvailable = stockCheckResults.every(result => result.sufficientStock);

      res.json({
        allItemsAvailable,
        stockCheckResults,
      });
    } catch (error) {
      console.error('Error checking stock:', error);
      res.status(500).json({
        message: "Failed to check stock availability",
        suggestion: "Please try again later"
      });
    }
  });

  // Get real-time inventory levels for POS
  app.get("/api/inventory/real-time", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Get user's store assignment for store-specific inventory
      const userAssignment = await db.query.userStoreAssignments.findFirst({
        where: eq(userStoreAssignments.userId, user.id),
      });

      const storeId = userAssignment?.storeId;

      // Get inventory levels for POS display
      let inventoryQuery = db.query.inventory.findMany({
        with: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              price: true,
              category: true,
              brand: true,
            },
          },
        },
        where: storeId ? eq(inventory.storeId, storeId) : eq(inventory.inventoryType, 'DC'),
      });

      const inventoryItems = await inventoryQuery;

      // Format for POS consumption
      const formattedInventory = inventoryItems.map(item => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        sku: item.product.sku,
        price: item.product.price,
        category: item.product.category?.name,
        brand: item.product.brand?.name,
        quantity: item.quantity,
        inventoryType: item.inventoryType,
        storeId: item.storeId,
        location: item.location,
        lastUpdated: item.updatedAt,
        isLowStock: item.quantity <= (item.product.minStock || 10),
      }));

      res.json({
        inventory: formattedInventory,
        storeId,
        lastUpdated: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error fetching real-time inventory:', error);
      res.status(500).json({
        message: "Failed to fetch real-time inventory",
        suggestion: "Please try again later"
      });
    }
  });

  // Get inventory transaction history
  app.get("/api/inventory/transactions", requirePermission('inventory', 'read'), async (req, res) => {
    try {
      const { productId, storeId, limit = '100', offset = '0' } = req.query;

      const whereConditions = [];

      if (productId) {
        whereConditions.push(eq(salesTransactionItems.productId, parseInt(productId)));
      }

      if (storeId) {
        whereConditions.push(eq(salesTransactions.storeId, parseInt(storeId)));
      }

      const transactions = await db
        .select({
          id: salesTransactionItems.id,
          transactionId: salesTransactions.id,
          invoiceNumber: salesTransactions.invoiceNumber,
          productId: salesTransactionItems.productId,
          productName: products.name,
          quantity: salesTransactionItems.quantity,
          transactionType: salesTransactions.transactionType,
          transactionDate: salesTransactions.transactionDate,
          cashierUser: users.username,
          storeId: salesTransactions.storeId,
          storeName: stores.name,
        })
        .from(salesTransactionItems)
        .innerJoin(salesTransactions, eq(salesTransactionItems.salesTransactionId, salesTransactions.id))
        .innerJoin(products, eq(salesTransactionItems.productId, products.id))
        .leftJoin(users, eq(salesTransactions.cashierUserId, users.id))
        .leftJoin(stores, eq(salesTransactions.storeId, stores.id))
        .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
        .orderBy(desc(salesTransactions.transactionDate))
        .limit(parseInt(limit))
        .offset(parseInt(offset));

      res.json({
        transactions,
        total: transactions.length,
      });
    } catch (error) {
      console.error('Error fetching inventory transactions:', error);
      res.status(500).json({
        message: "Failed to fetch inventory transactions",
        suggestion: "Please try again later"
      });
    }
  });

  // ===============================
  // INTER-STORE TRANSFER ENDPOINTS
  // ===============================

  // Create transfer request
  app.post("/api/transfer-requests", requireAuth, async (req, res) => {
    try {
      const { fromStoreId, toStoreId, priority, notes, items } = req.body;
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (fromStoreId === undefined || toStoreId === undefined || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          message: "From store, to store, and items are required",
          suggestion: "Provide valid transfer request data"
        });
      }

      if (fromStoreId === toStoreId) {
        return res.status(400).json({
          message: "Cannot transfer to the same store",
          suggestion: "Select different source and destination stores"
        });
      }

      // Check if user has access to the source store
      const userAssignment = await db.query.userStoreAssignments.findFirst({
        where: eq(userStoreAssignments.userId, user.id),
      });

      // Special handling: Allow anyone with inventory:create to transfer FROM DC if they don't have a restricted assignment 
      // or if they are explicitly allowed. For now, let's just make it allow null fromStoreId if it's DC.
      if (userAssignment && fromStoreId !== null && userAssignment.storeId !== fromStoreId) {
        return res.status(403).json({
          message: "You can only create transfers from your assigned store",
          suggestion: "Contact administrator for store assignment"
        });
      }

      // Validate items and check stock availability
      const validatedItems = [];
      for (const item of items) {
        if (!item.productId || !item.quantity || item.quantity <= 0) {
          return res.status(400).json({
            message: "Each item must have productId and positive quantity",
            suggestion: "Provide valid item data"
          });
        }

        // Check if product exists
        const product = await db.query.products.findFirst({
          where: eq(products.id, item.productId),
        });

        if (!product) {
          return res.status(400).json({
            message: `Product with ID ${item.productId} not found`,
            suggestion: "Verify product exists"
          });
        }

        // Check available stock in source store
        // If fromStoreId is null, check for inventory where storeId is null (DC)
        const sourceInventory = await db.query.inventory.findFirst({
          where: and(
            eq(inventory.productId, item.productId),
            fromStoreId === null
              ? isNull(inventory.storeId)
              : eq(inventory.storeId, fromStoreId)
          ),
        });

        if (!sourceInventory || sourceInventory.quantity < item.quantity) {
          return res.status(400).json({
            message: `Insufficient stock for ${product.name}. Available: ${sourceInventory?.quantity || 0}, Requested: ${item.quantity}`,
            suggestion: "Reduce quantity or check inventory"
          });
        }

        validatedItems.push({
          productId: item.productId,
          requestedQuantity: item.quantity,
          notes: item.notes || null,
        });
      }

      // Generate transfer number
      const transferNumber = `TRF-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Create transfer request
      const [transferRequest] = await db
        .insert(transferRequests)
        .values({
          transferNumber,
          fromStoreId,
          toStoreId,
          requestedByUserId: user.id,
          status: 'pending',
          priority: priority || 'normal',
          notes: notes || null,
        })
        .returning();

      // Create transfer request items
      await Promise.all(validatedItems.map(item =>
        db.insert(transferRequestItems).values({
          transferRequestId: transferRequest.id,
          productId: item.productId,
          requestedQuantity: item.requestedQuantity,
          notes: item.notes,
        })
      ));

      // Log creation action
      await db.insert(transferActions).values({
        transferRequestId: transferRequest.id,
        actionType: 'created',
        actionData: { itemCount: validatedItems.length },
        performedByUserId: user.id,
      });

      // Fetch complete transfer request with items
      const completeTransfer = await db.query.transferRequests.findFirst({
        where: eq(transferRequests.id, transferRequest.id),
        with: {
          items: {
            with: {
              product: true,
            },
          },
          fromStore: true,
          toStore: true,
          requestedByUser: true,
        },
      });

      res.json({
        message: "Transfer request created successfully",
        transferRequest: completeTransfer,
      });
    } catch (error) {
      console.error('Error creating transfer request:', error);
      res.status(500).json({
        message: "Failed to create transfer request",
        suggestion: "Please try again later"
      });
    }
  });

  // Get transfer requests (with filtering)
  app.get("/api/transfer-requests", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const {
        status,
        from_store_id,
        to_store_id,
        priority,
        limit = '50',
        offset = '0'
      } = req.query;

      let whereConditions = [];

      // Status filter
      if (status) {
        whereConditions.push(eq(transferRequests.status, status));
      }

      // Store filters - a transfer is visible when either end is inside the user's scope.
      const scope = await resolveScope(user);
      const fromFilter = scopeStoreFilter(scope, transferRequests.fromStoreId);
      const toFilter = scopeStoreFilter(scope, transferRequests.toStoreId);

      if (fromFilter || toFilter) {
        // AI Agent Note: this used to look only at the user's *first* assignment, and
        // "no assignment" meant no filter at all - i.e. every transfer. Now an empty
        // scope yields an always-false predicate instead of a missing one.
        whereConditions.push(or(fromFilter, toFilter));
      }

      // Additional filters
      if (from_store_id) {
        whereConditions.push(eq(transferRequests.fromStoreId, parseInt(from_store_id)));
      }

      if (to_store_id) {
        whereConditions.push(eq(transferRequests.toStoreId, parseInt(to_store_id)));
      }

      if (priority) {
        whereConditions.push(eq(transferRequests.priority, priority));
      }

      const transferRequestsList = await db.query.transferRequests.findMany({
        where: whereConditions.length > 0 ? and(...whereConditions) : undefined,
        with: {
          items: {
            with: {
              product: true,
            },
          },
          fromStore: true,
          toStore: true,
          requestedByUser: true,
          actions: {
            with: {
              performedByUser: true,
            },
            orderBy: [desc(transferActions.performedAt)],
          },
        },
        limit: parseInt(limit),
        offset: parseInt(offset),
        orderBy: [desc(transferRequests.createdAt)],
      });

      res.json(transferRequestsList);
    } catch (error) {
      console.error('Error fetching transfer requests:', error);
      res.status(500).json({
        message: "Failed to fetch transfer requests",
        suggestion: "Please try again later"
      });
    }
  });

  // Get specific transfer request
  app.get("/api/transfer-requests/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const transferRequest = await db.query.transferRequests.findFirst({
        where: eq(transferRequests.id, parseInt(id)),
        with: {
          items: {
            with: {
              product: true,
            },
          },
          fromStore: true,
          toStore: true,
          requestedByUser: true,
          actions: {
            with: {
              performedByUser: true,
            },
            orderBy: [desc(transferActions.performedAt)],
          },
          history: {
            with: {
              fromInventory: true,
              toInventory: true,
              product: true,
              transferredByUser: true,
            },
            orderBy: [desc(transferHistory.transferredAt)],
          },
        },
      });

      if (!transferRequest) {
        return res.status(404).json({
          message: "Transfer request not found",
          suggestion: "Verify the transfer request ID"
        });
      }

      // Check if user has access to this transfer
      const userAssignment = await db.query.userStoreAssignments.findFirst({
        where: eq(userStoreAssignments.userId, user.id),
      });

      if (userAssignment &&
        transferRequest.fromStoreId !== userAssignment.storeId &&
        transferRequest.toStoreId !== userAssignment.storeId) {
        return res.status(403).json({
          message: "You don't have access to this transfer request",
          suggestion: "Contact administrator for access"
        });
      }

      res.json(transferRequest);
    } catch (error) {
      console.error('Error fetching transfer request:', error);
      res.status(500).json({
        message: "Failed to fetch transfer request",
        suggestion: "Please try again later"
      });
    }
  });

  // Approve or reject transfer request
  app.post("/api/transfer-requests/:id/actions", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { actionType, approvedQuantities, rejectionReason, notes } = req.body;
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (!['approve', 'reject'].includes(actionType)) {
        return res.status(400).json({
          message: "Invalid action type",
          validTypes: ['approve', 'reject']
        });
      }

      // Get transfer request
      const transferRequest = await db.query.transferRequests.findFirst({
        where: eq(transferRequests.id, parseInt(id)),
        with: {
          items: true,
          toStore: true,
        },
      });

      if (!transferRequest) {
        return res.status(404).json({
          message: "Transfer request not found"
        });
      }

      if (transferRequest.status !== 'pending') {
        return res.status(400).json({
          message: "Transfer request is not in pending status",
          suggestion: "Only pending requests can be approved or rejected"
        });
      }

      // Check if user has access to the destination store (for approval)
      const userAssignment = await db.query.userStoreAssignments.findFirst({
        where: eq(userStoreAssignments.userId, user.id),
      });

      if (userAssignment && transferRequest.toStoreId !== null && userAssignment.storeId !== transferRequest.toStoreId) {
        return res.status(403).json({
          message: "You can only approve transfers for your assigned store",
          suggestion: "Contact administrator for store assignment"
        });
      }

      if (actionType === 'reject') {
        // Reject the transfer
        await db
          .update(transferRequests)
          .set({
            status: 'rejected',
            updatedAt: new Date(),
          })
          .where(eq(transferRequests.id, parseInt(id)));

        // Log rejection action
        await db.insert(transferActions).values({
          transferRequestId: parseInt(id),
          actionType: 'rejected',
          actionData: {
            reason: rejectionReason || 'No reason provided',
            notes: notes
          },
          performedByUserId: user.id,
        });

        res.json({
          message: "Transfer request rejected successfully",
        });

      } else if (actionType === 'approve') {
        // Validate approved quantities
        if (!approvedQuantities || !Array.isArray(approvedQuantities)) {
          return res.status(400).json({
            message: "Approved quantities are required for approval",
            suggestion: "Provide approved quantities for each item"
          });
        }

        // Update approved quantities and validate
        for (const approval of approvedQuantities) {
          const item = transferRequest.items.find(i => i.id === approval.itemId);
          if (!item) {
            return res.status(400).json({
              message: `Item ${approval.itemId} not found in transfer request`
            });
          }

          if (approval.quantity > item.requestedQuantity) {
            return res.status(400).json({
              message: `Approved quantity cannot exceed requested quantity for ${item.productId}`,
              suggestion: "Reduce approved quantity"
            });
          }

          if (approval.quantity <= 0) {
            return res.status(400).json({
              message: "Approved quantity must be positive",
              suggestion: "Provide positive approved quantity"
            });
          }

          // Update approved quantity
          await db
            .update(transferRequestItems)
            .set({
              approvedQuantity: approval.quantity,
              updatedAt: new Date(),
            })
            .where(eq(transferRequestItems.id, approval.itemId));
        }

        // Approve the transfer
        await db
          .update(transferRequests)
          .set({
            status: 'approved',
            updatedAt: new Date(),
          })
          .where(eq(transferRequests.id, parseInt(id)));

        // Log approval action
        await db.insert(transferActions).values({
          transferRequestId: parseInt(id),
          actionType: 'approved',
          actionData: {
            approvedItems: approvedQuantities.length,
            notes: notes
          },
          performedByUserId: user.id,
        });

        res.json({
          message: "Transfer request approved successfully",
        });
      }
    } catch (error) {
      console.error('Error processing transfer action:', error);
      res.status(500).json({
        message: "Failed to process transfer action",
        suggestion: "Please try again later"
      });
    }
  });

  // Execute approved transfer
  app.post("/api/transfer-requests/:id/execute", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Get transfer request with items
      const transferRequest = await db.query.transferRequests.findFirst({
        where: eq(transferRequests.id, parseInt(id)),
        with: {
          items: true,
          fromStore: true,
          toStore: true,
        },
      });

      if (!transferRequest) {
        return res.status(404).json({
          message: "Transfer request not found"
        });
      }

      if (transferRequest.status !== 'approved') {
        return res.status(400).json({
          message: "Only approved transfers can be executed",
          suggestion: "Transfer must be approved first"
        });
      }

      // Check if user has access to execute (can be from either store)
      const userAssignment = await db.query.userStoreAssignments.findFirst({
        where: eq(userStoreAssignments.userId, user.id),
      });

      if (userAssignment &&
        (transferRequest.fromStoreId !== null && userAssignment.storeId !== transferRequest.fromStoreId) &&
        (transferRequest.toStoreId !== null && userAssignment.storeId !== transferRequest.toStoreId)) {
        return res.status(403).json({
          message: "You don't have access to execute this transfer",
          suggestion: "Contact administrator for access"
        });
      }

      // Execute the transfer
      for (const item of transferRequest.items) {
        if (!item.approvedQuantity || item.approvedQuantity <= 0) {
          continue; // Skip items with no approved quantity
        }

        // Check source inventory again (double-check)
        const sourceInventory = await db.query.inventory.findFirst({
          where: and(
            eq(inventory.productId, item.productId),
            transferRequest.fromStoreId === null
              ? isNull(inventory.storeId)
              : eq(inventory.storeId, transferRequest.fromStoreId)
          ),
        });

        if (!sourceInventory || sourceInventory.quantity < item.approvedQuantity) {
          return res.status(400).json({
            message: `Insufficient stock in source store for product ${item.productId}`,
            suggestion: "Check inventory levels"
          });
        }

        // Deduct from source
        await applyStockChange(db, {
          inventoryId: sourceInventory.id,
          delta: -item.approvedQuantity,
          reason: 'transfer_out',
          productId: item.productId,
          storeId: transferRequest.fromStoreId ?? null,
          refType: 'transfer_request',
          refId: transferRequest.id,
          userId: user.id,
        });

        // Add to destination (create or update)
        const destInventory = await db.query.inventory.findFirst({
          where: and(
            eq(inventory.productId, item.productId),
            transferRequest.toStoreId === null
              ? isNull(inventory.storeId)
              : eq(inventory.storeId, transferRequest.toStoreId)
          ),
        });

        if (destInventory) {
          // Update existing
          await applyStockChange(db, {
            inventoryId: destInventory.id,
            delta: item.approvedQuantity,
            reason: 'transfer_in',
            productId: item.productId,
            storeId: transferRequest.toStoreId ?? null,
            refType: 'transfer_request',
            refId: transferRequest.id,
            userId: user.id,
          });

          // Record transfer history
          await db.insert(transferHistory).values({
            transferRequestId: transferRequest.id,
            fromInventoryId: sourceInventory.id,
            toInventoryId: destInventory.id,
            productId: item.productId,
            quantity: item.approvedQuantity,
            transferredByUserId: user.id,
            notes: notes || null,
          });
        } else {
          // Create new inventory in destination store
          const inventoryType = transferRequest.toStoreId === null ? 'DC' : 'STORE';
          const barcode = generateInventoryBarcode(inventoryType, item.productId.toString(), transferRequest.toStoreId);

          const [newDestInventory] = await db
            .insert(inventory)
            .values({
              productId: item.productId,
              storeId: transferRequest.toStoreId,
              quantity: item.approvedQuantity,
              inventoryType: inventoryType,
              barcode: barcode,
              location: `Transferred from ${transferRequest.fromStore?.name || 'DC (Distribution Center)'}`,
            })
            .returning();

          await recordOpeningStock(db, {
            inventoryId: newDestInventory.id,
            quantity: item.approvedQuantity,
            reason: 'transfer_in',
            productId: item.productId,
            storeId: transferRequest.toStoreId ?? null,
            refType: 'transfer_request',
            refId: transferRequest.id,
            userId: user.id,
          });

          // Record transfer history
          await db.insert(transferHistory).values({
            transferRequestId: transferRequest.id,
            fromInventoryId: sourceInventory.id,
            toInventoryId: newDestInventory.id,
            productId: item.productId,
            quantity: item.approvedQuantity,
            transferredByUserId: user.id,
            notes: notes || null,
          });
        }

        // Update transferred quantity in transfer request item
        await db
          .update(transferRequestItems)
          .set({
            transferredQuantity: item.approvedQuantity,
            updatedAt: new Date(),
          })
          .where(eq(transferRequestItems.id, item.id));
      }

      // Mark transfer as completed
      await db
        .update(transferRequests)
        .set({
          status: 'completed',
          updatedAt: new Date(),
        })
        .where(eq(transferRequests.id, parseInt(id)));

      // Log completion action
      await db.insert(transferActions).values({
        transferRequestId: parseInt(id),
        actionType: 'completed',
        actionData: {
          executedBy: user.username,
          notes: notes
        },
        performedByUserId: user.id,
      });

      res.json({
        message: "Transfer executed successfully",
      });
    } catch (error) {
      console.error('Error executing transfer:', error);
      res.status(500).json({
        message: "Failed to execute transfer",
        suggestion: "Please try again later"
      });
    }
  });

  // Cancel transfer request
  app.post("/api/transfer-requests/:id/cancel", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const transferRequest = await db.query.transferRequests.findFirst({
        where: eq(transferRequests.id, parseInt(id)),
      });

      if (!transferRequest) {
        return res.status(404).json({
          message: "Transfer request not found"
        });
      }

      if (!['pending', 'approved'].includes(transferRequest.status)) {
        return res.status(400).json({
          message: "Only pending or approved transfers can be cancelled",
          suggestion: "Transfer status prevents cancellation"
        });
      }

      // Check if user has permission to cancel (requester or admin)
      const userAssignment = await db.query.userStoreAssignments.findFirst({
        where: eq(userStoreAssignments.userId, user.id),
      });

      if (transferRequest.requestedByUserId !== user.id &&
        (userAssignment &&
          (transferRequest.fromStoreId !== null && userAssignment.storeId !== transferRequest.fromStoreId) &&
          (transferRequest.toStoreId !== null && userAssignment.storeId !== transferRequest.toStoreId))) {
        return res.status(403).json({
          message: "You don't have permission to cancel this transfer",
          suggestion: "Only the requester or store users can cancel"
        });
      }

      // Cancel the transfer
      await db
        .update(transferRequests)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
        })
        .where(eq(transferRequests.id, parseInt(id)));

      // Log cancellation action
      await db.insert(transferActions).values({
        transferRequestId: parseInt(id),
        actionType: 'cancelled',
        actionData: {
          reason: reason || 'Cancelled by user',
          cancelledBy: user.username
        },
        performedByUserId: user.id,
      });

      res.json({
        message: "Transfer request cancelled successfully",
      });
    } catch (error) {
      console.error('Error cancelling transfer:', error);
      res.status(500).json({
        message: "Failed to cancel transfer",
        suggestion: "Please try again later"
      });
    }
  });

  // Get transfer history/analytics
  app.get("/api/transfer-history", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const {
        product_id,
        from_store_id,
        to_store_id,
        transferred_by,
        start_date,
        end_date,
        limit = '100',
        offset = '0'
      } = req.query;

      let whereConditions = [];

      // Filter by user's accessible stores
      const userAssignment = await db.query.userStoreAssignments.findFirst({
        where: eq(userStoreAssignments.userId, user.id),
      });

      if (userAssignment) {
        // Users can see transfers involving their stores
        const storeTransfers = await db
          .select({ id: transferRequests.id })
          .from(transferRequests)
          .where(
            or(
              eq(transferRequests.fromStoreId, userAssignment.storeId),
              eq(transferRequests.toStoreId, userAssignment.storeId)
            )
          );

        const transferIds = storeTransfers.map(t => t.id);
        if (transferIds.length > 0) {
          whereConditions.push(sql`${transferHistory.transferRequestId} IN ${transferIds}`);
        }
      }

      // Additional filters
      if (product_id) {
        whereConditions.push(eq(transferHistory.productId, parseInt(product_id)));
      }

      if (transferred_by) {
        whereConditions.push(eq(transferHistory.transferredByUserId, parseInt(transferred_by)));
      }

      if (start_date) {
        whereConditions.push(sql`${transferHistory.transferredAt} >= ${start_date}`);
      }

      if (end_date) {
        whereConditions.push(sql`${transferHistory.transferredAt} <= ${end_date}`);
      }

      const transferHistoryRecords = await db.query.transferHistory.findMany({
        where: whereConditions.length > 0 ? and(...whereConditions) : undefined,
        with: {
          transferRequest: {
            with: {
              fromStore: true,
              toStore: true,
            },
          },
          product: true,
          transferredByUser: true,
        },
        limit: parseInt(limit),
        offset: parseInt(offset),
        orderBy: [desc(transferHistory.transferredAt)],
      });

      res.json({
        transfers: transferHistoryRecords,
        total: transferHistoryRecords.length,
      });
    } catch (error) {
      console.error('Error fetching transfer history:', error);
      res.status(500).json({
        message: "Failed to fetch transfer history",
        suggestion: "Please try again later"
      });
    }
  });

  // Quick transfer between stores (for admins/DC staff)
  app.post("/api/transfers/quick-transfer", requireRole(['admin']), async (req, res) => {
    try {
      const { fromStoreId, toStoreId, productId, quantity, notes } = req.body;
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (!fromStoreId || !toStoreId || !productId || !quantity || quantity <= 0) {
        return res.status(400).json({
          message: "All fields are required and quantity must be positive",
          suggestion: "Provide complete transfer information"
        });
      }

      if (fromStoreId === toStoreId) {
        return res.status(400).json({
          message: "Cannot transfer to the same store",
          suggestion: "Select different source and destination stores"
        });
      }

      // Check source inventory
      const sourceInventory = await db.query.inventory.findFirst({
        where: and(
          eq(inventory.productId, productId),
          eq(inventory.storeId, fromStoreId)
        ),
      });

      if (!sourceInventory || sourceInventory.quantity < quantity) {
        return res.status(400).json({
          message: `Insufficient stock in source store. Available: ${sourceInventory?.quantity || 0}`,
          suggestion: "Check inventory or reduce quantity"
        });
      }

      // Execute quick transfer
      // Deduct from source. The ledger rows are written further down, once the transfer
      // record exists, so each movement can reference the document that caused it.
      const [sourceAfterDeduct] = await db
        .update(inventory)
        .set({
          quantity: sql`${inventory.quantity} - ${quantity}`,
          updatedAt: new Date(),
        })
        .where(eq(inventory.id, sourceInventory.id))
        .returning({ quantity: inventory.quantity });

      // Add to destination
      const destInventory = await db.query.inventory.findFirst({
        where: and(
          eq(inventory.productId, productId),
          toStoreId === null
            ? isNull(inventory.storeId)
            : eq(inventory.storeId, toStoreId)
        ),
      });

      let destInventoryId;
      let destQuantityAfter;
      if (destInventory) {
        const [destAfter] = await db
          .update(inventory)
          .set({
            quantity: sql`${inventory.quantity} + ${quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(inventory.id, destInventory.id))
          .returning({ quantity: inventory.quantity });
        destInventoryId = destInventory.id;
        destQuantityAfter = destAfter.quantity;
      } else {
        const inventoryType = toStoreId === null ? 'DC' : 'STORE';
        const barcode = generateInventoryBarcode(inventoryType, productId.toString(), toStoreId);
        const [newDest] = await db
          .insert(inventory)
          .values({
            productId: productId,
            storeId: toStoreId,
            quantity: quantity,
            inventoryType: inventoryType,
            barcode: barcode,
            location: `Quick transfer from ${fromStoreId === null ? 'DC (Distribution Center)' : 'Store ' + fromStoreId}`,
          })
          .returning();
        destInventoryId = newDest.id;
        destQuantityAfter = newDest.quantity;
      }

      // Create a quick transfer record (without full request workflow)
      const transferNumber = `QTRF-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

      const [quickTransfer] = await db
        .insert(transferRequests)
        .values({
          transferNumber,
          fromStoreId,
          toStoreId,
          requestedByUserId: user.id,
          status: 'completed',
          priority: 'high',
          notes: `Quick transfer: ${notes || 'No notes'}`,
        })
        .returning();

      await recordStockMovements(db, [
        {
          inventoryId: sourceInventory.id,
          delta: -quantity,
          quantityAfter: sourceAfterDeduct.quantity,
          reason: 'transfer_out',
          productId,
          storeId: fromStoreId ?? null,
          refType: 'transfer_request',
          refId: quickTransfer.id,
          userId: user.id,
        },
        {
          inventoryId: destInventoryId,
          delta: quantity,
          quantityAfter: destQuantityAfter,
          reason: 'transfer_in',
          productId,
          storeId: toStoreId ?? null,
          refType: 'transfer_request',
          refId: quickTransfer.id,
          userId: user.id,
        },
      ]);

      // Record the transfer
      await db.insert(transferHistory).values({
        transferRequestId: quickTransfer.id,
        fromInventoryId: sourceInventory.id,
        toInventoryId: destInventoryId,
        productId: productId,
        quantity: quantity,
        transferredByUserId: user.id,
        notes: notes || 'Quick transfer',
      });

      res.json({
        message: "Quick transfer completed successfully",
        transfer: {
          id: quickTransfer.id,
          transferNumber: quickTransfer.transferNumber,
          quantity: quantity,
        },
      });
    } catch (error) {
      console.error('Error executing quick transfer:', error);
      res.status(500).json({
        message: "Failed to execute quick transfer",
        suggestion: "Please try again later"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
