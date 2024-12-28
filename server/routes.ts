import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { products, inventory, orders, orderItems, users } from "@db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireRole, requireAuth } from "./middleware";

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  // Protected route - only for admins
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