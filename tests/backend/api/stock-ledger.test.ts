import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '../../../db';
import {
  inventory, products, stockMovements, userStoreAssignments,
} from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData } from '../../helpers/test-db';
import { asc, eq, sql } from 'drizzle-orm';
import { cancelSale, createSale, refundSale, SaleError } from '../../../server/sales';
import { applyStockChange, recordOpeningStock, StockError } from '../../../server/stock-ledger';

/**
 * The stock ledger is the append-only history behind inventory.quantity. These tests pin
 * down the two properties the rest of the system relies on:
 *   1. every path that moves stock leaves a movement behind, in the same transaction;
 *   2. the movements always add up to the quantity the inventory row holds.
 */
describe('stock ledger', () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let stock: { id: number };

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    data = await seedTestData();

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

    // Seed the opening balance through the ledger, the way the application does, so the
    // drift check below measures the code under test and not the fixture.
    await recordOpeningStock(db, {
      inventoryId: stock.id,
      quantity: 10,
      reason: 'adjustment',
      productId: data.products.product.id,
      storeId: data.stores.store1.id,
      refType: 'test_fixture',
      userId: data.users.admin.id,
    });
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  async function stockLevel() {
    const [row] = await db.select({ quantity: inventory.quantity })
      .from(inventory).where(eq(inventory.id, stock.id));
    return row.quantity;
  }

  async function movements() {
    return db.select().from(stockMovements)
      .where(eq(stockMovements.inventoryId, stock.id))
      .orderBy(asc(stockMovements.id));
  }

  /** Movements the code under test wrote, ignoring the fixture's opening balance. */
  async function businessMovements() {
    return (await movements()).filter((row) => row.refType !== 'test_fixture');
  }

  /**
   * SUM(delta) per inventory row vs the cached quantity - the same check
   * `npm run stock:reconcile` runs over the whole table.
   */
  async function ledgerDrift() {
    const rows = (await db.execute(sql`
      SELECT i.id, i.quantity, COALESCE(SUM(m.delta), 0)::int AS ledger_quantity
      FROM inventory i
      LEFT JOIN stock_movements m ON m.inventory_id = i.id
      GROUP BY i.id, i.quantity
      HAVING i.quantity <> COALESCE(SUM(m.delta), 0)
    `)) as unknown as { id: number; quantity: number; ledger_quantity: number }[];
    return rows;
  }


  it('records a movement for every line of a sale', async () => {
    const sale = await createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 3 }],
      paymentMethod: 'CASH',
    });

    const rows = await businessMovements();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      delta: -3,
      reason: 'sale',
      refType: 'sales_transaction',
      refId: sale!.id,
      productId: data.products.product.id,
      storeId: data.stores.store1.id,
      userId: data.users.admin.id,
    });
    expect(await stockLevel()).toBe(7);
  });

  it('records a positive movement when a sale is refunded', async () => {
    const sale = await createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 4 }],
      paymentMethod: 'CASH',
    });

    await refundSale({
      transactionId: sale!.id,
      userId: data.users.admin.id,
      refundAmount: Number(sale!.totalAmount),
    });

    const rows = await businessMovements();
    expect(rows.map((row) => row.reason)).toEqual(['sale', 'refund']);
    expect(rows[1]).toMatchObject({
      delta: 4,
      refType: 'sales_transaction',
      refId: sale!.id,
    });
    expect(await stockLevel()).toBe(10);
    expect(await ledgerDrift()).toEqual([]);
  });

  it('records a positive movement when a sale is cancelled', async () => {
    const sale = await createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 2 }],
      paymentMethod: 'CASH',
    });

    await cancelSale({ transactionId: sale!.id, userId: data.users.admin.id, reason: 'void' });

    const rows = await businessMovements();
    expect(rows.map((row) => row.reason)).toEqual(['sale', 'cancel']);
    expect(rows[1].delta).toBe(2);
    expect(await stockLevel()).toBe(10);
    expect(await ledgerDrift()).toEqual([]);
  });


  it('writes nothing when the sale rolls back', async () => {
    // A second product that exists but has no inventory row - the second line fails and
    // the whole transaction unwinds, so the first line's stock must come back and its
    // movement must not survive.
    const [extra] = await db.insert(products).values({
      name: 'Unstocked Product',
      sku: 'LEDGER-002',
      price: '50.00',
      categoryId: data.categories.category.id,
      brandId: data.brands.brand.id,
    }).returning({ id: products.id });

    await expect(createSale({
      userId: data.users.admin.id,
      items: [
        { productId: data.products.product.id, quantity: 2 },
        { productId: extra.id, quantity: 1 },
      ],
      paymentMethod: 'CASH',
    })).rejects.toBeInstanceOf(SaleError);

    expect(await businessMovements()).toHaveLength(0);
    expect(await stockLevel()).toBe(10);
  });

  it('refuses to overdraw a row and records no movement', async () => {
    await expect(applyStockChange(db, {
      inventoryId: stock.id,
      delta: -11,
      reason: 'adjustment',
      productId: data.products.product.id,
      storeId: data.stores.store1.id,
      userId: data.users.admin.id,
      requireSufficientStock: true,
    })).rejects.toBeInstanceOf(StockError);

    expect(await businessMovements()).toHaveLength(0);
    expect(await stockLevel()).toBe(10);
  });

  it('keeps the running total equal to the sum of movements', async () => {
    await applyStockChange(db, {
      inventoryId: stock.id,
      delta: -6,
      reason: 'adjustment',
      requireSufficientStock: true,
    });
    await applyStockChange(db, { inventoryId: stock.id, delta: 15, reason: 'po_receipt' });
    await applyStockChange(db, {
      inventoryId: stock.id,
      delta: -4,
      reason: 'transfer_out',
      requireSufficientStock: true,
    });

    const rows = await movements();
    expect(rows.map((row) => row.quantityAfter)).toEqual([10, 4, 19, 15]);
    expect(await stockLevel()).toBe(15);
    expect(await ledgerDrift()).toEqual([]);
  });
});
