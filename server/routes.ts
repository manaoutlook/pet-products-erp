import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import {
  products, inventory, orders, orderItems, users,
  roles, stores, userStoreAssignments, regions,
  categories, brands, suppliers, purchaseOrders,
  purchaseOrderItems, purchaseOrderActions, customerProfiles, insertCustomerProfileSchema,
  insertPurchaseOrderActionSchema, selectPurchaseOrderActionSchema,
  insertStoreSchema, insertUserSchema, updateUserSchema, salesTransactions, salesTransactionItems,
  salesTransactionActions, invoiceCounters,
  transferRequests, transferRequestItems, transferActions, transferHistory,
  insertTransferRequestSchema, insertTransferRequestItemSchema, insertTransferActionSchema,
  selectTransferRequestSchema, selectTransferRequestItemSchema
} from "@db/schema";
import { sql } from "drizzle-orm";
import { eq, and, or, desc, gte, lt, isNull, gt } from "drizzle-orm";
import { requireRole, requireAuth, requirePermission } from "./middleware";
import { z } from "zod";
import { crypto } from "./auth";
import { initializeStoreCounter, generateInvoiceNumber } from "./invoice-counter";

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

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  // Add middleware to log all API requests
  app.use('/api', (req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });

  app.use('/api', requireAuth);

  // Store Management endpoints
  app.get("/api/stores", requireAuth, async (req, res) => {
    try {
      const allStores = await db.query.stores.findMany({
        orderBy: [desc(stores.updatedAt)],
      });
      res.json(allStores);
    } catch (error) {
      console.error('Error fetching stores:', error);
      res.status(500).json({
        message: "Failed to fetch stores",
        suggestion: "Please try again later"
      });
    }
  });

  app.post("/api/stores", requireAuth, async (req, res) => {
    try {
      const result = insertStoreSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      const { name, location, contactInfo, type } = result.data; // AI Agent Note: Added 'type' for multiple DC support

      // Check if store exists
      const existingStore = await db.query.stores.findFirst({
        where: eq(stores.name, name),
      });

      if (existingStore) {
        return res.status(400).json({
          message: "Store with this name already exists",
          suggestion: "Please use a different store name"
        });
      }

      const [newStore] = await db
        .insert(stores)
        .values({
          name,
          location,
          contactInfo,
          type: type || 'RETAIL', // AI Agent Note: Save store type
        })
        .returning();

      // Initialize invoice counter for the new store
      try {
        await initializeStoreCounter(newStore.id);
      } catch (counterError) {
        console.error('Failed to initialize invoice counter for store:', newStore.id, counterError);
        // Don't fail the store creation if counter initialization fails
      }

      res.json({
        message: "Store created successfully",
        store: newStore,
      });
    } catch (error) {
      console.error('Error creating store:', error);
      res.status(500).json({
        message: "Failed to create store",
        suggestion: "Please try again later"
      });
    }
  });

  app.put("/api/stores/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const result = insertStoreSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      const { name, location, contactInfo, type } = result.data; // AI Agent Note: Added 'type' for multiple DC support

      // Check if store exists
      const existingStore = await db.query.stores.findFirst({
        where: and(
          eq(stores.name, name),
          sql`id != ${id}`
        ),
      });

      if (existingStore) {
        return res.status(400).json({
          message: "Store with this name already exists",
          suggestion: "Please use a different store name"
        });
      }

      const [updatedStore] = await db
        .update(stores)
        .set({
          name,
          location,
          contactInfo,
          type: type || 'RETAIL', // AI Agent Note: Save store type
          updatedAt: new Date()
        })
        .where(eq(stores.id, parseInt(id)))
        .returning();

      if (!updatedStore) {
        return res.status(404).json({
          message: "Store not found",
          suggestion: "Please verify the store ID"
        });
      }

      res.json({
        message: "Store updated successfully",
        store: updatedStore,
      });
    } catch (error) {
      console.error('Error updating store:', error);
      res.status(500).json({
        message: "Failed to update store",
        suggestion: "Please try again later"
      });
    }
  });

  app.delete("/api/stores/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      // Check if store exists
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, parseInt(id)),
      });

      if (!store) {
        return res.status(404).json({
          message: "Store not found",
          suggestion: "Please verify the store ID"
        });
      }

      // Check if store has any inventory
      const inventory = await db.query.inventory.findFirst({
        where: eq(inventory.storeId, parseInt(id)),
      });

      if (inventory) {
        return res.status(400).json({
          message: "Cannot delete store with existing inventory",
          suggestion: "Please transfer or remove all inventory items first"
        });
      }

      // Check if store has any orders
      const orders = await db.query.orders.findFirst({
        where: eq(orders.storeId, parseInt(id)),
      });

      if (orders) {
        return res.status(400).json({
          message: "Cannot delete store with existing orders",
          suggestion: "Please archive or reassign orders first"
        });
      }

      // Check if store has any user assignments
      const assignments = await db.query.userStoreAssignments.findFirst({
        where: eq(userStoreAssignments.storeId, parseInt(id)),
      });

      if (assignments) {
        return res.status(400).json({
          message: "Cannot delete store with active user assignments",
          suggestion: "Please remove all user assignments first"
        });
      }

      await db
        .delete(stores)
        .where(eq(stores.id, parseInt(id)));

      res.json({
        message: "Store deleted successfully"
      });
    } catch (error) {
      console.error('Error deleting store:', error);
      res.status(500).json({
        message: "Failed to delete store",
        suggestion: "Please try again later"
      });
    }
  });

  // Purchase Orders endpoints
  app.get("/api/purchase-orders", requireAuth, async (req, res) => {
    try {
      const allPurchaseOrders = await db.query.purchaseOrders.findMany({
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
            await db
              .update(inventory)
              .set({
                quantity: currentInventory.quantity + item.quantity,
                updatedAt: new Date()
              })
              .where(eq(inventory.id, currentInventory.id));
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

            await db
              .insert(inventory)
              .values({
                productId: item.productId,
                quantity: item.quantity,
                inventoryType: 'DC',
                storeId: purchaseOrder.destinationStoreId, // Explicitly link to the DC/Warehouse
                barcode,
                supplierId: purchaseOrder.supplierId,
                purchaseDate: new Date().toISOString().split('T')[0] // YYYY-MM-DD format
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
            const newQuantity = currentInventory.quantity + item.quantity;
            await db
              .update(inventory)
              .set({
                quantity: newQuantity,
                updatedAt: new Date()
              })
              .where(eq(inventory.id, currentInventory.id));
          } else {
            // Create new inventory entry
            const barcode = generateInventoryBarcode('DC', item.productId.toString(), currentPO.destinationStoreId);
            await db
              .insert(inventory)
              .values({
                productId: item.productId,
                quantity: item.quantity,
                inventoryType: 'DC',
                storeId: currentPO.destinationStoreId, // Explicitly link to the DC/Warehouse
                barcode,
                supplierId: currentPO.supplierId,
                purchaseDate: new Date()
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

  app.post("/api/roles", requirePermission('users', 'create'), async (req, res) => {
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

  app.put("/api/roles/:id", requirePermission('users', 'update'), async (req, res) => {
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

  app.delete("/api/roles/:id", requirePermission('users', 'delete'), async (req, res) => {
    try {
      const { id } = req.params;

      // Check if role exists and is not admin
      const roleToDelete = await db.query.roles.findFirst({
        where: eq(roles.id, parseInt(id)),
      });

      if (!roleToDelete) {
        return res.status(404).send("Role not found");
      }

      if (roleToDelete.name === 'admin') {
        return res.status(400).send("Cannot delete admin role");
      }

      // Check if role is assigned to any users
      const usersWithRole = await db.query.users.findMany({
        where: eq(users.roleId, parseInt(id)),
      });

      if (usersWithRole.length > 0) {
        return res.status(400).send("Cannot delete role that is assigned to users");
      }

      await db
        .delete(roles)
        .where(eq(roles.id, parseInt(id)));

      res.json({ message: "Role deleted successfully" });
    } catch (error) {
      console.error('Error deleting role:', error);
      res.status(500).send("Failed to delete role");
    }
  });

  // Add new endpoint for updating role permissions
  app.put("/api/roles/:id/permissions", requirePermission('users', 'update'), async (req, res) => {
    try {
      const { id } = req.params;
      const { permissions } = req.body;

      // Validate permissions object structure
      if (!permissions || typeof permissions !== 'object') {
        return res.status(400).send("Invalid permissions format");
      }

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

  app.post("/api/categories", requirePermission('masterData', 'create'), async (req, res) => {
    try {
      const { name, description } = req.body;

      if (!name) {
        return res.status(400).send("Category name is required");
      }

      // Check if category exists
      const existingCategory = await db.query.categories.findFirst({
        where: eq(categories.name, name),
      });

      if (existingCategory) {
        return res.status(400).send("Category name already exists");
      }

      const [newCategory] = await db
        .insert(categories)
        .values({
          name,
          description,
        })
        .returning();

      res.json({
        message: "Category created successfully",
        category: newCategory,
      });
    } catch (error) {
      console.error('Error creating category:', error);
      res.status(500).send("Failed to create category");
    }
  });

  app.put("/api/categories/:id", requirePermission('masterData', 'update'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description } = req.body;

      if (!name) {
        return res.status(400).send("Category name is required");
      }

      // Check if category exists
      const existingCategory = await db.query.categories.findFirst({
        where: and(
          eq(categories.name, name),
          sql`id != ${id}`
        ),
      });

      if (existingCategory) {
        return res.status(400).send("Category name already exists");
      }

      const [updatedCategory] = await db
        .update(categories)
        .set({
          name,
          description,
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
      console.error('Error updating category:', error);
      res.status(500).send("Failed to update category");
    }
  });

  app.delete("/api/categories/:id", requirePermission('masterData', 'delete'), async (req, res) => {
    try {
      const { id } = req.params;

      // Check if category is used by any products
      const products = await db.query.products.findMany({
        where: eq(products.categoryId, parseInt(id)),
        limit: 1,
      });

      if (products.length > 0) {
        return res.status(400).send("Cannot delete category that is assigned to products");
      }

      await db
        .delete(categories)
        .where(eq(categories.id, parseInt(id)));

      res.json({ message: "Category deleted successfully" });
    } catch (error) {
      console.error('Error deleting category:', error);
      res.status(500).send("Failed to delete category");
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

  app.post("/api/users", requirePermission('users', 'create'), async (req, res) => {
    try {
      const result = insertUserSchema.safeParse(req.body);
      if (!result.success) {
        return res
          .status(400)
          .json({
            message: "Invalid input",
            errors: result.error.errors.map(err => ({
              field: err.path.join('.'),
              message: err.message
            }))
          });
      }

      const { username, password, roleId } = result.data;

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

  app.put("/api/users/:id", requirePermission('users', 'update'), async (req, res) => {
    try {
      const { id } = req.params;

      // Validate input
      const result = updateUserSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      const { username, roleId, password } = result.data;

      if (!username && !roleId && !password) {
        return res.status(400).json({
          message: "No updates provided",
          suggestion: "Provide either username or roleId to update"
        });
      }

      // Verify user exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.id, parseInt(id)),
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
        .where(eq(users.id, parseInt(id)))
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

  app.delete("/api/users/:id", requirePermission('users', 'delete'), async (req, res) => {
    try {
      const { id } = req.params;

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
            where: eq(users.id, parseInt(id)),
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
        .where(eq(users.id, parseInt(id)));

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).send("Failed to delete user");
    }
  });

  app.post("/api/stores", requirePermission('stores', 'create'), async (req, res) => {
    try {
      const result = insertStoreSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      const { name, location, contactInfo, type } = result.data; // AI Agent Note: Added 'type' for multiple DC support

      // Check if store exists
      const existingStore = await db.query.stores.findFirst({
        where: eq(stores.name, name),
      });

      if (existingStore) {
        return res.status(400).json({
          message: "Store with this name already exists",
          suggestion: "Please use a different store name"
        });
      }

      const [newStore] = await db
        .insert(stores)
        .values({
          name,
          location,
          contactInfo,
          type: type || 'RETAIL', // AI Agent Note: Save store type
        })
        .returning();

      res.json({
        message: "Store created successfully",
        store: newStore,
      });
    } catch (error) {
      console.error('Error creating store:', error);
      res.status(500).json({
        message: "Failed to create store",
        suggestion: "Please try again later"
      });
    }
  });

  app.put("/api/stores/:id", requirePermission('stores', 'update'), async (req, res) => {
    try {
      const { id } = req.params;
      const result = insertStoreSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      const { name, location, contactInfo, type } = result.data; // AI Agent Note: Added 'type' for multiple DC support

      // Check if store exists
      const existingStore = await db.query.stores.findFirst({
        where: and(
          eq(stores.name, name),
          sql`id != ${id}`
        ),
      });

      if (existingStore) {
        return res.status(400).json({
          message: "Store with this name already exists",
          suggestion: "Please use a different store name"
        });
      }

      const [updatedStore] = await db
        .update(stores)
        .set({
          name,
          location,
          contactInfo,
          type: type || 'RETAIL', // AI Agent Note: Save store type
          updatedAt: new Date()
        })
        .where(eq(stores.id, parseInt(id)))
        .returning();

      if (!updatedStore) {
        return res.status(404).json({
          message: "Store not found",
          suggestion: "Please verify the store ID"
        });
      }

      res.json({
        message: "Store updated successfully",
        store: updatedStore,
      });
    } catch (error) {
      console.error('Error updating store:', error);
      res.status(500).json({
        message: "Failed to update store",
        suggestion: "Please try again later"
      });
    }
  });

  app.delete("/api/stores/:id", requirePermission('stores', 'delete'), async (req, res) => {
    try {
      const { id } = req.params;

      // Check if store exists
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, parseInt(id)),
      });

      if (!store) {
        return res.status(404).json({
          message: "Store not found",
          suggestion: "Please verify the store ID"
        });
      }

      // Check if store has any inventory
      const inventory = await db.query.inventory.findFirst({
        where: eq(inventory.storeId, parseInt(id)),
      });

      if (inventory) {
        return res.status(400).json({
          message: "Cannot delete store with existing inventory",
          suggestion: "Please transfer or remove all inventory items first"
        });
      }

      // Check if store has any orders
      const orders = await db.query.orders.findFirst({
        where: eq(orders.storeId, parseInt(id)),
      });

      if (orders) {
        return res.status(400).json({
          message: "Cannot delete store with existing orders",
          suggestion: "Please archive or reassign orders first"
        });
      }

      // Check if store has any user assignments
      const assignments = await db.query.userStoreAssignments.findFirst({
        where: eq(userStoreAssignments.storeId, parseInt(id)),
      });

      if (assignments) {
        return res.status(400).json({
          message: "Cannot delete store with active user assignments",
          suggestion: "Please remove all user assignments first"
        });
      }

      await db
        .delete(stores)
        .where(eq(stores.id, parseInt(id)));

      res.json({
        message: "Store deleted successfully"
      });
    } catch (error) {
      console.error('Error deleting store:', error);
      res.status(500).json({
        message: "Failed to delete store",
        suggestion: "Please try again later"
      });
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
      const [orderStats] = await db
        .select({
          totalOrders: sql<number>`count(*)`,
          revenue: sql<number>`sum(total)`,
        })
        .from(orders)
        .where(
          and(
            gte(orders.createdAt, new Date(new Date().setDate(new Date().getDate() - 30))),
            lt(orders.createdAt, new Date())
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
    const trend = await db
      .select({
        date: sql<string>`date_trunc('day', created_at)::date`,
        orders: sql<number>`count(*)`,
      })
      .from(orders)
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
    description: z.string().optional(),
    sku: z.string().min(1, "SKU is required"),
    price: z.number().min(0, "Price must be positive"),
    categoryId: z.number().positive("Category ID is required"),
    minStock: z.number().int().min(0, "Minimum stock must be positive").optional(),
    brandId: z.number().positive("Brand ID is required").optional(),
  });

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

      const { name, sku, price, description, categoryId, minStock, brandId } = result.data;

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

      // Check if brand exists
      const brand = await db.query.brands.findFirst({
        where: eq(brands.id, brandId),
      });

      if (brandId && !brand) {
        return res.status(400).json({
          message: "Brand not found",
          suggestion: "Please select a valid brand"
        });
      }

      const [newProduct] = await db
        .insert(products)
        .values({
          name,
          sku,
          price,
          description,
          categoryId,
          minStock: minStock || 0,
          brandId: brandId || null,
        })
        .returning();

      // Fetch the complete product with category and brand
      const productWithCategoryAndBrand = await db.query.products.findFirst({
        where: eq(products.id, newProduct.id),
        with: {
          category: true,
          brand: true,
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
      const { name, description, sku, price, categoryId, minStock, brandId } = req.body;

      if (!name || !sku || !price || !categoryId) {
        return res.status(400).send("Name, SKU, price, and category are required");
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

      // Check if brand exists
      const brand = await db.query.brands.findFirst({
        where: eq(brands.id, brandId),
      });

      if (brandId && !brand) {
        return res.status(400).json({
          message: "Brand not found",
          suggestion: "Please select a valid brand"
        });
      }

      const [updatedProduct] = await db
        .update(products)
        .set({
          name,
          description,
          sku,
          price,
          categoryId,
          minStock,
          brandId: brandId || null,
          updatedAt: new Date(),
        })
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

      console.log(`Fetching inventory for user ${user.username} (Admin: ${user.role?.isSystemAdmin})`);

      let inventoryQuery = db.query.inventory.findMany({
        with: {
          product: true,
          store: true,
          supplier: true, // Add supplier relation
        },
      });

      const inventoryItems = await inventoryQuery;

      console.log(`Found ${inventoryItems.length} inventory items for admin user ${user.username}`);

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
      const [newInventory] = await db
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
      const [updatedInventory] = await db
        .update(inventory)
        .set({
          productId: parseInt(productId),
          storeId: storeId ? parseInt(storeId) : null,
          supplierId: supplierId ? parseInt(supplierId) : null,
          quantity: parseInt(quantity),
          location,
          inventoryType,
          updatedAt: new Date(),
        })
        .where(eq(inventory.id, parseInt(id)))
        .returning();

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

  // POS Sales Transaction API endpoints
  // Create new sales transaction
  app.post("/api/sales-transactions", requirePermission('pos', 'create'), async (req, res) => {
    try {
      const { items, paymentMethod, customerProfileId, transactionType } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          message: "At least one item is required",
          suggestion: "Add products to the transaction"
        });
      }

      if (!paymentMethod) {
        return res.status(400).json({
          message: "Payment method is required"
        });
      }

      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Determine transaction type and store
      let storeId: number | null = null;
      let finalTransactionType = transactionType || 'STORE_SALE';

      // Get user's store assignment for store sales
      if (finalTransactionType === 'STORE_SALE') {
        const userAssignment = await db.query.userStoreAssignments.findFirst({
          where: eq(userStoreAssignments.userId, user.id),
        });

        if (!userAssignment) {
          return res.status(403).json({
            message: "User is not assigned to any store",
            suggestion: "Contact administrator to assign you to a store"
          });
        }

        storeId = userAssignment.storeId;
      }

      // Validate and check stock for each item
      const validatedItems = [];
      for (const item of items) {
        if (!item.productId || !item.quantity || item.quantity <= 0) {
          return res.status(400).json({
            message: "Invalid item data",
            suggestion: "Each item must have productId and positive quantity"
          });
        }

        // Find available inventory for this product
        const availableInventory = await db.query.inventory.findFirst({
          where: and(
            eq(inventory.productId, item.productId),
            storeId ? eq(inventory.storeId, storeId) : eq(inventory.inventoryType, 'DC')
          ),
          with: {
            product: true,
          },
        });

        if (!availableInventory) {
          const product = await db.query.products.findFirst({
            where: eq(products.id, item.productId),
          });
          return res.status(400).json({
            message: `Product ${product?.name || 'Unknown'} is not available in ${storeId ? 'your store' : 'DC'}`,
            suggestion: "Choose a different product or check inventory"
          });
        }

        if (availableInventory.quantity < item.quantity) {
          const product = availableInventory.product || await db.query.products.findFirst({
            where: eq(products.id, item.productId),
          });
          return res.status(400).json({
            message: `Insufficient stock for ${product?.name || 'Unknown'}. Available: ${availableInventory.quantity}, Requested: ${item.quantity}`,
            suggestion: "Reduce quantity or choose a different product"
          });
        }

        // Always fetch product data directly to ensure we have the price
        const productData = await db.query.products.findFirst({
          where: eq(products.id, item.productId),
        });

        if (!productData) {
          return res.status(400).json({
            message: `Product with ID ${item.productId} not found`,
            suggestion: "Please verify the product exists"
          });
        }

        // Convert price to number for calculations
        const numericPrice = typeof productData.price === 'string' ? parseFloat(productData.price) : productData.price;

        if (!numericPrice || isNaN(numericPrice)) {
          return res.status(400).json({
            message: "Unable to determine product price",
            suggestion: "Please contact support - product may not be properly configured"
          });
        }

        validatedItems.push({
          ...item,
          inventoryId: availableInventory.id,
          unitPrice: numericPrice,
          totalPrice: numericPrice * item.quantity,
        });
      }

      // Calculate total amount
      const totalAmount = validatedItems.reduce((sum, item) => sum + item.totalPrice, 0);

      // Generate invoice number
      const invoiceNumber = await generateInvoiceNumber(storeId, finalTransactionType as 'STORE_SALE' | 'DC_SALE');

      // Create sales transaction
      const [salesTransaction] = await db
        .insert(salesTransactions)
        .values({
          invoiceNumber,
          storeId,
          transactionType: finalTransactionType,
          cashierUserId: user.id,
          customerProfileId: customerProfileId || null,
          totalAmount: totalAmount.toString(),
          paymentMethod,
          status: 'completed',
        })
        .returning();

      // Create sales transaction items and update inventory
      await Promise.all(validatedItems.map(async (item) => {
        // Create transaction item
        await db.insert(salesTransactionItems).values({
          salesTransactionId: salesTransaction.id,
          productId: item.productId,
          inventoryId: item.inventoryId,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          totalPrice: item.totalPrice.toString(),
        });

        // Update inventory quantity
        await db
          .update(inventory)
          .set({
            quantity: sql`${inventory.quantity} - ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(inventory.id, item.inventoryId));
      }));

      // Log transaction action
      await db.insert(salesTransactionActions).values({
        salesTransactionId: salesTransaction.id,
        actionType: 'sale_completed',
        actionData: { itemsCount: validatedItems.length, totalAmount },
        performedByUserId: user.id,
      });

      // Fetch complete transaction with details
      const completeTransaction = await db.query.salesTransactions.findFirst({
        where: eq(salesTransactions.id, salesTransaction.id),
        with: {
          items: {
            with: {
              product: true,
              inventory: true,
            },
          },
          store: true,
          cashierUser: true,
          customerProfile: true,
        },
      });

      res.json({
        message: "Sales transaction completed successfully",
        transaction: completeTransaction,
      });
    } catch (error) {
      console.error('Error creating sales transaction:', error);
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

      // Store filtering based on user permissions
      if (store_id) {
        const storeIdNum = parseInt(store_id);
        if (!isNaN(storeIdNum)) {
          whereConditions.push(eq(salesTransactions.storeId, storeIdNum));
        }
      } else {
        // Get user's assigned stores for filtering
        const userAssignments = await db.query.userStoreAssignments.findMany({
          where: eq(userStoreAssignments.userId, user.id),
        });

        if (userAssignments.length > 0) {
          const storeIds = userAssignments.map(assignment => assignment.storeId);
          // Users can see transactions from their assigned stores OR transactions they created
          whereConditions.push(
            or(
              sql`${salesTransactions.storeId} IN ${storeIds}`,
              eq(salesTransactions.cashierUserId, user.id)
            )
          );
        } else {
          // If user has no store assignments, they can only see transactions they created
          whereConditions.push(eq(salesTransactions.cashierUserId, user.id));
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
  app.post("/api/sales-transactions/:id/refund", requirePermission('receipts', 'update'), async (req, res) => {
    try {
      const { id } = req.params;
      const { refundAmount, reason, items } = req.body;

      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Get the original transaction
      const transaction = await db.query.salesTransactions.findFirst({
        where: eq(salesTransactions.id, parseInt(id)),
        with: {
          items: {
            with: {
              product: true,
              inventory: true,
            },
          },
        },
      });

      if (!transaction) {
        return res.status(404).json({
          message: "Sales transaction not found",
          suggestion: "Verify the transaction ID"
        });
      }

      if (transaction.status === 'refunded') {
        return res.status(400).json({
          message: "Transaction has already been refunded",
          suggestion: "Cannot refund an already refunded transaction"
        });
      }

      if (transaction.status === 'voided') {
        return res.status(400).json({
          message: "Cannot refund a voided transaction",
          suggestion: "Voided transactions cannot be refunded"
        });
      }

      // Validate refund amount
      const transactionTotal = parseFloat(transaction.totalAmount);
      const requestedRefund = refundAmount ? parseFloat(refundAmount) : transactionTotal;

      if (requestedRefund > transactionTotal) {
        return res.status(400).json({
          message: "Refund amount cannot exceed transaction total",
          suggestion: `Maximum refund amount is ${transactionTotal}`
        });
      }

      // Process refund - restore inventory
      if (items && Array.isArray(items)) {
        // Partial refund by items
        for (const refundItem of items) {
          const transactionItem = transaction.items.find(item => item.id === refundItem.id);
          if (!transactionItem) {
            return res.status(400).json({
              message: `Transaction item ${refundItem.id} not found`,
              suggestion: "Verify the item IDs to refund"
            });
          }

          if (refundItem.quantity > transactionItem.quantity) {
            return res.status(400).json({
              message: `Refund quantity for ${transactionItem.product.name} cannot exceed sold quantity`,
              suggestion: `Maximum refund quantity is ${transactionItem.quantity}`
            });
          }

          // Restore inventory
          await db
            .update(inventory)
            .set({
              quantity: sql`${inventory.quantity} + ${refundItem.quantity}`,
              updatedAt: new Date(),
            })
            .where(eq(inventory.id, transactionItem.inventoryId));
        }
      } else {
        // Full refund - restore all inventory
        for (const item of transaction.items) {
          await db
            .update(inventory)
            .set({
              quantity: sql`${inventory.quantity} + ${item.quantity}`,
              updatedAt: new Date(),
            })
            .where(eq(inventory.id, item.inventoryId));
        }
      }

      // Update transaction status
      await db
        .update(salesTransactions)
        .set({
          status: 'refunded',
          updatedAt: new Date(),
        })
        .where(eq(salesTransactions.id, parseInt(id)));

      // Log refund action
      await db.insert(salesTransactionActions).values({
        salesTransactionId: parseInt(id),
        actionType: 'refund_processed',
        actionData: {
          refundAmount: requestedRefund,
          reason: reason || 'No reason provided',
          items: items || 'full refund'
        },
        performedByUserId: user.id,
      });

      res.json({
        message: "Refund processed successfully",
        refundAmount: requestedRefund,
      });
    } catch (error) {
      console.error('Error processing refund:', error);
      res.status(500).json({
        message: "Failed to process refund",
        suggestion: "Please try again later"
      });
    }
  });

  // Cancel sales transaction
  app.post("/api/sales-transactions/:id/cancel", requirePermission('receipts', 'update'), async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Get the transaction
      const transaction = await db.query.salesTransactions.findFirst({
        where: eq(salesTransactions.id, parseInt(id)),
      });

      if (!transaction) {
        return res.status(404).json({
          message: "Sales transaction not found",
          suggestion: "Verify the transaction ID"
        });
      }

      if (transaction.status !== 'completed') {
        return res.status(400).json({
          message: "Only completed transactions can be cancelled",
          suggestion: "Transaction must be in completed status to cancel"
        });
      }

      // Update transaction status to cancelled
      await db
        .update(salesTransactions)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
        })
        .where(eq(salesTransactions.id, parseInt(id)));

      // Log cancellation action
      await db.insert(salesTransactionActions).values({
        salesTransactionId: parseInt(id),
        actionType: 'transaction_cancelled',
        actionData: {
          reason: reason || 'Cancelled by user',
          cancelledBy: user.username
        },
        performedByUserId: user.id,
      });

      res.json({
        message: "Transaction cancelled successfully",
      });
    } catch (error) {
      console.error('Error cancelling transaction:', error);
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
  app.post("/api/inventory/check-stock", requireAuth, async (req, res) => {
    try {
      const { items, storeId } = req.body;

      if (!items || !Array.isArray(items)) {
        return res.status(400).json({
          message: "Items array is required",
          suggestion: "Provide items to check stock for"
        });
      }

      const stockCheckResults = [];

      for (const item of items) {
        if (!item.productId || !item.quantity) {
          return res.status(400).json({
            message: "Each item must have productId and quantity",
            suggestion: "Provide valid item data"
          });
        }

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

      // Store filters - users can only see transfers involving their stores
      const userAssignment = await db.query.userStoreAssignments.findFirst({
        where: eq(userStoreAssignments.userId, user.id),
      });

      if (userAssignment) {
        // Regular users see transfers from/to their store
        whereConditions.push(
          or(
            eq(transferRequests.fromStoreId, userAssignment.storeId),
            eq(transferRequests.toStoreId, userAssignment.storeId)
          )
        );
      }
      // Admins can see all transfers (no additional filter)

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
        await db
          .update(inventory)
          .set({
            quantity: sql`${inventory.quantity} - ${item.approvedQuantity}`,
            updatedAt: new Date(),
          })
          .where(eq(inventory.id, sourceInventory.id));

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
          await db
            .update(inventory)
            .set({
              quantity: sql`${inventory.quantity} + ${item.approvedQuantity}`,
              updatedAt: new Date(),
            })
            .where(eq(inventory.id, destInventory.id));

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
      // Deduct from source
      await db
        .update(inventory)
        .set({
          quantity: sql`${inventory.quantity} - ${quantity}`,
          updatedAt: new Date(),
        })
        .where(eq(inventory.id, sourceInventory.id));

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
      if (destInventory) {
        await db
          .update(inventory)
          .set({
            quantity: sql`${inventory.quantity} + ${quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(inventory.id, destInventory.id));
        destInventoryId = destInventory.id;
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
