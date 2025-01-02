import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import {
  products, inventory, orders, orderItems, users,
  roles, roleLocations, stores, userStoreAssignments,
  categories, brands, suppliers, purchaseOrders,
  purchaseOrderItems, customerProfiles, insertCustomerProfileSchema,
  insertUserSchema, updateUserSchema,
  bills, billItems, createBillSchema // Added
} from "@db/schema";
import { sql } from "drizzle-orm";
import { eq, and, desc, gte, lt, isNull } from "drizzle-orm";
import { requireRole, requireAuth } from "./middleware";
import { z } from "zod";
import { crypto } from "./auth";

// Schema validations
const createPurchaseOrderSchema = z.object({
  supplierId: z.number().positive("Supplier ID is required"),
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
  const storePrefix = storeId ? storeId.toString().padStart(3, '0') : '000';
  return `${prefix}${storePrefix}${productSku}${randomNum}`;
}

// Inside registerRoutes function, add helper function for checking inventory permissions
function hasInventoryEditPermission(req: any) {
  // Check if user is admin or has inventory edit permission
  return req.user?.role?.name === 'admin' ||
    req.user?.role?.permissions?.inventory?.update === true;
}

// Add helper function to check customer profile permissions
function hasCustomerProfilePermission(req: any, action: 'create' | 'read' | 'update' | 'delete'): boolean {
  return req.user?.role?.name === 'admin' ||
    req.user?.role?.permissions?.customerProfiles?.[action] === true;
}

export function registerRoutes(app: Express): Server {
  // sets up /api/register, /api/login, /api/logout, /api/user
  setupAuth(app);

  // Brands endpoints
  app.get("/api/brands", requireAuth, async (req, res) => {
    try {
      const allBrands = await db.query.brands.findMany({
        orderBy: [desc(brands.updatedAt)],
      });
      res.json(allBrands);
    } catch (error) {
      console.error('Error fetching brands:', error);
      res.status(500).json({
        message: "Failed to fetch brands",
        suggestion: "Please try again later"
      });
    }
  });

  app.post("/api/brands", requireAuth, async (req, res) => {
    try {
      const result = insertBrandSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      const { name, description } = result.data;

      // Check if brand exists
      const existingBrand = await db.query.brands.findFirst({
        where: eq(brands.name, name),
      });

      if (existingBrand) {
        return res.status(400).json({
          message: "Brand name already exists",
          suggestion: "Please use a different brand name"
        });
      }

      const [newBrand] = await db
        .insert(brands)
        .values({
          name,
          description: description || null,
        })
        .returning();

      res.json({
        message: "Brand created successfully",
        brand: newBrand,
      });
    } catch (error) {
      console.error('Error creating brand:', error);
      res.status(500).json({
        message: "Failed to create brand",
        suggestion: "Please try again later"
      });
    }
  });

  app.put("/api/brands/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const result = insertBrandSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      const { name, description } = result.data;

      // Check if brand exists
      const existingBrand = await db.query.brands.findFirst({
        where: and(
          eq(brands.name, name),
          sql`id != ${id}`
        ),
      });

      if (existingBrand) {
        return res.status(400).json({
          message: "Brand name already exists",
          suggestion: "Please use a different brand name"
        });
      }

      const [updatedBrand] = await db
        .update(brands)
        .set({
          name,
          description: description || null,
          updatedAt: new Date(),
        })
        .where(eq(brands.id, parseInt(id)))
        .returning();

      res.json({
        message: "Brand updated successfully",
        brand: updatedBrand,
      });
    } catch (error) {
      console.error('Error updating brand:', error);
      res.status(500).json({
        message: "Failed to update brand",
        suggestion: "Please try again later"
      });
    }
  });

  app.delete("/api/brands/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      // Check if brand exists
      const brand = await db.query.brands.findFirst({
        where: eq(brands.id, parseInt(id)),
      });

      if (!brand) {
        return res.status(404).json({
          message: "Brand not found",
          suggestion: "Please verify the brand ID"
        });
      }

      await db
        .delete(brands)
        .where(eq(brands.id, parseInt(id)));

      res.json({ message: "Brand deleted successfully" });
    } catch (error) {
      console.error('Error deleting brand:', error);
      res.status(500).json({
        message: "Failed to delete brand",
        suggestion: "Please try again later"
      });
    }
  });

  // Add middleware to log all API requests
  app.use('/api', (req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });

  app.use('/api', requireAuth);

  // Customer Profiles endpoints
  app.get("/api/customer-profiles", requireAuth, async (req, res) => {
    try {
      if (!hasCustomerProfilePermission(req, 'read')) {
        return res.status(403).json({
          message: "You don't have permission to view customer profiles",
          suggestion: "Please contact your administrator"
        });
      }

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

  app.get("/api/customer-profiles/:id", requireAuth, async (req, res) => {
    try {
      if (!hasCustomerProfilePermission(req, 'read')) {
        return res.status(403).json({
          message: "You don't have permission to view customer profiles",
          suggestion: "Please contact your administrator"
        });
      }

      const { id } = req.params;

      const customerProfile = await db.query.customerProfiles.findFirst({
        where: eq(customerProfiles.id, parseInt(id)),
      });

      if (!customerProfile) {
        return res.status(404).json({
          message: "Customer profile not found",
          suggestion: "Please verify the profile ID"
        });
      }

      res.json(customerProfile);
    } catch (error) {
      console.error('Error fetching customer profile:', error);
      res.status(500).json({
        message: "Failed to fetch customer profile",
        suggestion: "Please try again later"
      });
    }
  });

  app.post("/api/customer-profiles", requireAuth, async (req, res) => {
    try {
      if (!hasCustomerProfilePermission(req, 'create')) {
        return res.status(403).json({
          message: "You don't have permission to create customer profiles",
          suggestion: "Please contact your administrator"
        });
      }

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

  app.put("/api/customer-profiles/:id", requireAuth, async (req, res) => {
    try {
      if (!hasCustomerProfilePermission(req, 'update')) {
        return res.status(403).json({
          message: "You don't have permission to update customer profiles",
          suggestion: "Please contact your administrator"
        });
      }

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

  app.delete("/api/customer-profiles/:id", requireAuth, async (req, res) => {
    try {
      if (!hasCustomerProfilePermission(req, 'delete')) {
        return res.status(403).json({
          message: "You don't have permission to delete customer profiles",
          suggestion: "Please contact your administrator"
        });
      }

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


  // Add these routes after the customer profiles endpoints
  // Bills endpoints
  app.get("/api/bills", requireAuth, async (req, res) => {
    try {
      const allBills = await db.query.bills.findMany({
        with: {
          store: true,
          customerProfile: true,
          items: {
            with: {
              product: true
            }
          }
        },
        orderBy: [desc(bills.createdAt)],
      });
      res.json(allBills);
    } catch (error) {
      console.error('Error fetching bills:', error);
      res.status(500).json({
        message: "Failed to fetch bills",
        suggestion: "Please try again later"
      });
    }
  });

  app.post("/api/bills", requireAuth, async (req, res) => {
    try {
      const result = createBillSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      const { storeId, customerProfileId, items } = result.data;

      // Get store details for bill number prefix
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, storeId),
      });

      if (!store) {
        return res.status(404).json({
          message: "Store not found",
          suggestion: "Please verify the store ID"
        });
      }

      // Get next bill number for the store
      const lastBill = await db.query.bills.findFirst({
        where: eq(bills.storeId, storeId),
        orderBy: [desc(bills.billNumber)],
      });

      let sequence = 1;
      if (lastBill) {
        const lastSequence = parseInt(lastBill.billNumber.split('-')[1]);
        sequence = lastSequence + 1;
      }

      const billNumber = `${store.billPrefix}-${sequence}`;

      // Calculate totals
      let subtotal = 0;
      let vatAmount = 0;
      let totalAmount = 0;

      const billItemsData = await Promise.all(items.map(async (item) => {
        const product = await db.query.products.findFirst({
          where: eq(products.id, item.productId),
          with: {
            category: true,
            brand: true,
          }
        });

        if (!product) {
          throw new Error(`Product with ID ${item.productId} not found`);
        }

        const itemSubtotal = item.quantity * item.unitPrice;
        const itemVat = itemSubtotal * 0.1; // 10% VAT
        const itemTotal = itemSubtotal + itemVat;

        subtotal += itemSubtotal;
        vatAmount += itemVat;
        totalAmount += itemTotal;

        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          productName: product.name,
          productDescription: product.description || null,
          categoryName: product.category.name,
          brandName: product.brand?.name || null,
          subtotal: itemSubtotal.toString(),
          vatAmount: itemVat.toString(),
          totalAmount: itemTotal.toString(),
        };
      }));

      // Calculate points (1 point per 1000 spent)
      const pointsAwarded = Math.floor(totalAmount / 1000);

      // Create bill with items
      const [newBill] = await db
        .insert(bills)
        .values({
          billNumber,
          storeId,
          customerProfileId: customerProfileId || null,
          subtotal: subtotal.toString(),
          vatAmount: vatAmount.toString(),
          totalAmount: totalAmount.toString(),
          pointsAwarded,
          status: 'completed',
        })
        .returning();

      // Create bill items
      await Promise.all(billItemsData.map(itemData =>
        db.insert(billItems)
          .values({
            billId: newBill.id,
            ...itemData,
          })
      ));

      // Fetch the complete bill with items
      const billWithDetails = await db.query.bills.findFirst({
        where: eq(bills.id, newBill.id),
        with: {
          store: true,
          customerProfile: true,
          items: {
            with: {
              product: true
            }
          }
        }
      });

      res.json({
        message: "Bill created successfully",
        bill: billWithDetails
      });
    } catch (error) {
      console.error('Error creating bill:', error);
      res.status(500).json({
        message: "Failed to create bill",
        suggestion: "Please try again later"
      });
    }
  });

  app.get("/api/bills/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      const bill = await db.query.bills.findFirst({
        where: eq(bills.id, parseInt(id)),
        with: {
          store: true,
          customerProfile: true,
          items: {
            with: {
              product: true
            }
          }
        }
      });

      if (!bill) {
        return res.status(404).json({
          message: "Bill not found",
          suggestion: "Please verify the bill ID"
        });
      }

      res.json(bill);
    } catch (error) {
      console.error('Error fetching bill:', error);
      res.status(500).json({
        message: "Failed to fetch bill",
        suggestion: "Please try again later"
      });
    }
  });

  app.get("/api/products/barcode/:code", requireAuth, async (req, res) => {
    try {
      const { code } = req.params;

      const product = await db.query.products.findFirst({
        where: eq(products.barcode, code),
        with: {
          category: true,
          brand: true,
        }
      });

      if (!product) {
        return res.status(404).json({
          message: "Product not found",
          suggestion: "Please verify the barcode"
        });
      }

      res.json(product);
    } catch (error) {
      console.error('Error fetching product by barcode:', error);
      res.status(500).json({
        message: "Failed to fetch product",
        suggestion: "Please try again later"
      });
    }
  });

  // Role Locations CRUD endpoints
  app.get("/api/role-locations", requireAuth, async (req, res) => {
    try {
      const allRoleLocations = await db.query.roleLocations.findMany({
        orderBy: [desc(roleLocations.id)],
      });
      res.json(allRoleLocations);
    } catch (error) {
      console.error('Error fetching role locations:', error);
      res.status(500).json({
        message: "Failed to fetch role locations",
        suggestion: "Please try again later"
      });
    }
  });

  app.post("/api/role-locations", requireRole(['admin']), async (req, res) => {
    try {
      const { description } = req.body;

      if (!description) {
        return res.status(400).json({
          message: "Description is required",
          suggestion: "Please provide a description for the role location"
        });
      }

      const [newRoleLocation] = await db
        .insert(roleLocations)
        .values({
          description,
        })
        .returning();

      res.json({
        message: "Role location created successfully",
        roleLocation: newRoleLocation,
      });
    } catch (error) {
      console.error('Error creating role location:', error);
      res.status(500).json({
        message: "Failed to create role location",
        suggestion: "Please try again later"
      });
    }
  });

  app.put("/api/role-locations/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;
      const { description } = req.body;

      if (!description) {
        return res.status(400).json({
          message: "Description is required",
          suggestion: "Please provide a description for the role location"
        });
      }

      // Check if role location exists
      const existingLocation = await db.query.roleLocations.findFirst({
        where: eq(roleLocations.id, parseInt(id)),
      });

      if (!existingLocation) {
        return res.status(404).json({
          message: "Role location not found",
          suggestion: "Please verify the role location ID"
        });
      }

      const [updatedLocation] = await db
        .update(roleLocations)
        .set({
          description,
        })
        .where(eq(roleLocations.id, parseInt(id)))
        .returning();

      res.json({
        message: "Role location updated successfully",
        roleLocation: updatedLocation,
      });
    } catch (error) {
      console.error('Error updating role location:', error);
      res.status(500).json({
        message: "Failed to update role location",
        suggestion: "Please try again later"
      });
    }
  });

  app.delete("/api/role-locations/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;

      // Check if role location exists
      const location = await db.query.roleLocations.findFirst({
        where: eq(roleLocations.id, parseInt(id)),
      });

      if (!location) {
        return res.status(404).json({
          message: "Role location not found",
          suggestion: "Please verify the role location ID"
        });
      }

      // Check if any roles are using this location
      const rolesUsingLocation = await db.query.roles.findMany({
        where: eq(roles.roleLocationId, parseInt(id)),
        limit: 1,
      });

      if (rolesUsingLocation.length > 0) {
        return res.status(400).json({
          message: "Cannot delete role location that is assigned to roles",
          suggestion: "Please remove all roles from this location before deleting"
        });
      }

      await db
        .delete(roleLocations)
        .where(eq(roleLocations.id, parseInt(id)));

      res.json({ message: "Role location deleted successfully" });
    } catch (error) {
      console.error('Error deleting role location:', error);
      res.status(500).json({
        message: "Failed to delete role location",
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
          }
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

      const { supplierId, deliveryDate, notes, items } = result.data;

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
          // Get current inventory
          const [currentInventory] = await db
            .select({
              id: inventory.id,
              quantity: inventory.quantity
            })
            .from(inventory)
            .where(
              and(
                eq(inventory.productId, item.productId),
                eq(inventory.inventoryType, 'DC')
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
            const barcode = generateInventoryBarcode('DC', item.productId.toString());
            await db
              .insert(inventory)
              .values({
                productId: item.productId,
                quantity: item.quantity,
                inventoryType: 'DC',
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

  // Add supplier routes with proper error handling
  app.post("/api/suppliers", requireRole(['admin']), async (req, res) => {
    try {
      const { name, contactInfo, address } = req.body;

      if (!name || !contactInfo || !address) {
        return res.status(400).json({
          message: "Name, contact info, and address are required",
          suggestion: "Please fill in all required fields"
        });
      }

      // Check if supplier exists
      const existingSupplier = await db.query.suppliers.findFirst({
        where: eq(suppliers.name, name),
      });

      if (existingSupplier) {
        return res.status(400).json({
          message: "Supplier name already exists",
          suggestion: "Please use a different supplier name"
        });
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
      res.status(500).json({
        message: "Failed to create supplier",
        suggestion: "Please try again later"
      });
    }
  });

  // Get all suppliers
  app.get("/api/suppliers", requireAuth, async (req, res) => {
    try {
      const allSuppliers = await db.query.suppliers.findMany({
        orderBy: [desc(suppliers.updatedAt)],
      });
      res.json(allSuppliers);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
      res.status(500).json({
        message: "Failed to fetch suppliers",
        suggestion: "Please try again later"
      });
    }
  });

  // Update supplier
  app.put("/api/suppliers/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, contactInfo, address } = req.body;

      if (!name || !contactInfo || !address) {
        return res.status(400).json({
          message: "Name, contact info, and address are required",
          suggestion: "Please fill in all required fields"
        });
      }

      // Check if supplier exists
      const existingSupplier = await db.query.suppliers.findFirst({
        where: and(
          eq(suppliers.name, name),
          sql`id != ${id}`
        ),
      });

      if (existingSupplier) {
        return res.status(400).json({
          message: "Supplier name already exists",
          suggestion: "Please use a different supplier name"
        });
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

      res.json({
        message: "Supplier updated successfully",
        supplier: updatedSupplier,
      });
    } catch (error) {
      console.error('Error updating supplier:', error);
      res.status(500).json({
        message: "Failed to update supplier",
        suggestion: "Please try again later"
      });
    }
  });

  // Delete supplier
  app.delete("/api/suppliers/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;

      // Check if supplier exists
      const supplier = await db.query.suppliers.findFirst({
        where: eq(suppliers.id, parseInt(id)),
      });

      if (!supplier) {
        return res.status(404).json({
          message: "Supplier not found",
          suggestion: "Please verify the supplier ID"
        });
      }

      await db
        .delete(suppliers)
        .where(eq(suppliers.id, parseInt(id)));

      res.json({ message: "Supplier deleted successfully" });    } catch (error) {
      console.error('Error deleting supplier:', error);
      res.status(500).json({
        message: "Failed to delete supplier",
        suggestion: "Please try again later"
      });
    }
  });

  // Add this endpoint to get unassigned store users
  app.get("/api/store-assignments/users", requireAuth, async (req, res) => {
    try {
      // Get users who have store-related roles and are not assigned to any store
      const unassignedUsers = await db
        .select({
          id: users.id,
          username: users.username,
          role: {
            id: roles.id,
            name: roles.name,
            roleLocation: {
              id: roleLocations.id,
              description: roleLocations.description
            }
          }
        })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .innerJoin(roleLocations, eq(roles.roleLocationId, roleLocations.id))
        .leftJoin(userStoreAssignments, eq(users.id, userStoreAssignments.userId))
        .where(
          and(
            // Include users with store-related roles by checking the roleLocation description
            eq(roleLocations.description, 'Pet Store'),
            // Only include users not assigned to any store
            isNull(userStoreAssignments.id)
          )
        )
        .orderBy(users.username);

      res.json(unassignedUsers);
    } catch (error) {
      console.error('Error fetching unassigned store users:', error);
      res.status(500).json({
        message: "Failed to fetch unassigned users",
        suggestion: "Please try again later"
      });
    }
  });

  // Inside registerRoutes function, update the /api/users route
  app.get("/api/users", requireAuth, async (req, res) => {
    try {
      const allUsers = await db
        .select({
          id: users.id,
          username: users.username,
          role: {
            id: roles.id,
            name: roles.name,
            roleLocation: {
              id: roleLocations.id,
              description: roleLocations.description
            }
          }
        })
        .from(users)
        .leftJoin(roles, eq(users.roleId, roles.id))
        .leftJoin(roleLocations, eq(roles.roleLocationId, roleLocations.id))
        .orderBy(users.username);

      res.json(allUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({
        message: "Failed to fetch users",
        suggestion: "Please try again later"
      });
    }
  });

  // Roles endpoints - admin only
  app.get("/api/roles", requireRole(['admin']), async (req, res) => {
    try {
      const allRoles = await db
        .select({
          id: roles.id,
          name: roles.name,
          description: roles.description,
          permissions: roles.permissions,
          roleLocationId: roles.roleLocationId,
          createdAt: roles.createdAt,
          updatedAt: roles.updatedAt,
          roleLocation: {
            id: roleLocations.id,
            description: roleLocations.description,
          },
        })
        .from(roles)
        .leftJoin(roleLocations, eq(roles.roleLocationId, roleLocations.id))
        .orderBy(roles.name);

      res.json(allRoles);
    } catch (error) {
      console.error('Error fetching roles:', error);
      res.status(500).json({
        message: "Failed to fetch roles",
        suggestion: "Please try again later"
      });
    }
  });

  app.post("/api/roles", requireRole(['admin']), async (req, res) => {
    try {
      const { name, description, roleLocationId, permissions } = req.body;

      if (!name || !roleLocationId || !permissions) {
        return res.status(400).json({
          message: "Role name, role type and permissions are required",
          suggestion: "Please fill in all required fields"
        });
      }

      // Check if role exists
      const existingRole = await db.query.roles.findFirst({
        where: eq(roles.name, name),
      });

      if (existingRole) {
        return res.status(400).json({
          message: "Role name already exists",
          suggestion: "Please use a different role name"
        });
      }

      // Check if role type exists
      const roleLocation = await db.query.roleLocations.findFirst({
        where: eq(roleLocations.id, parseInt(roleLocationId.toString())),
      });

      if (!roleLocation) {
        return res.status(400).json({
          message: "Invalid role type",
          suggestion: "Please select a valid role type"
        });
      }

      // Ensure all required permission sections are present
      const requiredPermissions = {
        products: { create: false, read: false, update: false, delete: false },
        orders: { create: false, read: false, update: false, delete: false },
        inventory: { create: false, read: false, update: false, delete: false },
        users: { create: false, read: false, update: false, delete: false },
        stores: { create: false, read: false, update: false, delete: false },
        customerProfiles: { create: false, read: false, update: false, delete: false }
      };

      // Merge provided permissions with default structure
      const mergedPermissions = {
        ...requiredPermissions,
        ...permissions,
        customerProfiles: {
          ...requiredPermissions.customerProfiles,
          ...(permissions.customerProfiles || {})
        }
      };

      // Create new role with permissions
      const [newRole] = await db
        .insert(roles)
        .values({
          name,
          description: description || null,
          roleLocationId: parseInt(roleLocationId.toString()),
          permissions: mergedPermissions,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();

      // Fetch the complete role with role type
      const roleWithLocation = await db.query.roles.findFirst({
        where: eq(roles.id, newRole.id),
        with: {
          roleLocation: true,
        },
      });

      res.json({
        message: "Role created successfully",
        role: roleWithLocation,
      });
    } catch (error) {
      console.error('Error creating role:', error);
      res.status(500).json({
        message: "Failed to create role",
        suggestion: "Please try again later"
      });
    }
  });

  app.put("/api/roles/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, roleLocationId, permissions } = req.body;

      if (!name || !roleLocationId) {
        return res.status(400).send("Role name and role type are required");
      }

      // Check if role exists
      const existingRole = await db.query.roles.findFirst({
        where: and(
          eq(roles.name, name),
          sql`id != ${id}`
        ),
      });

      if (existingRole) {
        return res.status(400).send("Role name already exists");
      }

      // Check if role type exists
      const roleLocation = await db.query.roleLocations.findFirst({
        where: eq(roleLocations.id, parseInt(roleLocationId)),
      });

      if (!roleLocation) {
        return res.status(400).send("Invalid role type");
      }

      // Prevent updating admin role name
      const roleToUpdate = await db.query.roles.findFirst({
        where: eq(roles.id, parseInt(id)),
      });

      if (roleToUpdate?.name === 'admin' && name !== 'admin') {
        return res.status(400).send("Cannot modify admin role name");
      }

      // Ensure all required permission sections are present
      const requiredPermissions = {
        products: { create: false, read: false, update: false, delete: false },
        orders: { create: false, read: false, update: false, delete: false },
        inventory: { create: false, read: false, update: false, delete: false },
        users: { create: false, read: false, update: false, delete: false },
        stores: { create: false, read: false, update: false, delete: false },
        customerProfiles: { create: false, read: false, update: false, delete: false }
      };

      // Merge provided permissions with default structure.  If no permissions are provided, use defaults.
      const mergedPermissions = {
        ...requiredPermissions,
        ...(permissions || {}),
        customerProfiles: {
          ...requiredPermissions.customerProfiles,
          ...(permissions?.customerProfiles || {})
        }
      };

      const [updatedRole] = await db
        .update(roles)
        .set({
          name,
          description,
          roleLocationId: parseInt(roleLocationId),
          permissions: mergedPermissions,
          updatedAt: new Date(),
        })
        .where(eq(roles.id, parseInt(id)))
        .returning();

      // Fetch the complete role with role type
      const roleWithLocation = await db.query.roles.findFirst({
        where: eq(roles.id, updatedRole.id),
        with: {
          roleLocation: true,
        },
      });

      res.json({
        message: "Role updated successfully",
        role: roleWithLocation,
      });
    } catch (error) {
      console.error('Error updating role:', error);
      res.status(500).send("Failed to update role");
    }
  });

  app.delete("/api/roles/:id", requireRole(['admin']), async (req, res) => {
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
  app.put("/api/roles/:id/permissions", requireRole(['admin']), async (req, res) => {
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

      // Fetch the complete role with updated permissions
      const roleWithPermissions = await db.query.roles.findFirst({
        where: eq(roles.id, updatedRole.id),
        with: {
          roleLocation: true,
        },
      });

      res.json({
        message: "Role permissions updated successfully",
        role: roleWithPermissions,
      });
    } catch (error) {
      console.error('Error updating role permissions:', error);
      res.status(500).send("Failed to update role permissions");
    }
  });

  // Category Management endpoints
  app.get("/api/categories", requireAuth, async (req, res) => {
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

  app.post("/api/categories", requireRole(['admin']), async (req, res) => {
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

  app.put("/api/categories/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description } = req.body;

      if (!name) {
        return res.status(400).send("Category name is required");
      }

      // Check if category exists
      const existingCategory = await db.query.categories.findFirst({
        where: eq(categories.id, parseInt(id)),
      });

      if (!existingCategory) {
        return res.status(404).send("Category not found");
      }

      // Check if new name is already taken by another category
      const duplicateCategory = await db.query.categories.findFirst({
        where: and(
          eq(categories.name, name),
          sql`id != ${id}`
        ),
      });

      if (duplicateCategory) {
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

  app.delete("/api/categories/:id", requireRole(['admin']), async (req, res) => {
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

  // Role Mapping endpoint - admin only
  app.get("/api/roles/mapping", requireRole(['admin']), async (req, res) => {
    try {
      // Fetch roles with users and role types
      const roles = await db.query.roles.findMany({
        with: {
          roleLocation: true,
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

  // User management endpoints - admin only
  app.get("/api/users", requireRole(['admin']), async (req, res) => {
    try {
      const allUsers = await db
        .select({
          id: users.id,
          username: users.username,
          roleId: users.roleId,
          role: {
            id: roles.id,
            name: roles.name,
            roleLocation: {
              id: roleLocations.id,
              description: roleLocations.description,
            }
          }
        })
        .from(users)
        .leftJoin(roles, eq(users.roleId, roles.id))
        .leftJoin(roleLocations, eq(roles.roleLocationId, roleLocations.id));

      res.json(allUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).send("Failed to fetch users");
    }
  });

  app.post("/api/users", requireRole(['admin']), async (req, res) => {
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
        return res.status(400).json({
          message: "Username already exists",
          suggestion: "Please choose a different username"
        });
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

      res.status(201).json({
        message: "User created successfully",
        user: {
          id: newUser.id,
          username: newUser.username,
          roleId: newUser.roleId,
          role: userWithRole?.role
        }
      });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({
        message: "Failed to create user",
        suggestion: "Please try again. If the problem persists, contact support."
      });
    }
  });

  app.put("/api/users/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;
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

      const updateData = result.data;

      // Convert username to lowercase if provided
      if (updateData.username) {
        updateData.username = updateData.username.toLowerCase();
        // Double check the lowercase validation
        if (!/^[a-z]+$/.test(updateData.username)) {
          return res.status(400).json({
            message: "Invalid username format",
            suggestion: "Username must contain only lowercase letters"
          });
        }
      }

      // Check if username already exists (if username is being updated)
      if (updateData.username) {
        const existingUser = await db.query.users.findFirst({
          where: and(
            eq(users.username, updateData.username),
            sql`id != ${id}`
          ),
        });

        if (existingUser) {
          return res.status(400).json({
            message: "Username already exists",
            suggestion: "Please choose a different username"
          });
        }
      }

      // Hash password if it's being updated
      if (updateData.password) {
        updateData.password = await crypto.hash(updateData.password);
      }

      // Update user
      const [updatedUser] = await db
        .update(users)
        .set({
          ...updateData,
          updatedAt: new Date()
        })
        .where(eq(users.id, parseInt(id)))
        .returning();

      if (!updatedUser) {
        return res.status(404).json({
          message: "User not found",
          suggestion: "Please verify the user ID"
        });
      }

      // Fetch the complete user with role
      const userWithRole = await db
        .select({
          id: users.id,
          username: users.username,
          role: {
            id: roles.id,
            name: roles.name,
            roleLocation: {
              id: roleLocations.id,
              description: roleLocations.description
            }
          }
        })
        .from(users)
        .leftJoin(roles, eq(users.roleId, roles.id))
        .leftJoin(roleLocations, eq(roles.roleLocationId, roleLocations.id))
        .where(eq(users.id, updatedUser.id))
        .limit(1);

      res.json({
        message: "User updated successfully",
        user: userWithRole[0]
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({
        message: "Failed to update user",
        suggestion: "Please try again later"
      });
    }
  });

  app.delete("/api/users/:id", requireRole(['admin']), async (req, res) => {
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

  // Stores endpoints - admin only
  app.get("/api/stores", requireRole(['admin']), async (req, res) => {
    try {
      const allStores = await db.query.stores.findMany({
        orderBy: [desc(stores.updatedAt)],
      });
      res.json(allStores);
    } catch (error) {
      console.error('Error fetching stores:', error);
      res.status(500).send("Failed to fetch stores");
    }
  });

  app.post("/api/stores", requireRole(['admin']), async (req, res) => {
    try {
      const { name, location, contactInfo } = req.body;

      if (!name || !location || !contactInfo) {
        return res.status(400).send("Name, location, and contact information are required");
      }

      const [newStore] = await db
        .insert(stores)
        .values({
          name,
          location,
          contactInfo,
        })
        .returning();

      res.json({
        message: "Store created successfully",
        store: newStore,
      });
    } catch (error) {
      console.error('Error creating store:', error);
      res.status(500).send("Failed to create store");
    }
  });

  app.put("/api/stores/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, location, contactInfo } = req.body;

      if (!name || !location || !contactInfo) {
        return res.status(400).send("Name, location, and contact information are required");
      }

      const [updatedStore] = await db
        .update(stores)
        .set({
          name,
          location,
          contactInfo,
          updatedAt: new Date(),
        })
        .where(eq(stores.id, parseInt(id)))
        .returning();

      if (!updatedStore) {
        return res.status(404).send("Store not found");
      }

      res.json({
        message: "Store updated successfully",
        store: updatedStore,
      });
    } catch (error) {
      console.error('Error updating store:', error);
      res.status(500).send("Failed to update store");
    }
  });

  app.delete("/api/stores/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;

      // Check if store exists
      const [store] = await db
        .select()
        .from(stores)
        .where(eq(stores.id, parseInt(id)))
        .limit(1);

      if (!store) {
        return res.status(404).send("Store not found");
      }

      // Check if store has any inventory
      const [inventoryCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(inventory)
        .where(eq(inventory.storeId, parseInt(id)));

      if (inventoryCount.count > 0) {
        return res.status(400).send("Cannot delete store with existing inventory");
      }

      // Check if store has any orders
      const [orderCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(eq(orders.storeId, parseInt(id)));

      if (orderCount.count > 0) {
        return res.status(400).send("Cannot delete store with existing orders");
      }

      await db
        .delete(stores)
        .where(eq(stores.id, parseInt(id)));

      res.json({ message: "Store deleted successfully" });
    } catch (error) {
      console.error('Error deleting store:', error);
      res.status(500).send("Failed to delete store");
    }
  });

  // User-Store Assignment endpoints
  app.get("/api/store-assignments", requireRole(['admin']), async (req, res) => {
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

  app.post("/api/store-assignments", requireRole(['admin']), async (req, res) => {
    try {
      const { userId, storeId } = req.body;

      if (!userId || !storeId) {
        return res.status(400).send("User ID and Store ID are required");
      }

      // Check if user exists and has pet store role
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        with: {
          role: {
            with: {
              roleLocation: true
            }
          }
        }
      });

      if (!user) {
        return res.status(404).send("User not found");
      }

      if (user.role?.roleLocation?.description !== 'Pet Store') {
        return res.status(400).send("Only Pet Store users can be assigned to stores");
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

  app.delete("/api/store-assignments/:id", requireRole(['admin']), async (req, res) => {
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

  // Stats API - admin only
  app.get("/api/stats/orders-trend", requireAuth, async (req, res) => {
    try {
      // Get orders count by date for the last 7 days
      const result = await db
        .select({
          date: sql<string>`DATE_TRUNC('day', ${orders.createdAt})::date`,
          orders: sql<number>`count(*)`
        })
        .from(orders)
        .where(
          gte(
            orders.createdAt,
            sql`NOW() - INTERVAL '7 days'`
          )
        )
        .groupBy(sql`DATE_TRUNC('day', ${orders.createdAt})`)
        .orderBy(sql`DATE_TRUNC('day', ${orders.createdAt})`);

      res.json(result);
    } catch (error) {
      console.error('Error fetching order trends:', error);
      res.status(500).json({
        message: "Failed to fetch order trends",
        suggestion: "Please try again later"
      });
    }
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

  // Products API - Create product (admin only)
  app.post("/api/products", requireRole(['admin']), async (req, res) => {
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

  // Products API - Update product (admin only)
  app.put("/api/products/:id", requireRole(['admin']), async (req, res) => {
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

  // Orders API - admin only
  app.get("/api/orders", requireRole(['admin']), async (req, res) => {
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

      // Get user's store assignment
      const userStoreAssignment = await db
        .select({
          storeId: userStoreAssignments.storeId,
          store: {
            id: stores.id,
            name: stores.name
          }
        })
        .from(userStoreAssignments)
        .leftJoin(stores, eq(stores.id, userStoreAssignments.storeId))
        .where(eq(userStoreAssignments.userId, user.id))
        .limit(1);

      console.log(`Fetching inventory for user ${user.username} with store assignment:`, userStoreAssignment);

      // Build the inventory query based on user'srole and store assignment
      const inventoryQuery = await db.query.inventory.findMany({
        where: userStoreAssignment?.[0]?.storeId
          ? eq(inventory.storeId, userStoreAssignment[0].storeId)
          : undefined,
        with: {
          product: true,
          store: true,
          supplier: true,
        },
      });

      console.log(`Found ${inventoryQuery.length} inventory items for store user ${user.username}`);

      res.json(inventoryQuery);
    } catch (error) {
      console.error('Error fetching inventory:', error);
      res.status(500).json({
        message: "Failed to fetch inventory",
        suggestion: "Please try again later"
      });
    }
  });

  app.post("/api/inventory", requireAuth, async (req, res) => {
    try {
      // Check if user has permission to edit inventory
      if (!hasInventoryEditPermission(req)) {
        return res.status(403).json({
          message: "You don't have permission to create inventory items",
          suggestion: "Please contact your administrator"
        });
      }

      const {
        productId,
        storeId,
        supplierId,
        quantity,
        location,
        inventoryType,
        centerId,
        barcode,
        purchaseDate,
        expiryDate
      } = req.body;

      // Validate required fields
      if (!productId || !quantity) {
        return res.status(400).json({
          message: "Product ID and quantity are required",
          suggestion: "Please provide all required fields"
        });
      }

      // Create new inventory item
      const [newInventory] = await db
        .insert(inventory)
        .values({
          productId: parseInt(productId),
          storeId: storeId ? parseInt(storeId) : null,
          supplierId: supplierId ? parseInt(supplierId) : null,
          quantity: parseInt(quantity),
          location,
          inventoryType: inventoryType || 'DC',
          centerId: centerId || 'DC001',
          barcode,
          purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
          expiryDate: expiryDate ? new Date(expiryDate) : null
        })
        .returning();

      // Fetch the complete inventory item with related data
      const inventoryWithDetails = await db.query.inventory.findFirst({
        where: eq(inventory.id, newInventory.id),
        with: {
          product: true,
          store: true,
          supplier: true
        }
      });

      res.json({
        message: "Inventory item created successfully",
        inventory: inventoryWithDetails
      });
    } catch (error) {
      console.error('Error creating inventory:', error);
      res.status(500).json({
        message: "Failed to create inventory item",
        suggestion: "Please try again later"
      });
    }
  });

  app.put("/api/inventory/:id", requireAuth, async (req, res) => {
    try {
      // Check if user has permission to edit inventory
      if (!hasInventoryEditPermission(req)) {
        return res.status(403).json({
          message: "You don't have permission to edit inventory",
          suggestion: "Please contact your administrator"
        });
      }

      const { id } = req.params;
      const {
        productId,
        storeId,
        supplierId,
        quantity,
        location,
        inventoryType,
        centerId,
        barcode,
        purchaseDate,
        expiryDate
      } = req.body;

      // Validate required fields
      if (!productId || !quantity) {
        return res.status(400).json({
          message: "Product ID and quantity are required",
          suggestion: "Please provide allrequired fields"
        });
      }

      // Update inventory item
      const [updatedInventory] = await db
        .update(inventory)
        .set({
          productId: parseInt(productId),
          storeId: storeId ? parseInt(storeId) : null,
          supplierId: supplierId ? parseInt(supplierId) : null,
          quantity: parseInt(quantity),
          location,
          inventoryType,
          centerId,
          barcode,
          purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          updatedAt: new Date()
        })
        .where(eq(inventory.id, parseInt(id)))
        .returning();

      // Fetch the complete inventory item with related data
      const inventoryWithDetails = await db.query.inventory.findFirst({
        where: eq(inventory.id, updatedInventory.id),
        with: {
          product: true,
          store: true,
          supplier: true
        }
      });

      res.json({
        message: "Inventory item updated successfully",
        inventory: inventoryWithDetails
      });
    } catch (error) {
      console.error('Error updating inventory:', error);
      res.status(500).json({
        message: "Failed to update inventory",
        suggestion: "Please try again later"
      });
    }
  });

  app.delete("/api/inventory/:id", requireRole(['admin']), async (req, res) => {
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
      const currentMonthStart = sql`date_trunc('month', current_date)`;
      const nextMonthStart = sql`date_trunc('month', current_date) + interval '1 month'`;

      // Get performance metrics for each store
      const storeMetrics = await db
        .select({
          storeId: stores.id,
          storeName: stores.name,
          // Monthly order count
          orderCount: sql<number>`count(distinct ${orders.id})::int`,
          // Total revenue
          revenue: sql<number>`coalesce(sum(${orders.total})::numeric, 0)`,
          // Average order value
          averageOrderValue: sql<number>`coalesce(avg(${orders.total})::numeric, 0)`,
          // Order fulfillment rate (completed orders / total orders)
          fulfillmentRate: sql<number>`
            case 
              when count(${orders.id}) > 0 
              then (sum(case when ${orders.status} = 'completed' then 1 else 0 end)::float / count(${orders.id}))::numeric
              else 0 
            end
          `,
          // Inventory turnover (items sold / average inventory)
          inventoryTurnover: sql<number>`
            coalesce(
              (sum(${orderItems.quantity})::float / nullif(avg(${inventory.quantity}), 0))::numeric,
              0
            )
          `
        })
        .from(stores)
        .leftJoin(orders, eq(orders.storeId, stores.id))
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .leftJoin(inventory, eq(inventory.storeId, stores.id))
        .where(
          and(
            gte(orders.createdAt, currentMonthStart),
            lt(orders.createdAt, nextMonthStart)
          )
        )
        .groupBy(stores.id)
        .orderBy(stores.name);

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

  // Remove duplicate /api/stats endpoints here and keep only the working ones
  //The original code has two /api/stats endpoints. Removing the duplicate.
  //The duplicate endpoint is at line 1582. Removing it.


  const httpServer = createServer(app);
  return httpServer;
}