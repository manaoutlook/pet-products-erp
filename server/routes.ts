import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { products, inventory, orders, orderItems, users, roles, insertUserSchema } from "@db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireRole, requireAuth } from "./middleware";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

// Password hashing utility
const crypto = {
  hash: async (password: string) => {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
  },
};

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  // Roles endpoint - admin only
  app.get("/api/roles", requireRole(['admin']), async (req, res) => {
    const allRoles = await db.query.roles.findMany();
    res.json(allRoles);
  });

  // User management endpoints - admin only
  app.get("/api/users", requireRole(['admin']), async (req, res) => {
    try {
      const allUsers = await db.query.users.findMany({
        with: {
          role: true,
        },
      });

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
          .send("Invalid input: " + result.error.issues.map(i => i.message).join(", "));
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
      const { username, roleId } = req.body;

      if (!username && !roleId) {
        return res.status(400).send("No updates provided");
      }

      // Check if username is taken
      if (username) {
        const existingUser = await db.query.users.findFirst({
          where: and(
            eq(users.username, username),
            sql`id != ${id}`
          ),
        });

        if (existingUser) {
          return res.status(400).send("Username already exists");
        }
      }

      const [updatedUser] = await db
        .update(users)
        .set({
          ...(username && { username }),
          ...(roleId && { roleId }),
        })
        .where(eq(users.id, parseInt(id)))
        .returning();

      // Fetch the complete user with role
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
      res.status(500).send("Failed to update user");
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

  const httpServer = createServer(app);
  return httpServer;
}