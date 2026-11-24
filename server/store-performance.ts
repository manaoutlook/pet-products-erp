import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { db } from "@db";
import { inventory, products, salesOrders, salesTransactions, stores } from "@db/schema";
import type { AccessScope } from "./scoping";
import { scopeStoreFilter } from "./scoping";
import { endOfVietnamDay, startOfVietnamDay, vietnamDayOf } from "../shared/vietnam-day";

/**
 * The Store Performance screen.
 *
 * AI Agent Note - this used to be an inline query in server/routes.ts that joined `orders` and
 * `order_items`. Nothing writes to those tables any more, so every store reported 0 orders and 0
 * revenue - the same false zero the home dashboard showed. It now reads the two tables the
 * application actually fills: completed till sales and sales orders that were not cancelled.
 *
 * It also returns the field names the page renders (`revenue`, `averageOrderValue`,
 * `fulfillmentRate`). The old endpoint returned `totalSales`/`inventoryCount`, which the page
 * never read, so its revenue chart had nothing to draw even once the numbers existed.
 */
export interface StoreMetrics {
  storeId: number;
  storeName: string;
  /** Sales documents in the current month (till sales + sales orders). */
  orderCount: number;
  revenue: number;
  averageOrderValue: number;
  /** 0..1 - the share of documents already fulfilled. POS sales are fulfilled at the till. */
  fulfillmentRate: number;
}

export interface StoreMonth {
  storeId: number;
  /** `YYYY-MM-01`, the Vietnamese calendar month. */
  month: string;
  revenue: number;
  orderCount: number;
}

export interface StoreInventoryStatus {
  storeId: number;
  totalItems: number;
  lowStockItems: number;
}

export interface StorePerformance {
  currentMetrics: StoreMetrics[];
  historicalData: StoreMonth[];
  inventoryStatus: StoreInventoryStatus[];
}

/** `2026-05` + (-5) -> `2025-12`, without relying on Date's month rollover around DST. */
function shiftMonth(monthKey: string, offset: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const index = year * 12 + (month - 1) + offset;
  const shiftedYear = Math.floor(index / 12);
  const shiftedMonth = (index % 12) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, "0")}`;
}

export async function getStorePerformance(
  scope: AccessScope,
  now: Date = new Date()
): Promise<StorePerformance> {
  const today = vietnamDayOf(now) || now.toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const firstMonth = shiftMonth(currentMonth, -5);

  const since = startOfVietnamDay(`${firstMonth}-01`);
  const until = endOfVietnamDay(today);

  const storeRows = await db
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .where(scopeStoreFilter(scope, stores.id))
    .orderBy(stores.name);

  const [posRows, orderRows, inventoryRows] = await Promise.all([
    db
      .select({
        storeId: salesTransactions.storeId,
        at: salesTransactions.transactionDate,
        amount: salesTransactions.totalAmount,
      })
      .from(salesTransactions)
      .where(
        and(
          eq(salesTransactions.status, "completed"),
          gte(salesTransactions.transactionDate, since),
          lt(salesTransactions.transactionDate, until),
          scopeStoreFilter(scope, salesTransactions.storeId)
        )
      ),
    db
      .select({
        storeId: salesOrders.storeId,
        at: salesOrders.orderDate,
        amount: salesOrders.totalAmount,
        status: salesOrders.status,
      })
      .from(salesOrders)
      .where(
        and(
          ne(salesOrders.status, "cancelled"),
          gte(salesOrders.orderDate, since),
          lt(salesOrders.orderDate, until),
          scopeStoreFilter(scope, salesOrders.storeId)
        )
      ),
    db
      .select({
        storeId: inventory.storeId,
        totalItems: sql<number>`count(distinct ${inventory.productId})`,
        lowStockItems: sql<number>`
          count(distinct case
            when ${inventory.quantity} <= ${products.minStock} then ${inventory.productId}
            else null
          end)
        `,
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .where(scopeStoreFilter(scope, inventory.storeId))
      .groupBy(inventory.storeId),
  ]);

  type Bucket = {
    revenue: number;
    documents: number;
    fulfilled: number;
    months: Map<string, { revenue: number; documents: number }>;
  };

  // A sale with no store is a Distribution Centre sale; it has no branch to report against.
  const buckets = new Map<number, Bucket>();
  for (const store of storeRows) {
    buckets.set(store.id, { revenue: 0, documents: 0, fulfilled: 0, months: new Map() });
  }

  const record = (storeId: number | null, at: Date | null, amount: unknown, fulfilled: boolean) => {
    if (storeId == null || !at) return;
    const bucket = buckets.get(storeId);
    if (!bucket) return;

    const month = vietnamDayOf(at).slice(0, 7);
    const monthRow = bucket.months.get(month) ?? { revenue: 0, documents: 0 };
    monthRow.revenue += Number(amount ?? 0);
    monthRow.documents += 1;
    bucket.months.set(month, monthRow);

    if (month === currentMonth) {
      bucket.revenue += Number(amount ?? 0);
      bucket.documents += 1;
      if (fulfilled) bucket.fulfilled += 1;
    }
  };

  for (const row of posRows) {
    // A completed till sale is fulfilled when it is rung up.
    record(row.storeId, row.at, row.amount, true);
  }
  for (const row of orderRows) {
    record(row.storeId, row.at, row.amount, row.status === "delivered");
  }

  const currentMetrics: StoreMetrics[] = storeRows.map((store) => {
    const bucket = buckets.get(store.id)!;
    return {
      storeId: store.id,
      storeName: store.name,
      orderCount: bucket.documents,
      revenue: bucket.revenue,
      averageOrderValue: bucket.documents > 0 ? Math.round(bucket.revenue / bucket.documents) : 0,
      fulfillmentRate: bucket.documents > 0 ? bucket.fulfilled / bucket.documents : 0,
    };
  });

  const historicalData: StoreMonth[] = [];
  for (const store of storeRows) {
    const bucket = buckets.get(store.id)!;
    for (let offset = 0; offset < 6; offset += 1) {
      const month = shiftMonth(firstMonth, offset);
      const row = bucket.months.get(month);
      historicalData.push({
        storeId: store.id,
        month: `${month}-01`,
        revenue: row?.revenue ?? 0,
        orderCount: row?.documents ?? 0,
      });
    }
  }

  return {
    currentMetrics,
    historicalData,
    inventoryStatus: inventoryRows.map((row) => ({
      storeId: row.storeId ?? 0,
      totalItems: Number(row.totalItems ?? 0),
      lowStockItems: Number(row.lowStockItems ?? 0),
    })),
  };
}
