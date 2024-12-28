import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { products, inventory, orders, orderItems, users, insertUserSchema } from "@db/schema";
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

  // User management endpoints - admin only
  app.get("/api/users", requireRole(['admin']), async (req, res) => {
    const allUsers = await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
      })
      .from(users);
    res.json(allUsers);
  });

  app.post("/api/users", requireRole(['admin']), async (req, res) => {
    try {
      const result = insertUserSchema.safeParse(req.body);
      if (!result.success) {
        return res
          .status(400)
          .send("Invalid input: " + result.error.issues.map(i => i.message).join(", "));
      }

      const { username, password, role } = result.data;

      // Check if user exists
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (existingUser) {
        return res.status(400).send("Username already exists");
      }

      const hashedPassword = await crypto.hash(password);

      const [newUser] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
          role,
        })
        .returning();

      res.json({
        message: "User created successfully",
        user: { id: newUser.id, username: newUser.username, role: newUser.role },
      });
    } catch (error) {
      res.status(500).send("Failed to create user");
    }
  });

  app.put("/api/users/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;
      const { username, role } = req.body;

      if (!username && !role) {
        return res.status(400).send("No updates provided");
      }

      // Check if username is taken
      if (username) {
        const [existingUser] = await db
          .select()
          .from(users)
          .where(and(
            eq(users.username, username),
            sql`id != ${id}`
          ))
          .limit(1);

        if (existingUser) {
          return res.status(400).send("Username already exists");
        }
      }

      const [updatedUser] = await db
        .update(users)
        .set({
          ...(username && { username }),
          ...(role && { role }),
        })
        .where(eq(users.id, parseInt(id)))
        .returning();

      res.json({
        message: "User updated successfully",
        user: { 
          id: updatedUser.id, 
          username: updatedUser.username, 
          role: updatedUser.role 
        },
      });
    } catch (error) {
      res.status(500).send("Failed to update user");
    }
  });

  app.delete("/api/users/:id", requireRole(['admin']), async (req, res) => {
    try {
      const { id } = req.params;

      // Prevent deleting the last admin
      const [{ count: adminCount }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(eq(users.role, 'admin'));

      if (adminCount <= 1) {
        const [userToDelete] = await db
          .select()
          .from(users)
          .where(eq(users.id, parseInt(id)))
          .limit(1);

        if (userToDelete?.role === 'admin') {
          return res.status(400).send("Cannot delete the last admin user");
        }
      }

      await db
        .delete(users)
        .where(eq(users.id, parseInt(id)));

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      res.status(500).send("Failed to delete user");
    }
  });

  // Stats API - admin only
  app.get("/api/stats", requireRole(['admin']), async (req, res) => {
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

    const lowStock = await db
      .select({
        id: products.id,
        name: products.name,
        quantity: inventory.quantity,
        minStock: products.minStock,
      })
      .from(products)
      .innerJoin(inventory, eq(products.id, inventory.productId))
      .where(sql`${inventory.quantity} <= ${products.minStock}`)
      .limit(5);

    const growth = 5.2; // In a real app, calculate this

    res.json({
      totalOrders: orderStats.totalOrders || 0,
      revenue: orderStats.revenue || 0,
      totalProducts,
      lowStock,
      growth,
    });
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
    const allProducts = await db.query.products.findMany({
      with: {
        inventory: true,
      },
      orderBy: [desc(products.updatedAt)],
    });
    res.json(allProducts);
  });

  // Orders API - admin only
  app.get("/api/orders", requireRole(['admin']), async (req, res) => {
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
  });

  const httpServer = createServer(app);
  return httpServer;
}