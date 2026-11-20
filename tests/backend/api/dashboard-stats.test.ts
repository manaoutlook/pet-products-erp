import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../db';
import { inventory, orders, products } from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData } from '../../helpers/test-db';
import { getDashboardStats, percentChange } from '../../../server/dashboard-stats';
import type { AccessScope } from '../../../server/scoping';

/**
 * The dashboard aggregates.
 *
 * These pin the two things the owner actually reads off the home screen: "how much did we take in
 * the last 30 days" and "what is running out". Both are Vietnamese-calendar-day questions, so the
 * boundary cases below are deliberately timestamps that fall on a *different* UTC day.
 */
describe('dashboard stats', () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  const globalScope: AccessScope = { kind: 'global' };

  /** An instant on a given Vietnamese day - a safe anchor for "an order was taken that day". */
  const vietnamInstant = (day: string, time = '12:00:00') =>
    new Date(`${day}T${time}.000+07:00`);

  async function insertOrder(storeId: number | null, total: string, createdAt: Date) {
    await db.insert(orders).values({
      customerName: 'Khách lẻ',
      customerEmail: 'khach@example.com',
      storeId,
      total,
      status: 'completed',
      createdAt,
    });
  }

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    data = await seedTestData();
  });


  it('splits the last 30 days from the 30 before them on the Vietnamese calendar', async () => {
    const now = vietnamInstant('2026-05-01', '10:00:00');
    // 06:30 on 1 May in Vietnam is still 30 April in UTC - the one-day drift this window prevents.
    await insertOrder(data.stores.store1.id, '110000.00', vietnamInstant('2026-05-01', '06:30:00'));
    // The first day of the current window (1 May minus 29 days).
    await insertOrder(data.stores.store1.id, '50000.00', vietnamInstant('2026-04-02', '08:00:00'));
    // The last instant of the previous window.
    await insertOrder(data.stores.store1.id, '70000.00', vietnamInstant('2026-04-01', '23:30:00'));
    // Before both windows.
    await insertOrder(data.stores.store1.id, '999000.00', vietnamInstant('2026-03-02', '12:00:00'));

    const stats = await getDashboardStats(globalScope, now);

    expect(stats.last30Days.from).toBe('2026-04-02');
    expect(stats.last30Days.to).toBe('2026-05-01');
    expect(stats.last30Days.orders).toBe(2);
    expect(stats.last30Days.revenue).toBe(160000);
    expect(stats.previous30Days.orders).toBe(1);
    expect(stats.previous30Days.revenue).toBe(70000);
    // 160,000 against 70,000.
    expect(stats.growth).toBe(128.6);
  });

  it('reports no growth at all when there is no earlier trading to compare against', async () => {
    const now = vietnamInstant('2026-05-01');
    await insertOrder(data.stores.store1.id, '40000.00', vietnamInstant('2026-04-20'));

    const stats = await getDashboardStats(globalScope, now);

    expect(stats.last30Days.revenue).toBe(40000);
    expect(stats.previous30Days.revenue).toBe(0);
    // Not 100% and not 0%: there is nothing to compare with, and the tile must say so.
    expect(stats.growth).toBeNull();
  });

  it('counts only the stores the user may see', async () => {
    await insertOrder(data.stores.store1.id, '30000.00', vietnamInstant('2026-04-20'));
    await insertOrder(data.stores.warehouse.id, '50000.00', vietnamInstant('2026-04-21'));

    const scoped = await getDashboardStats(
      { kind: 'stores', storeIds: [data.stores.store1.id] },
      vietnamInstant('2026-05-01')
    );

    expect(scoped.last30Days.orders).toBe(1);
    expect(scoped.last30Days.revenue).toBe(30000);
  });

  it('counts nothing for a user assigned to no store', async () => {
    await insertOrder(data.stores.store1.id, '30000.00', vietnamInstant('2026-04-20'));

    const stats = await getDashboardStats(
      { kind: 'stores', storeIds: [] },
      vietnamInstant('2026-05-01')
    );

    expect(stats.last30Days.orders).toBe(0);
    expect(stats.last30Days.revenue).toBe(0);
  });

  it('flags a product whose total stock has reached its minimum, and sums it across stores', async () => {
    const [second] = await db.insert(products).values({
      name: 'Well Stocked Product',
      sku: 'STOCK-002',
      price: '100.00',
      categoryId: data.categories.category.id,
      minStock: 10,
    }).returning();

    // 4 + 4 = 8, under the minimum of 10 - one alert, not one per branch.
    await db.insert(inventory).values([
      { productId: data.products.product.id, storeId: data.stores.store1.id, quantity: 4 },
      { productId: data.products.product.id, storeId: data.stores.warehouse.id, quantity: 4 },
      { productId: second.id, storeId: data.stores.store1.id, quantity: 100 },
    ]);

    const stats = await getDashboardStats(globalScope, vietnamInstant('2026-05-01'));

    expect(stats.totalProducts).toBe(2);
    expect(stats.lowStock).toHaveLength(1);
    expect(stats.lowStock[0]).toMatchObject({
      id: data.products.product.id,
      name: 'Test Product',
      quantity: 8,
      minStock: 10,
    });
  });

  it('judges stock against the stores the user may see, not the whole company', async () => {
    // Store 1 alone is down to 4, but the company total (4 + 10) is above the minimum of 10, so
    // only the user who can see store 1 at all should be alerted.
    await db.insert(inventory).values([
      { productId: data.products.product.id, storeId: data.stores.store1.id, quantity: 4 },
      { productId: data.products.product.id, storeId: data.stores.warehouse.id, quantity: 10 },
    ]);

    const companyWide = await getDashboardStats(globalScope, vietnamInstant('2026-05-01'));
    const storeScoped = await getDashboardStats(
      { kind: 'stores', storeIds: [data.stores.store1.id] },
      vietnamInstant('2026-05-01')
    );

    expect(companyWide.lowStock).toHaveLength(0);
    expect(storeScoped.lowStock).toHaveLength(1);
    expect(storeScoped.lowStock[0].quantity).toBe(4);
  });
});

describe('percentChange', () => {
  it('rounds to one decimal place', () => {
    expect(percentChange(160000, 70000)).toBe(128.6);
    expect(percentChange(90, 100)).toBe(-10);
    expect(percentChange(100, 100)).toBe(0);
  });

  it('returns null when there is no earlier figure to grow from', () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });
});
