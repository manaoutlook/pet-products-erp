import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import { financeEntries, purchaseOrders } from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData } from '../../helpers/test-db';
import { financeSummary } from '../../../server/finance';
import {
  movePurchaseOrderExpenseDate,
  postPurchaseOrderExpense,
  voidPurchaseOrderExpense,
} from '../../../server/purchase-order-finance';
import { PURCHASE_ORDER_EXPENSE_CATEGORY } from '../../../shared/finance';
import { vietnamDayOf } from '../../../shared/vietnam-day';

/**
 * Purchase orders are money going out, so they belong in the Finance report.
 *
 * These tests pin the promises that link the two modules:
 *
 *   - creating an order posts one debit expense for its total, under the fixed
 *     "Supplier purchases" heading, with the PO number as its reference;
 *   - posting is idempotent - re-opening a cancelled order cannot take the money out twice;
 *   - the report lists the order with its supplier and PO number, but does NOT add the order
 *     total to expenses a second time;
 *   - cancelling voids the expense and drops the order out of the Purchases list;
 *   - an order with no posted expense (one created before this link existed, or whose entry was
 *     voided) is counted as unrecorded instead of silently vanishing.
 */
describe('purchase orders in the finance report', () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  const today = () => vietnamDayOf(new Date());
  let orderSequence = 0;

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    data = await seedTestData();
    orderSequence = 0;
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  const createOrder = async (
    overrides: Partial<typeof purchaseOrders.$inferInsert> = {}
  ) => {
    orderSequence += 1;
    const [order] = await db
      .insert(purchaseOrders)
      .values({
        orderNumber: `PO-20260101-${String(orderSequence).padStart(4, '0')}`,
        supplierId: data.suppliers.supplier.id,
        totalAmount: '15000000.00',
        status: 'pending',
        ...overrides,
      })
      .returning();
    return order;
  };

  /** Post the order's expense the way POST /api/purchase-orders does: in one transaction. */
  const postExpense = (order: typeof purchaseOrders.$inferSelect, amount?: number | string) =>
    db.transaction((tx) =>
      postPurchaseOrderExpense(tx, {
        orderNumber: order.orderNumber,
        supplierName: data.suppliers.supplier.name,
        amount: amount ?? order.totalAmount,
        createdByUserId: data.users.admin.id,
      })
    );

  it('posts the order total as a debit expense and lists the order in the report', async () => {
    const order = await createOrder();
    const entry = await postExpense(order);

    expect(entry.entryType).toBe('expense');
    expect(entry.direction).toBe('debit');
    expect(entry.category).toBe(PURCHASE_ORDER_EXPENSE_CATEGORY);
    expect(entry.amount).toBe(15000000);
    expect(entry.reference).toBe(order.orderNumber);
    expect(entry.entryDate).toBe(today());
    expect(entry.description).toContain(order.orderNumber);
    expect(entry.description).toContain(data.suppliers.supplier.name);

    const summary = await financeSummary();

    // The expense is real money out: it is inside the totals, not a parallel figure.
    expect(summary.expenses.total).toBe(15000000);
    expect(summary.expenses.count).toBe(1);
    expect(summary.expenses.byCategory).toContainEqual({
      category: PURCHASE_ORDER_EXPENSE_CATEGORY,
      amount: 15000000,
      count: 1,
    });
    expect(summary.netProfit).toBe(-15000000);
    expect(summary.cashPosition).toBe(-15000000);

    // ...and the Purchases block names the order behind it, without adding the total again.
    expect(summary.purchases.count).toBe(1);
    expect(summary.purchases.total).toBe(15000000);
    expect(summary.purchases.recordedTotal).toBe(15000000);
    expect(summary.purchases.unrecordedCount).toBe(0);
    expect(summary.purchases.rows[0]).toMatchObject({
      orderNumber: order.orderNumber,
      supplier: data.suppliers.supplier.name,
      amount: 15000000,
      status: 'pending',
      expense: { entryNumber: entry.entryNumber, status: 'posted' },
    });
  });

  it('does not post the same order twice, so re-opening a cancelled order cannot double count', async () => {
    const order = await createOrder();

    const first = await postExpense(order);
    const second = await postExpense(order);

    expect(second.id).toBe(first.id);

    const summary = await financeSummary();
    expect(summary.expenses.total).toBe(15000000);
    expect(summary.expenses.count).toBe(1);
    expect(summary.purchases.count).toBe(1);
  });

  it('voids the expense when the order is cancelled and drops it from the Purchases list', async () => {
    const order = await createOrder();
    await postExpense(order);

    await db.transaction(async (tx) => {
      await voidPurchaseOrderExpense(tx, {
        orderNumber: order.orderNumber,
        voidedByUserId: data.users.admin.id,
        reason: 'Purchase order cancelled',
      });
    });

    const voided = await financeSummary();
    expect(voided.expenses.total).toBe(0);
    expect(voided.expenses.count).toBe(0);
    expect(voided.netProfit).toBe(0);
    // The order still exists, so it is called out rather than disappearing from the register.
    expect(voided.purchases.count).toBe(1);
    expect(voided.purchases.recordedTotal).toBe(0);
    expect(voided.purchases.unrecordedCount).toBe(1);
    expect(voided.purchases.rows[0].expense?.status).toBe('voided');

    await db
      .update(purchaseOrders)
      .set({ status: 'cancelled' })
      .where(eq(purchaseOrders.id, order.id));

    const cancelled = await financeSummary();
    expect(cancelled.purchases.count).toBe(0);
    expect(cancelled.purchases.rows).toHaveLength(0);
  });

  it('flags an order that never posted an expense instead of hiding it', async () => {
    const order = await createOrder({ totalAmount: '2500000.00' });

    const summary = await financeSummary();

    expect(summary.expenses.total).toBe(0);
    expect(summary.purchases.count).toBe(1);
    expect(summary.purchases.total).toBe(2500000);
    expect(summary.purchases.recordedTotal).toBe(0);
    expect(summary.purchases.unrecordedCount).toBe(1);
    expect(summary.purchases.rows[0]).toMatchObject({
      orderNumber: order.orderNumber,
      amount: 2500000,
      expense: null,
    });
  });

  /**
   * Correcting the order date (PUT /api/purchase-orders/:id) has to take the expense with it:
   * an order typed in days after it was placed belongs to the day it was placed, in the register
   * and in the money book alike.
   */
  describe('moving the expense to the day the order was placed', () => {
    const correctedDay = '2026-10-15';

    /** What the PUT route does: the order date and its expense move in one transaction. */
    const correctOrderDate = (orderId: number, orderNumber: string) =>
      db.transaction(async (tx) => {
        await tx
          .update(purchaseOrders)
          .set({ orderDate: new Date(`${correctedDay}T00:00:00.000Z`) })
          .where(eq(purchaseOrders.id, orderId));

        return movePurchaseOrderExpenseDate(tx, {
          orderNumber,
          entryDate: correctedDay,
        });
      });

    it('re-dates the posted expense and the report counts it in the corrected month only', async () => {
      const order = await createOrder();
      const entry = await postExpense(order);

      const moved = await correctOrderDate(order.id, order.orderNumber);
      expect(moved).toBe(1);

      const [stored] = await db
        .select()
        .from(financeEntries)
        .where(eq(financeEntries.id, entry.id));

      expect(stored.entryDate).toBe(correctedDay);
      // The number is an identifier, not a date: moving the day must not renumber the entry.
      expect(stored.entryNumber).toBe(entry.entryNumber);
      expect(stored.amount).toBe(entry.amount);
      expect(stored.status).toBe('posted');

      const october = await financeSummary({ from: '2026-10-01', to: '2026-10-31' });
      expect(october.expenses.total).toBe(15000000);
      expect(october.expenses.count).toBe(1);
      expect(october.purchases.rows[0]).toMatchObject({
        orderNumber: order.orderNumber,
        amount: 15000000,
      });

      // The day it was typed in no longer carries the money.
      const todayOnly = await financeSummary({ from: today(), to: today() });
      expect(todayOnly.expenses.total).toBe(0);
      expect(todayOnly.expenses.count).toBe(0);
      expect(todayOnly.purchases.count).toBe(0);
    });

    it('moves a voided expense too, so re-opening the order lands on the corrected day', async () => {
      const order = await createOrder();
      await postExpense(order);

      await db.transaction((tx) =>
        voidPurchaseOrderExpense(tx, {
          orderNumber: order.orderNumber,
          voidedByUserId: data.users.admin.id,
          reason: 'Purchase order cancelled',
        })
      );

      await correctOrderDate(order.id, order.orderNumber);

      const [stored] = await db
        .select()
        .from(financeEntries)
        .where(eq(financeEntries.reference, order.orderNumber));

      expect(stored.status).toBe('voided');
      expect(stored.entryDate).toBe(correctedDay);

      // A voided row stays out of every total, whichever month it is dated in.
      const october = await financeSummary({ from: '2026-10-01', to: '2026-10-31' });
      expect(october.expenses.total).toBe(0);
    });

    it('reports nothing moved for an order that never posted an expense', async () => {
      const order = await createOrder();

      const moved = await correctOrderDate(order.id, order.orderNumber);

      expect(moved).toBe(0);
    });
  });
});
