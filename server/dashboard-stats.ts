import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@db";
import { inventory, orders, products } from "@db/schema";
import type { AccessScope } from "./scoping";
import { scopeStoreFilter } from "./scoping";
import {
  VIETNAM_UTC_OFFSET_MINUTES,
  endOfVietnamDay,
  shiftDay,
  startOfVietnamDay,
  vietnamDayOf,
} from "../shared/vietnam-day";

/**
 * The dashboard aggregates.
 *
 * AI Agent Note - this lives outside server/routes.ts so it can be tested without an HTTP session,
 * the same way server/finance.ts and server/invoices.ts are. The shape returned here is the
 * contract the dashboard tiles read (`last30Days.orders`, `last30Days.revenue`, `growth`,
 * `totalProducts`, `lowStock`); renaming a field silently blanks a tile.
 *
 * Both windows are Vietnamese calendar days (shared/vietnam-day.ts), so "the last 30 days" on
 * the dashboard matches the finance report and the printed cash book. A rolling window ending
 * "now" would shift by a day every time the owner opened the screen late in the evening.
 */
export interface DashboardStats {
  last30Days: { orders: number; revenue: number; from: string; to: string };
  previous30Days: { orders: number; revenue: number };
  /** Percentage change in revenue vs the previous 30 days; `null` when there is no history. */
  growth: number | null;
  totalProducts: number;
  lowStock: { id: number; name: string; sku: string; quantity: number; minStock: number }[];
}

/** One point on the dashboard's "Order Trends" chart: a Vietnamese day and the orders taken. */
export interface OrderTrendPoint {
  /** `YYYY-MM-DD`, a Vietnamese calendar day - the same day the tiles and the finance report use. */
  date: string;
  orders: number;
}

/**
 * Orders per Vietnamese day for the last `days` days, oldest first.
 *
 * AI Agent Note - this used to bucket by `date_trunc('day', created_at)`, which is the *UTC*
 * day, so the chart disagreed with the tiles above it and with the cash book; it also ordered
 * ascending and then `limit(30)`, which returns the **oldest** 30 days of trading - after a
 * month the chart froze on the shop's opening month. Both are fixed here so the chart cannot
 * drift again without failing a test.
 */
export async function getOrderTrend(
  scope: AccessScope,
  now: Date = new Date(),
  days: number = 30
): Promise<OrderTrendPoint[]> {
  const today = vietnamDayOf(now) || now.toISOString().slice(0, 10);

  // The stored column is a naive `timestamp` holding UTC wall-clock, so adding the offset in
  // SQL gives the Vietnamese wall-clock day - the offset comes from shared/vietnam-day.ts.
  const offsetMinutes = sql.raw(String(VIETNAM_UTC_OFFSET_MINUTES));
  const day = sql<string>`to_char(${orders.createdAt} + make_interval(mins => ${offsetMinutes}), 'YYYY-MM-DD')`;

  const rows = await db
    .select({ date: day, orders: sql<number>`count(*)` })
    .from(orders)
    .where(
      and(
        gte(orders.createdAt, startOfVietnamDay(shiftDay(today, -(days - 1)))),
        lt(orders.createdAt, endOfVietnamDay(today)),
        scopeStoreFilter(scope, orders.storeId)
      )
    )
    .groupBy(day)
    .orderBy(day);

  return rows.map((row) => ({ date: row.date, orders: Number(row.orders ?? 0) }));
}

/** Shared with the report's revenue growth tile: 12.34% -> 12.3, and `null` when undefined. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function getDashboardStats(
  scope: AccessScope,
  now: Date = new Date()
): Promise<DashboardStats> {
  const today = vietnamDayOf(now) || now.toISOString().slice(0, 10);

  const currentFrom = startOfVietnamDay(shiftDay(today, -29));
  const currentTo = endOfVietnamDay(today);
  const previousFrom = startOfVietnamDay(shiftDay(today, -59));
  // Half-open: the previous window stops exactly where the current one starts, so an order on the
  // boundary is counted once and nothing falls into both windows.
  const previousTo = currentFrom;

  const totalsBetween = (from: Date, to: Date) =>
    db
      .select({
        orders: sql<number>`count(*)`,
        revenue: sql<number>`COALESCE(sum(${orders.total}), 0)`,
      })
      .from(orders)
      .where(and(gte(orders.createdAt, from), lt(orders.createdAt, to), scopeStoreFilter(scope, orders.storeId)));

  const [currentRows, previousRows, productRows, lowStockRows] = await Promise.all([
    totalsBetween(currentFrom, currentTo),
    totalsBetween(previousFrom, previousTo),
    db.select({ count: sql<number>`count(*)` }).from(products),
    db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        // Stock is summed across the stores this user may see: a product that is short in every
        // branch is one alert, not one per inventory row.
        quantity: sql<number>`COALESCE(sum(${inventory.quantity}), 0)`,
        minStock: products.minStock,
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .where(scopeStoreFilter(scope, inventory.storeId))
      .groupBy(products.id, products.name, products.sku, products.minStock)
      .having(sql`COALESCE(sum(${inventory.quantity}), 0) <= ${products.minStock}`)
      .orderBy(sql`COALESCE(sum(${inventory.quantity}), 0)`)
      .limit(5),
  ]);

  const revenue = Number(currentRows[0]?.revenue ?? 0);
  const previousRevenue = Number(previousRows[0]?.revenue ?? 0);

  return {
    last30Days: {
      orders: Number(currentRows[0]?.orders ?? 0),
      revenue,
      from: shiftDay(today, -29),
      to: today,
    },
    previous30Days: {
      orders: Number(previousRows[0]?.orders ?? 0),
      revenue: previousRevenue,
    },
    growth: percentChange(revenue, previousRevenue),
    totalProducts: Number(productRows[0]?.count ?? 0),
    lowStock: lowStockRows.map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      quantity: Number(row.quantity ?? 0),
      minStock: row.minStock,
    })),
  };
}
