import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '../../../db';
import {
  inventory, products, salesTransactionActions, salesTransactionItems,
  salesTransactions, userStoreAssignments,
} from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData } from '../../helpers/test-db';
import { eq } from 'drizzle-orm';
import { cancelSale, createSale, refundSale, SaleError } from '../../../server/sales';

describe('POS atomicity', () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let stock: { id: number };
  let secondProductId: number;

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    data = await seedTestData();

    // The cashier must be assigned to a store - createSale resolves it from here.
    await db.insert(userStoreAssignments).values({
      userId: data.users.admin.id,
      storeId: data.stores.store1.id,
    });

    const [row] = await db.insert(inventory).values({
      productId: data.products.product.id,
      storeId: data.stores.store1.id,
      inventoryType: 'STORE',
      quantity: 10,
    }).returning({ id: inventory.id });
    stock = row;

    // A product that exists but has no inventory in this store - forces a
    // mid-transaction failure.
    const [extra] = await db.insert(products).values({
      name: 'Unstocked Product',
      sku: 'TEST-002',
      price: '50.00',
      categoryId: data.categories.category.id,
      brandId: data.brands.brand.id,
    }).returning({ id: products.id });
    secondProductId = extra.id;
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  async function stockLevel() {
    const [row] = await db.select({ quantity: inventory.quantity })
      .from(inventory).where(eq(inventory.id, stock.id));
    return row.quantity;
  }

  it('deducts stock and records the sale in one commit', async () => {
    const sale = await createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 3 }],
      paymentMethod: 'CASH',
    });

    expect(sale?.status).toBe('completed');
    expect(sale?.items).toHaveLength(1);
    expect(await stockLevel()).toBe(7);

    const actions = await db.select().from(salesTransactionActions)
      .where(eq(salesTransactionActions.salesTransactionId, sale!.id));
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe('sale_completed');
  });

  it('rolls everything back when one line cannot be fulfilled', async () => {
    await expect(createSale({
      userId: data.users.admin.id,
      items: [
        { productId: data.products.product.id, quantity: 2 },
        { productId: secondProductId, quantity: 1 },
      ],
      paymentMethod: 'CASH',
    })).rejects.toBeInstanceOf(SaleError);

    expect(await db.select().from(salesTransactions)).toHaveLength(0);
    expect(await db.select().from(salesTransactionItems)).toHaveLength(0);
    expect(await stockLevel()).toBe(10); // first line was deducted, then rolled back
  });

  it('never oversells under concurrency', async () => {
    const sale = (quantity: number) => createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity }],
      paymentMethod: 'CASH',
    });

    const results = await Promise.allSettled([sale(6), sale(6)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await stockLevel()).toBe(4);
    expect(await db.select().from(salesTransactions)).toHaveLength(1);
  });

  it('restores stock on refund and refuses a second refund', async () => {
    const sale = await createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 4 }],
      paymentMethod: 'CARD',
    });
    expect(await stockLevel()).toBe(6);

    const refunded = await refundSale({
      transactionId: sale!.id,
      userId: data.users.admin.id,
      reason: 'customer changed mind',
    });
    expect(refunded.refundAmount).toBe(400);
    expect(await stockLevel()).toBe(10);

    await expect(refundSale({
      transactionId: sale!.id,
      userId: data.users.admin.id,
    })).rejects.toBeInstanceOf(SaleError);
    expect(await stockLevel()).toBe(10); // no double restore
  });

  it('restores stock on cancel and blocks cancelling twice', async () => {
    const sale = await createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 5 }],
      paymentMethod: 'CASH',
    });

    await cancelSale({ transactionId: sale!.id, userId: data.users.admin.id, reason: 'void' });
    expect(await stockLevel()).toBe(10);

    await expect(cancelSale({
      transactionId: sale!.id,
      userId: data.users.admin.id,
    })).rejects.toBeInstanceOf(SaleError);
    expect(await stockLevel()).toBe(10);
  });
});
