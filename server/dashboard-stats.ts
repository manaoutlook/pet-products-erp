import { and, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@db";
import { inventory, invoices, products, salesOrders, salesTransactions } from "@db/schema";
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
 *
 * AI Agent Note - WHICH sales tables this reads:
 *
 * This used to sum the legacy `orders` table. Nothing in the application writes to it any more
 * (the till writes `sales_transactions`, the Sales Orders screen writes `sales_orders`), so the
 * home screen showed "Orders 0 / Revenue 0" on a shop that had sold all week - a false zero that
 * looks exactly like a quiet month. A sales document on this dashboard is therefore one of:
 *
 *   - a POS sale    - `sales_transactions` with status `completed` (refunds/voids are excluded);
 *   - a sales order - `sales_orders` with any status except `cancelled`.
 *
 * `revenue` is the VAT-inclusive `total_amount` of those documents, the figure printed on the
 * customer's paperwork. It deliberately does NOT read `invoices`: an order that has not been
 * invoiced yet is still trading, and counting invoices would under-report the month.
 */
export interface DashboardStats {
  /** Sales documents (POS sales + sales orders) taken in the window. */
  last30Days: { orders: number; revenue: number; from: string; to: string };
  previous30Days: { orders: number; revenue: number };
  /** Percentage change in revenue vs the previous 30 days; `null` when there is no history. */
  growth: number | null;
  totalProducts: number;
  lowStock: { id: number; name: string; sku: string; quantity: number; minStock: number }[];
  /** Today so far - what the owner opens the screen to check first. */
  today: { orders: number; revenue: number };
  /** Money customers still owe: invoice balances that are not settled yet. */
  receivables: { outstanding: number; unpaidInvoices: number; overdueInvoices: number };
}

/**
 * One point on the dashboard's sales chart: a Vietnamese day, the sales documents taken that day
 * and what they were worth. Every day in the window is present, including days with no trade -
 * the chart draws a line across the whole period instead of collapsing to an empty grid.
 */
export interface OrderTrendPoint {
  /** `YYYY-MM-DD`, a Vietnamese calendar day - the same day the tiles and the finance report use. */
  date: string;
  /** POS sales + sales orders for that day. */
  orders: number;
  revenue: number;
  /** The two channels, so the chart can show where the day's money came from. */
  posSales: number;
  salesOrders: number;
}

/** A sales document's day, as `YYYY-MM-DD` on the Vietnamese calendar. */
function vietnamDaySql(column: any) {
  const offsetMinutes = sql.raw(String(VIETNAM_UTC_OFFSET_MINUTES));
  return sql<string>`to_char(${column} + make_interval(mins => ${offsetMinutes}), 'YYYY-MM-DD')`;
}

/** POS sales that count as revenue: a completed sale, never a refund or a void. */
const completedPosSale = eq(salesTransactions.status, "completed");
/** A cancelled sales order was never a sale; every other status is trading. */
const liveSalesOrder = ne(salesOrders.status, "cancelled");
/**
 * Sales documents per Vietnamese day for the last `days` days, oldest first, zero-filled.
 *
 * AI Agent Note - this used to bucket by `date_trunc('day', created_at)` on the legacy `orders`
 * table (the *UTC* day, and a table nothing writes to), and to return only the days that had
 * rows. The tiles and the chart therefore disagreed, and a month without sales drew an empty
 * grid that read as "broken". Both are fixed here so the chart cannot drift again unnoticed.
 */
export async function getOrderTrend(
  scope: AccessScope,
  now: Date = new Date(),
  days: number = 30
): Promise<OrderTrendPoint[]> {
  const today = vietnamDayOf(now) || now.toISOString().slice(0, 10);
  const fromDay = shiftDay(today, -(days - 1));
  const from = startOfVietnamDay(fromDay);
  const to = endOfVietnamDay(today);

  const posDay = vietnamDaySql(salesTransactions.transactionDate);
  const orderDay = vietnamDaySql(salesOrders.orderDate);

  const [posRows, orderRows] = await Promise.all([
    db
      .select({
        date: posDay,
        orders: sql<number>`count(*)`,
        revenue: sql<number>`COALESCE(sum(${salesTransactions.totalAmount}), 0)`,
      })
      .from(salesTransactions)
      .where(
        and(
          gte(salesTransactions.transactionDate, from),
          lt(salesTransactions.transactionDate, to),
          completedPosSale,
          scopeStoreFilter(scope, salesTransactions.storeId)
        )
      )
      .groupBy(posDay),
    db
      .select({
        date: orderDay,
        orders: sql<number>`count(*)`,
        revenue: sql<number>`COALESCE(sum(${salesOrders.totalAmount}), 0)`,
      })
      .from(salesOrders)
      .where(
        and(
          gte(salesOrders.orderDate, from),
          lt(salesOrders.orderDate, to),
          liveSalesOrder,
          scopeStoreFilter(scope, salesOrders.storeId)
        )
      )
      .groupBy(orderDay),
  ]);

  // Every day in the window exists, so the chart's x-axis is the calendar, not the trading days.
  const points = new Map<string, OrderTrendPoint>();
  for (let offset = 0; offset < days; offset += 1) {
    const date = shiftDay(fromDay, offset);
    points.set(date, { date, orders: 0, revenue: 0, posSales: 0, salesOrders: 0 });
  }

  for (const row of posRows) {
    const point = points.get(row.date);
    if (!point) continue;
    point.posSales += Number(row.orders ?? 0);
    point.orders += Number(row.orders ?? 0);
    point.revenue += Number(row.revenue ?? 0);
  }
  for (const row of orderRows) {
    const point = points.get(row.date);
    if (!point) continue;
    point.salesOrders += Number(row.orders ?? 0);
    point.orders += Number(row.orders ?? 0);
    point.revenue += Number(row.revenue ?? 0);
  }

  return Array.from(points.values());
}

/** Shared with the report's revenue growth tile: 12.34% -> 12.3, and `null` when undefined. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Sales documents + VAT-inclusive revenue for a half-open window `[from, to)`. */
async function salesTotalsBetween(scope: AccessScope, from: Date, to: Date) {
  const [posRows, orderRows] = await Promise.all([
    db
      .select({
        orders: sql<number>`count(*)`,
        revenue: sql<number>`COALESCE(sum(${salesTransactions.totalAmount}), 0)`,
      })
      .from(salesTransactions)
      .where(
        and(
          gte(salesTransactions.transactionDate, from),
          lt(salesTransactions.transactionDate, to),
          completedPosSale,
          scopeStoreFilter(scope, salesTransactions.storeId)
        )
      ),
    db
      .select({
        orders: sql<number>`count(*)`,
        revenue: sql<number>`COALESCE(sum(${salesOrders.totalAmount}), 0)`,
      })
      .from(salesOrders)
      .where(
        and(
          gte(salesOrders.orderDate, from),
          lt(salesOrders.orderDate, to),
          liveSalesOrder,
          scopeStoreFilter(scope, salesOrders.storeId)
        )
      ),
  ]);

  return {
    orders: Number(posRows[0]?.orders ?? 0) + Number(orderRows[0]?.orders ?? 0),
    revenue: Number(posRows[0]?.revenue ?? 0) + Number(orderRows[0]?.revenue ?? 0),
  };
}

export async function getDashboardStats(
  scope: AccessScope,
  now: Date = new Date()
): Promise<DashboardStats> {
  const today = vietnamDayOf(now) || now.toISOString().slice(0, 10);

  const currentFrom = startOfVietnamDay(shiftDay(today, -29));
  const currentTo = endOfVietnamDay(today);
  const previousFrom = startOfVietnamDay(shiftDay(today, -59));
  // Half-open: the previous window stops exactly where the current one starts, so a document on
  // the boundary is counted once and nothing falls into both windows.
  const previousTo = currentFrom;
  const todayFrom = startOfVietnamDay(today);

  const [current, previous, todayTotals, productRows, lowStockRows, receivableRows] =
    await Promise.all([
      salesTotalsBetween(scope, currentFrom, currentTo),
      salesTotalsBetween(scope, previousFrom, previousTo),
      salesTotalsBetween(scope, todayFrom, currentTo),
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
      // Balances are summed in JS rather than SQL: `due_date` is a `date` and comparing it to a
      // Vietnamese day string in SQL invites a silent string/date cast that differs per driver.
      db
        .select({
          balanceDue: invoices.balanceDue,
          dueDate: invoices.dueDate,
        })
        .from(invoices)
        .where(
          and(
            inArray(invoices.status, ["issued", "partially_paid"]),
            sql`${invoices.balanceDue} > 0`,
            scopeStoreFilter(scope, invoices.storeId)
          )
        ),
    ]);

  const receivables = receivableRows.reduce(
    (totals, row) => {
      totals.outstanding += Number(row.balanceDue ?? 0);
      totals.unpaidInvoices += 1;
      // `due_date` NULL means "no credit term", which is due on issue rather than overdue.
      if (row.dueDate && row.dueDate < today) totals.overdueInvoices += 1;
      return totals;
    },
    { outstanding: 0, unpaidInvoices: 0, overdueInvoices: 0 }
  );

  return {
    last30Days: {
      orders: current.orders,
      revenue: current.revenue,
      from: shiftDay(today, -29),
      to: today,
    },
    previous30Days: {
      orders: previous.orders,
      revenue: previous.revenue,
    },
    growth: percentChange(current.revenue, previous.revenue),
    totalProducts: Number(productRows[0]?.count ?? 0),
    lowStock: lowStockRows.map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      quantity: Number(row.quantity ?? 0),
      minStock: row.minStock,
    })),
    today: { orders: todayTotals.orders, revenue: todayTotals.revenue },
    receivables,
  };
}
