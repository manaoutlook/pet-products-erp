import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { products, inventory, orders, orderItems } from "@db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  // Stats API
  app.get("/api/stats", async (req, res) => {
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

    // Calculate growth (simplified)
    const growth = 5.2; // In a real app, calculate this

    res.json({
      totalOrders: orderStats.totalOrders || 0,
      revenue: orderStats.revenue || 0,
      totalProducts,
      lowStock,
      growth,
    });
  });

  // Orders trend for chart
  app.get("/api/stats/orders-trend", async (req, res) => {
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

  // Products API
  app.get("/api/products", async (req, res) => {
    const allProducts = await db.query.products.findMany({
      with: {
        inventory: true,
      },
      orderBy: [desc(products.updatedAt)],
    });
    res.json(allProducts);
  });

  // Orders API
  app.get("/api/orders", async (req, res) => {
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
