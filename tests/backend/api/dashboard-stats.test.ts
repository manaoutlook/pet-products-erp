import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../db';
import {
  inventory,
  invoices,
  orders,
  products,
  salesOrders,
  salesTransactions,
} from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData } from '../../helpers/test-db';
import { getDashboardStats, getOrderTrend, percentChange } from '../../../server/dashboard-stats';
import type { AccessScope } from '../../../server/scoping';

/**
 * The dashboard aggregates.
 *
 * These pin the two things the owner actually reads off the home screen: "how much did we take in
 * the last 30 days" and "what is running out". Both are Vietnamese-calendar-day questions, so the
 * boundary cases below are deliberately timestamps that fall on a *different* UTC day.
 *
 * AI Agent Note - the fixtures write to `sales_transactions` / `sales_orders`, because those are
 * the tables the application actually fills. The previous fixtures seeded the legacy `orders`
 * table, which nothing writes to any more: the suite passed while the real dashboard showed 0.
 * The "ignores the legacy orders table" test below is the regression guard for exactly that.
 */
describe('dashboard stats', () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  const globalScope: AccessScope = { kind: 'global' };

  /** An instant on a given Vietnamese day - a safe anchor for "a sale was taken that day". */
  const vietnamInstant = (day: string, time = '12:00:00') =>
    new Date(`${day}T${time}.000+07:00`);

  let receiptCounter = 0;
  let orderCounter = 0;

  /** A till sale - `sales_transactions` is what the POS writes. */
  async function insertPosSale(
    storeId: number | null,
    total: string,
    transactionDate: Date,
    status = 'completed'
  ) {
    receiptCounter += 1;
    const [row] = await db.insert(salesTransactions).values({
      invoiceNumber: `HD-TEST-${receiptCounter}`,
      storeId,
      transactionType: 'STORE_SALE',
      cashierUserId: data.users.admin.id,
      totalAmount: total,
      paymentMethod: 'cash',
      transactionDate,
      status,
    }).returning();
    return row;
  }

  /** A sales order - `sales_orders` is what the Sales Orders screen writes. */
  async function insertSalesOrder(
    storeId: number | null,
    total: string,
    orderDate: Date,
    status = 'open'
  ) {
    orderCounter += 1;
    const [row] = await db.insert(salesOrders).values({
      orderNumber: `SO-TEST-${orderCounter}`,
      customerName: 'Khách sỉ',
      storeId,
      totalAmount: total,
      orderDate,
      preparedByUserId: data.users.admin.id,
      status,
    }).returning();
    return row;
  }

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    data = await seedTestData();
    receiptCounter = 0;
    orderCounter = 0;
  });

  it('sums the till and sales orders over the last 30 Vietnamese days', async () => {
    const now = vietnamInstant('2026-05-01', '10:00:00');
    // 06:30 on 1 May in Vietnam is still 30 April in UTC - the one-day drift this window prevents.
    await insertPosSale(data.stores.store1.id, '110000.00', vietnamInstant('2026-05-01', '06:30:00'));
    // The first day of the current window (1 May minus 29 days).
    await insertSalesOrder(data.stores.store1.id, '50000.00', vietnamInstant('2026-04-02', '08:00:00'));
    // The last instant of the previous window.
    await insertPosSale(data.stores.store1.id, '70000.00', vietnamInstant('2026-04-01', '23:30:00'));
    // Before both windows.
    await insertPosSale(data.stores.store1.id, '999000.00', vietnamInstant('2026-03-02', '12:00:00'));

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

  it('does not count refunded till sales or cancelled sales orders as revenue', async () => {
    const now = vietnamInstant('2026-05-01');
    await insertPosSale(data.stores.store1.id, '100000.00', vietnamInstant('2026-04-20'));
    await insertPosSale(data.stores.store1.id, '999000.00', vietnamInstant('2026-04-20'), 'refunded');
    await insertPosSale(data.stores.store1.id, '888000.00', vietnamInstant('2026-04-21'), 'voided');
    await insertSalesOrder(data.stores.store1.id, '777000.00', vietnamInstant('2026-04-22'), 'cancelled');

    const stats = await getDashboardStats(globalScope, now);

    expect(stats.last30Days.orders).toBe(1);
    expect(stats.last30Days.revenue).toBe(100000);
  });

  it('reports no growth at all when there is no earlier trading to compare against', async () => {
    const now = vietnamInstant('2026-05-01');
    await insertPosSale(data.stores.store1.id, '40000.00', vietnamInstant('2026-04-20'));

    const stats = await getDashboardStats(globalScope, now);

    expect(stats.last30Days.revenue).toBe(40000);
    expect(stats.previous30Days.revenue).toBe(0);
    // Not 100% and not 0%: there is nothing to compare with, and the tile must say so.
    expect(stats.growth).toBeNull();
  });


  it('counts only the stores the user may see, across both sales channels', async () => {
    await insertPosSale(data.stores.store1.id, '30000.00', vietnamInstant('2026-04-20'));
    await insertSalesOrder(data.stores.store1.id, '20000.00', vietnamInstant('2026-04-20'));
    await insertPosSale(data.stores.warehouse.id, '50000.00', vietnamInstant('2026-04-21'));

    const scoped = await getDashboardStats(
      { kind: 'stores', storeIds: [data.stores.store1.id] },
      vietnamInstant('2026-05-01')
    );

    expect(scoped.last30Days.orders).toBe(2);
    expect(scoped.last30Days.revenue).toBe(50000);
  });

  it('counts nothing for a user assigned to no store', async () => {
    await insertPosSale(data.stores.store1.id, '30000.00', vietnamInstant('2026-04-20'));

    const stats = await getDashboardStats(
      { kind: 'stores', storeIds: [] },
      vietnamInstant('2026-05-01')
    );

    expect(stats.last30Days.orders).toBe(0);
    expect(stats.last30Days.revenue).toBe(0);
    expect(stats.receivables).toEqual({
      outstanding: 0,
      unpaidInvoices: 0,
      overdueInvoices: 0,
    });
  });

  it('ignores the legacy orders table - the bug that made the dashboard show zero', async () => {
    // Nothing writes to `orders` any more. If a future change starts reading it again, a shop with
    // real trading would show these invented numbers instead of the figures below.
    await db.insert(orders).values({
      customerName: 'Khách lẻ',
      customerEmail: 'khach@example.com',
      storeId: data.stores.store1.id,
      total: '999999.00',
      status: 'completed',
      createdAt: vietnamInstant('2026-04-20'),
    });
    await insertPosSale(data.stores.store1.id, '25000.00', vietnamInstant('2026-04-20'));

    const stats = await getDashboardStats(globalScope, vietnamInstant('2026-05-01'));

    expect(stats.last30Days.orders).toBe(1);
    expect(stats.last30Days.revenue).toBe(25000);
  });

  it("reports today's sales separately from the 30-day window", async () => {
    const now = vietnamInstant('2026-05-01', '15:00:00');
    await insertPosSale(data.stores.store1.id, '60000.00', vietnamInstant('2026-05-01', '08:00:00'));
    await insertSalesOrder(data.stores.store1.id, '40000.00', vietnamInstant('2026-05-01', '09:00:00'));
    await insertPosSale(data.stores.store1.id, '100000.00', vietnamInstant('2026-04-30', '20:00:00'));

    const stats = await getDashboardStats(globalScope, now);

    expect(stats.today).toEqual({ orders: 2, revenue: 100000 });
    expect(stats.last30Days.revenue).toBe(200000);
  });

  it('sums the outstanding invoice balances and counts the overdue ones', async () => {
    const today = '2026-05-01';
    // Invoices must point at the document they were issued for (check constraint
    // `invoices_source_consistency`), so each one gets a real till sale or sales order behind it.
    const overdueSale = await insertPosSale(
      data.stores.store1.id,
      '500000.00',
      vietnamInstant('2026-04-10')
    );
    const order = await insertSalesOrder(
      data.stores.store1.id,
      '200000.00',
      vietnamInstant('2026-04-11')
    );
    const paidSale = await insertPosSale(
      data.stores.store1.id,
      '300000.00',
      vietnamInstant('2026-04-12')
    );

    await db.insert(invoices).values([
      {
        invoiceNumber: 'HD-0001',
        kind: 'RETAIL',
        source: 'POS_SALE',
        salesTransactionId: overdueSale.id,
        buyerName: 'Khách A',
        storeId: data.stores.store1.id,
        totalAmount: '500000.00',
        amountPaid: '0.00',
        balanceDue: '500000.00',
        status: 'issued',
        dueDate: '2026-04-01', // before today - overdue
      },
      {
        invoiceNumber: 'HD-0002',
        kind: 'VAT',
        source: 'SALES_ORDER',
        salesOrderId: order.id,
        buyerName: 'Công ty B',
        storeId: data.stores.store1.id,
        totalAmount: '200000.00',
        amountPaid: '0.00',
        balanceDue: '200000.00',
        status: 'partially_paid',
        dueDate: '2026-06-01', // still in credit
      },
      {
        invoiceNumber: 'HD-0003',
        kind: 'RETAIL',
        source: 'POS_SALE',
        salesTransactionId: paidSale.id,
        buyerName: 'Khách C',
        storeId: data.stores.store1.id,
        totalAmount: '300000.00',
        amountPaid: '300000.00',
        balanceDue: '0.00',
        status: 'paid', // settled - not a receivable
        dueDate: '2026-04-01',
      },
    ]);

    const stats = await getDashboardStats(globalScope, vietnamInstant(today));

    expect(stats.receivables).toEqual({
      outstanding: 700000,
      unpaidInvoices: 2,
      overdueInvoices: 1,
    });
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
      sku: 'TEST-001',
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


describe('getOrderTrend', () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  const globalScope: AccessScope = { kind: 'global' };

  const vietnamInstant = (day: string, time = '12:00:00') =>
    new Date(`${day}T${time}.000+07:00`);

  let receiptCounter = 0;
  let orderCounter = 0;

  async function insertPosSale(storeId: number | null, at: Date, total = '100000.00') {
    receiptCounter += 1;
    await db.insert(salesTransactions).values({
      invoiceNumber: `HD-TREND-${receiptCounter}`,
      storeId,
      transactionType: 'STORE_SALE',
      cashierUserId: data.users.admin.id,
      totalAmount: total,
      paymentMethod: 'cash',
      transactionDate: at,
      status: 'completed',
    });
  }

  async function insertSalesOrder(storeId: number | null, at: Date, total = '50000.00') {
    orderCounter += 1;
    await db.insert(salesOrders).values({
      orderNumber: `SO-TREND-${orderCounter}`,
      customerName: 'Khách sỉ',
      storeId,
      totalAmount: total,
      orderDate: at,
      preparedByUserId: data.users.admin.id,
      status: 'open',
    });
  }

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    data = await seedTestData();
    receiptCounter = 0;
    orderCounter = 0;
  });

  it('returns one point per day, oldest first, even with no trading at all', async () => {
    // The chart used to receive `[]` on a quiet month and drew an empty grid, which reads as
    // "broken" rather than "quiet". Thirty zero points is the honest answer.
    const trend = await getOrderTrend(globalScope, vietnamInstant('2026-05-02'));

    expect(trend).toHaveLength(30);
    expect(trend[0].date).toBe('2026-04-03');
    expect(trend[29].date).toBe('2026-05-02');
    expect(trend.every((point) => point.orders === 0 && point.revenue === 0)).toBe(true);
  });

  it('reads the chart on Vietnamese days, not UTC days', async () => {
    // 06:30 on 2 May in Ho Chi Minh City is 23:30 UTC on 1 May. Grouping on the UTC day used to
    // put this sale in the 1st's bar; the shop counted it on the 2nd.
    await insertPosSale(data.stores.store1.id, new Date('2026-05-01T23:30:00.000Z'));

    const trend = await getOrderTrend(globalScope, vietnamInstant('2026-05-02', '08:00:00'));
    const point = trend.find((entry) => entry.date === '2026-05-02');

    expect(point).toEqual({
      date: '2026-05-02',
      orders: 1,
      revenue: 100000,
      posSales: 1,
      salesOrders: 0,
    });
  });

  it('sums both sides of the midnight boundary into the same Vietnamese day', async () => {
    await insertPosSale(data.stores.store1.id, new Date('2026-05-01T23:30:00.000Z')); // 06:30 on the 2nd
    await insertPosSale(data.stores.store1.id, new Date('2026-05-02T04:59:00.000Z')); // 11:59 on the 2nd

    const trend = await getOrderTrend(globalScope, vietnamInstant('2026-05-02'));
    const point = trend.find((entry) => entry.date === '2026-05-02');

    expect(point?.orders).toBe(2);
    expect(point?.revenue).toBe(200000);
  });

  it('puts till sales and sales orders of the same day on the same bar', async () => {
    await insertPosSale(data.stores.store1.id, vietnamInstant('2026-05-01'), '120000.00');
    await insertSalesOrder(data.stores.store1.id, vietnamInstant('2026-05-01'), '80000.00');

    const trend = await getOrderTrend(globalScope, vietnamInstant('2026-05-02'));
    const point = trend.find((entry) => entry.date === '2026-05-01');

    expect(point).toEqual({
      date: '2026-05-01',
      orders: 2,
      revenue: 200000,
      posSales: 1,
      salesOrders: 1,
    });
  });


  it('keeps the first day of the window and drops the day before it', async () => {
    await insertPosSale(data.stores.store1.id, new Date('2026-04-02T16:59:00.000Z')); // 23:59 on 2 Apr - out
    await insertPosSale(data.stores.store1.id, new Date('2026-04-03T16:59:00.000Z')); // 23:59 on 3 Apr

    const trend = await getOrderTrend(globalScope, vietnamInstant('2026-05-02'));
    const trading = trend.filter((point) => point.orders > 0);

    expect(trading.map((point) => point.date)).toEqual(['2026-04-03']);
    expect(trend[0].date).toBe('2026-04-03');
  });

  it('only shows the stores the user can see', async () => {
    await insertPosSale(data.stores.store1.id, vietnamInstant('2026-05-01'));
    await insertPosSale(data.stores.warehouse.id, vietnamInstant('2026-05-01'));

    const storeScoped = await getOrderTrend(
      { kind: 'stores', storeIds: [data.stores.store1.id] },
      vietnamInstant('2026-05-02')
    );

    expect(storeScoped.find((point) => point.date === '2026-05-01')?.orders).toBe(1);
    expect(storeScoped.reduce((sum, point) => sum + point.orders, 0)).toBe(1);
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

