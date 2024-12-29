import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { products, inventory, orders, orderItems, users, roles, roleTypes, stores, userStoreAssignments } from "@db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireRole, requireAuth } from "./middleware";
import { z } from "zod";

// Create proper Zod schema for user validation
const insertUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  roleId: z.number().positive("Role ID must be positive")
});

// Add update user schema for validation
const updateUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").optional(),
  roleId: z.number().positive("Role ID must be positive").optional(),
});

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
  // Set up authentication and create admin user if needed
  setupAuth(app);

  // Role Types endpoints - admin only
  app.get("/api/role-types", requireRole(['admin']), async (req, res) => {
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
      const allRoles = await db.query.roles.findMany({
        with: {
          roleType: true,
        },
      });
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

      const { username, roleId } = result.data;

      if (!username && !roleId) {
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
          user: {
            with: {
              role: {
                with: {
                  roleType: true
                }
              }
            }
          },
          store: true
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
            sql`created_at >= date_trunc('month', current_date)`,
            sql`created_at < date_trunc('month', current_date) + interval '1 month'`
          )
        );

      const [{ count: totalProducts }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(products);

      const lowStock = await db.query.products.findMany({
        with: {
          inventory: true,
        },
        where: sql`inventory.quantity <= products.min_stock`,
        limit: 5,
      });

      const growth = 5.2; // In a real app, calculate this

      res.json({
        totalOrders: orderStats.totalOrders || 0,
        revenue: orderStats.revenue || 0,
        totalProducts,
        lowStock,
        growth,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).send("Failed to fetch stats");
    }
  });

  // Orders trend for chart - admin only
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
          inventory: true,
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
      const { name, description, sku, price, category, minStock } = req.body;

      if (!name || !sku || !price || !category) {
        return res.status(400).send("Name, SKU, price, and category are required");
      }

      // Check if product with same SKU exists
      const [existingProduct] = await db
        .select()
        .from(products)
        .where(eq(products.sku, sku))
        .limit(1);

      if (existingProduct) {
        return res.status(400).send("Product with this SKU already exists");
      }

      const [newProduct] = await db
        .insert(products)
        .values({
          name,
          description,
          sku,
          price,
          category,
          minStock: minStock || 10,
        })
        .returning();

      res.json({
        message: "Product created successfully",
        product: newProduct,
      });
    } catch (error) {
      console.error('Error creating product:', error);
      res.status(500).send("Failed to create product");
    }
  });

  // Products API - Update product (admin only)
  app.put("/api/products/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, sku, price, category, minStock } = req.body;

      if (!name || !sku || !price || !category) {
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

      const [updatedProduct] = await db
        .update(products)
        .set({
          name,
          description,
          sku,
          price,
          category,
          minStock,
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
  app.get("/api/inventory", requireAuth, async (req, res) => {
    try {
      const allInventory = await db.query.inventory.findMany({
        with: {
          product: true,
          store: true,
        },
        orderBy: [desc(inventory.updatedAt)],
      });
      res.json(allInventory);
    } catch (error) {
      console.error('Error fetching inventory:', error);
      res.status(500).send("Failed to fetch inventory");
    }
  });

  app.post("/api/inventory", requireRole(['admin']), async (req, res) => {
    try {
      const { productId, storeId, quantity, location, inventoryType } = req.body;

      if (!productId || !quantity || !inventoryType) {
        return res.status(400).send("Product ID, quantity, and inventory type are required");
      }

      // Get product SKU for barcode generation
      const product = await db.query.products.findFirst({
        where: eq(products.id, productId),
      });

      if (!product) {
        return res.status(404).send("Product not found");
      }

      // Generate unique barcode
      const barcode = generateInventoryBarcode(inventoryType as 'DC' | 'STORE', product.sku, storeId);

      // Set centerId to DC001 if it's a Distribution Center item
      const centerId = inventoryType === 'DC' ? 'DC001' : null;

      const [newInventoryItem] = await db
        .insert(inventory)
        .values({
          productId,
          storeId: inventoryType === 'STORE' ? storeId : null,
          quantity,
          location,
          inventoryType,
          centerId,
          barcode,
        })
        .returning();

      // Fetch the complete inventory item with related data
      const inventoryWithDetails = await db.query.inventory.findFirst({
        where: eq(inventory.id, newInventoryItem.id),
        with: {
          product: true,
          store: true,
        },
      });

      res.json({
        message: "Inventory item created successfully",
        inventory: inventoryWithDetails,
      });
    } catch (error) {
      console.error('Error creating inventory item:', error);
      res.status(500).send("Failed to create inventory item");
    }
  });

  app.put("/api/inventory/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;
      const { productId, storeId, quantity, location, inventoryType } = req.body;

      if (!productId || !quantity || !inventoryType) {
        return res.status(400).send("Product ID, quantity, and inventory type are required");
      }

      // Set centerId based on inventoryType
      const centerId = inventoryType === 'DC' ? 'DC001' : null;

      const [updatedInventory] = await db
        .update(inventory)
        .set({
          productId,
          storeId: inventoryType === 'STORE' ? storeId : null,
          quantity,
          location,
          inventoryType,
          centerId,
          updatedAt: new Date(),
        })
        .where(eq(inventory.id, parseInt(id)))
        .returning();

      if (!updatedInventory) {
        return res.status(404).send("Inventory item not found");
      }

      // Fetch the complete inventory item with related data
      const inventoryWithDetails = await db.query.inventory.findFirst({
        where: eq(inventory.id, updatedInventory.id),
        with: {
          product: true,
          store: true,
        },
      });

      res.json({
        message: "Inventory item updated successfully",
        inventory: inventoryWithDetails,
      });
    } catch (error) {
      console.error('Error updating inventory item:', error);
      res.status(500).send("Failed to update inventory item");
    }
  });

  app.delete("/api/inventory/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id }= req.params;

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

  const httpServer = createServer(app);
  return httpServer;
}

const crypto = {
  hash: async (password: string) => {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
  },
};

import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
const scryptAsync = promisify(scrypt);