import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import {
  products, inventory, orders, orderItems, users,
  roles, roleTypes, stores, userStoreAssignments,
  categories, brands, suppliers, purchaseOrders,
  purchaseOrderItems, customerProfiles, insertCustomerProfileSchema
} from "@db/schema";
import { sql } from "drizzle-orm";
import { eq, and, desc, gte, lt } from "drizzle-orm";
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

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  // Add middleware to log all API requests
  app.use('/api', (req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });

  // Health check endpoint (no auth required) - MUST be defined before auth middleware
  app.get("/api/health", async (req, res) => {
    try {
      // Test database connection
      const result = await db.execute("SELECT 1 as db_check");

      res.json({
        status: "ok",
        database: "connected",
        environment: process.env.NODE_ENV || "development",
        timestamp: new Date().toISOString(),
        databaseUrl: process.env.DATABASE_URL ? "configured" : "missing"
      });
    } catch (error: any) {
      console.error('Health check error:', error.message);
      res.status(500).json({
        status: "error",
        database: "disconnected",
        error: error.message,
        environment: process.env.NODE_ENV || "development",
        timestamp: new Date().toISOString(),
        databaseUrl: process.env.DATABASE_URL ? "configured" : "missing"
      });
    }
  });

  // Important: Login route must be defined BEFORE the global auth middleware
  app.post("/api/login", (req, res, next) => {
    const env = process.env.NODE_ENV || 'development';
    console.log(`[${env}] Login request received:`, {
      username: req.body.username,
      hasPassword: !!req.body.password,
      timestamp: new Date().toISOString()
    });

    // Check if username and password are provided
    if (!req.body.username || !req.body.password) {
      return res.status(400).json({
        message: "Missing credentials",
        suggestion: "Please provide both username and password"
      });
    }

    // Verify DB connection before authenticating
    db.execute(sql`SELECT 1 as db_check`)
      .then(() => {
        console.log(`[${env}] Database connection verified before login attempt`);

        try {
          // Import passport from auth.ts
          const { passport } = require("./auth");

          passport.authenticate("local", (err: any, user: Express.User | false, info: any) => {
            if (err) {
              console.error(`[${env}] Login authentication error:`, {
                error: err.message,
                stack: err.stack,
                timestamp: new Date().toISOString()
              });

              // Enhanced error message to help with debugging
              let errorMessage = "Internal server error";
              let errorSuggestion = "Please try again later. If the problem persists, contact support.";

              // Provide more specific error messages based on error type
              if (err.message && (
                  err.message.includes('Database connection failed') ||
                  err.message.includes('database') ||
                  err.message.includes('pool') ||
                  err.message.includes('connection')
                )) {
                errorMessage = "Database connection error";
                errorSuggestion = "Please try again later. If the problem persists, contact support.";
              } else if (err.message && (
                  err.message.includes('Password verification failed') ||
                  err.message.includes('password')
                )) {
                errorMessage = "Password verification error";
                errorSuggestion = "There might be an issue with the password format.";
              } else if (err.message && err.message.includes('Both supplied and stored passwords are required')) {
                errorMessage = "Authentication error";
                errorSuggestion = "Please try again with valid credentials.";
              }

              return res.status(500).json({
                message: errorMessage,
                suggestion: errorSuggestion,
                debug: process.env.NODE_ENV !== 'production' ? err.message : undefined
              });
            }

            if (!user) {
              console.log('Login failed:', {
                reason: info.message,
                username: req.body.username
              });
              return res.status(400).json({
                message: info.message || "Invalid credentials",
                suggestion: info.message?.includes("password")
                  ? "Please check your password and try again"
                  : "Please check your username and try again"
              });
            }

            req.logIn(user, (err) => {
              if (err) {
                console.error('Login session error:', {
                  error: err.message,
                  stack: err.stack,
                  userId: user.id
                });
                return res.status(500).json({
                  message: "Failed to create session",
                  suggestion: "Please try again. If the problem persists, clear your browser cookies."
                });
              }

              console.log('Login successful:', {
                userId: user.id,
                username: user.username,
                role: user.role.name
              });

              return res.json({
                message: "Login successful",
                user: {
                  id: user.id,
                  username: user.username,
                  role: user.role
                }
              });
            });
          })(req, res, next);
        } catch (error) {
          console.error(`[${env}] Error during authentication:`, {
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
          });

          return res.status(500).json({
            message: "Authentication error",
            suggestion: "Please try again later. If the problem persists, contact support."
          });
        }
      });
  });

  app.post("/api/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({
          message: "Error during logout",
          suggestion: "Please try again"
        });
      }
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json({
            message: "Error clearing session",
            suggestion: "Please try again"
          });
        }
        res.json({ message: "Logout successful" });
      });
    });
  });

  app.get("/api/user", (req, res) => {
    console.log('User info request:', {
      isAuthenticated: req.isAuthenticated(),
      user: req.user
    });

    if (req.isAuthenticated()) {
      const { id, username, role } = req.user;
      return res.json({ id, username, role });
    }
    res.status(401).json({
      message: "Not logged in",
      suggestion: "Please log in to access this resource"
    });
  });

  // Now apply the auth middleware to protect other API routes
  app.use('/api', requireAuth);

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

  app.get("/api/customer-profiles", requireAuth, async (req, res) => {
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

  app.post("/api/customer-profiles", requireAuth, async (req, res) => {
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

  app.put("/api/customer-profiles/:id", requireAuth, async (req, res) => {
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

  app.delete("/api/customer-profiles/:id", requireAuth, async (req, res) => {
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


  app.get("/api/role-types", async (req, res) => {
    try {
      const roleTypes = await db.query.roleTypes.findMany();
      res.json(roleTypes);
    } catch (error) {
      console.error('Error fetching role types:', error);
      res.status(500).send("Failed to fetch role types");
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
          roleTypeId: roles.roleTypeId,
          createdAt: roles.createdAt,
          updatedAt: roles.updatedAt,
          roleType: {
            id: roleTypes.id,
            description: roleTypes.description,
          },
        })
        .from(roles)
        .leftJoin(roleTypes, eq(roles.roleTypeId, roleTypes.id))
        .orderBy(roles.name);

      res.json(allRoles);
    } catch (error) {
      console.error('Error fetching roles:', error);
      res.status(500).send("Failed to fetch roles");
    }
  });

  app.post("/api/roles", requireRole(['admin']), async (req, res) => {
    try {
      const { name, description, roleTypeId } = req.body;

      if (!name || !roleTypeId) {
        return res.status(400).send("Role name and role type are required");
      }

      // Check if role exists
      const existingRole = await db.query.roles.findFirst({
        where: eq(roles.name, name),
      });

      if (existingRole) {
        return res.status(400).send("Role name already exists");
      }

      // Check if role type exists
      const roleType = await db.query.roleTypes.findFirst({
        where: eq(roleTypes.id, roleTypeId),
      });

      if (!roleType) {
        return res.status(400).send("Invalid role type");
      }

      const [newRole] = await db
        .insert(roles)
        .values({
          name,
          description,
          roleTypeId,
        })
        .returning();

      // Fetch the complete role with role type
      const roleWithType = await db.query.roles.findFirst({
        where: eq(roles.id, newRole.id),
        with: {
          roleType: true,
        },
      });

      res.json({
        message: "Role created successfully",
        role: roleWithType,
      });
    } catch (error) {
      console.error('Error creating role:', error);
      res.status(500).send("Failed to create role");
    }
  });

  app.put("/api/roles/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, roleTypeId } = req.body;

      if (!name || !roleTypeId) {
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
      const roleType = await db.query.roleTypes.findFirst({
        where: eq(roleTypes.id, roleTypeId),
      });

      if (!roleType) {
        return res.status(400).send("Invalid role type");
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
          roleTypeId,
          updatedAt: new Date(),
        })
        .where(eq(roles.id, parseInt(id)))
        .returning();

      // Fetch the complete role with role type
      const roleWithType = await db.query.roles.findFirst({
        where: eq(roles.id, updatedRole.id),
        with: {
          roleType: true,
        },
      });

      res.json({
        message: "Role updated successfully",
        role: roleWithType,
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
          roleType: true,
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

  app.delete("/api/categories/:id", requireRole(['admin']), async (req, res) => {
    try {
      const{ id } = req.params;

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
          roleType: true,
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
      const allUsers = await db.query.users.findMany({
        with: {
          role: {
            with: {
              roleType: true,
            }
          },
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

  app.put("/api/users/:id", requireRole(['admin']), async (req, res) => {
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
        }      }

      // Update user
      const [updatedUser] = await db
        .update(users)
        .set({
          ...(username && { username }),          ...(roleId && { roleId }),
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

  app.get("/api/store-assignments/users", requireRole(['admin']), async (req, res) => {
    try {
      // Get unassigned users with Pet Store role type using proper joins
      const unassignedPetStoreUsers = await db
        .select({
          id: users.id,
          username: users.username,
          role: {
            id: roles.id,
            name: roles.name,
            roleType: {
              id: roleTypes.id,
              description: roleTypes.description
            }
          }
        })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .innerJoin(roleTypes, eq(roles.roleTypeId, roleTypes.id))
        .leftJoin(
          userStoreAssignments,
          eq(users.id, userStoreAssignments.userId)
        )
        .where(
          and(
            eq(roleTypes.description, 'Pet Store'),
            sql`${userStoreAssignments.id} IS NULL`
          )
        );

      res.json(unassignedPetStoreUsers);
    } catch (error) {
      console.error('Error fetching unassigned pet store users:', error);
      res.status(500).json({
        message: "Failed to fetch pet store users",
        suggestion: "Please try again later"
      });
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
              roleType: true
            }
          }
        }
      });

      if (!user) {
        return res.status(404).send("User not found");
      }

      if (user.role?.roleType?.description !== 'Pet Store') {
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
  app.get("/api/stats", requireRole(['admin']), async (req, res) => {
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

  //// Orders trend for chart - admin only
  app.get("/api/stats/orders-trend", requireRole(['admin']), async (req, res) => {
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

      console.log(`Fetching inventory for user ${user.username} with role type ${user.role?.roleType?.description}`);

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
          orderCount: sql<number>`count(distinct ${orders.id})`,
          // Total revenue
          revenue: sql<number>`coalesce(sum(${orders.total}), 0)`,
          // Average order value
          averageOrderValue: sql<number>`coalesce(avg(${orders.total}), 0)`,
          // Order fulfillment rate (completed orders / total orders)
          fulfillmentRate: sql<number>`
            case 
              when count(${orders.id}) > 0 
              then sum(case when ${orders.status} = 'completed' then 1 else 0 end)::float / count(${orders.id}) 
              else 0 
            end
          `,
          // Inventory turnover (items sold / average inventory)
          inventoryTurnover: sql<number>`
            coalesce(
              sum(${orderItems.quantity})::float / nullif(avg(${inventory.quantity}), 0),
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
              when ${inventory.quantity} <= ${products.minStock}               then ${inventory.productId} 
              else null 
            end)`
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
  app.get("/api/brands", requireAuth, async (req, res) => {
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

  app.post("/api/brands", requireRole(['admin']), async (req, res) => {
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

  app.put("/api/brands/:id", requireRole(['admin']), async (req, res) => {
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

  app.delete("/api/brands/:id", requireRole(['admin']), async (req, res) => {
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
  app.get("/api/suppliers", requireRole(['admin']), async (req, res) => {
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

  app.post("/api/suppliers", requireRole(['admin']), async (req, res) => {
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

  app.put("/api/suppliers/:id", requireRole(['admin']), async (req, res) => {
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

  app.delete("/api/suppliers/:id", requireRole(['admin']), async (req, res) => {
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

  const httpServer = createServer(app);
  return httpServer;
}