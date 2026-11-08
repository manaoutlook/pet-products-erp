import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '../../../db';
import { inventory, stockMovements } from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData } from '../../helpers/test-db';
import { asc, eq } from 'drizzle-orm';
import { adjustStock, listStockTake } from '../../../server/stock-adjust';
import { recordOpeningStock, StockError } from '../../../server/stock-ledger';

/**
 * Stock adjust / stock-take. The point of these endpoints is that a correction is never
 * silent: it moves inventory.quantity through the ledger with a reason attached, and a
 * recount that matches the system records nothing at all.
 */
describe('stock adjustment', () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let stock: { id: number };

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    data = await seedTestData();

    const [row] = await db.insert(inventory).values({
      productId: data.products.product.id,
      storeId: data.stores.store1.id,
      inventoryType: 'STORE',
      quantity: 10,
    }).returning({ id: inventory.id });
    stock = row;

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

  async function movements() {
    const rows = await db.select().from(stockMovements)
      .where(eq(stockMovements.inventoryId, stock.id))
      .orderBy(asc(stockMovements.id));
    return rows.filter((row) => row.refType !== 'test_fixture');
  }

  async function quantity() {
    const [row] = await db.select({ quantity: inventory.quantity })
      .from(inventory).where(eq(inventory.id, stock.id));
    return row.quantity;
  }

  it('sets the quantity to the counted value and records why', async () => {
    const result = await adjustStock({
      inventoryId: stock.id,
      countedQuantity: 7,
      reason: 'two boxes damaged in transit',
      userId: data.users.admin.id,
    });

    expect(result).toMatchObject({
      quantityBefore: 10,
      quantityAfter: 7,
      delta: -3,
      movementWritten: true,
    });
    expect(await quantity()).toBe(7);

    const rows = await movements();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      delta: -3,
      quantityAfter: 7,
      reason: 'adjustment',
      refType: 'stock_take',
      refId: stock.id,
      userId: data.users.admin.id,
      note: 'two boxes damaged in transit',
    });
  });

  it('adjusts by a signed delta and marks it as a plain adjustment', async () => {
    const result = await adjustStock({
      inventoryId: stock.id,
      delta: 4,
      reason: 'delivery note not booked in',
      source: 'stock_adjust',
      userId: data.users.admin.id,
    });

    expect(result).toMatchObject({ quantityBefore: 10, quantityAfter: 14, delta: 4 });
    expect(await quantity()).toBe(14);

    const rows = await movements();
    expect(rows[0]).toMatchObject({
      delta: 4,
      refType: 'stock_adjust',
      note: 'delivery note not booked in',
    });
  });

  it('records nothing when the count matches the system', async () => {
    const result = await adjustStock({
      inventoryId: stock.id,
      countedQuantity: 10,
      reason: 'monthly count, no variance',
    });

    expect(result).toMatchObject({ delta: 0, movementWritten: false, quantityAfter: 10 });
    expect(await movements()).toHaveLength(0);
    expect(await quantity()).toBe(10);
  });

  it('allows counting a row down to zero', async () => {
    const result = await adjustStock({
      inventoryId: stock.id,
      countedQuantity: 0,
      reason: 'shelf empty, stock written off',
    });

    expect(result.quantityAfter).toBe(0);
    expect(await quantity()).toBe(0);
  });

  it('refuses a delta that would take the row negative', async () => {
    await expect(adjustStock({
      inventoryId: stock.id,
      delta: -11,
      reason: 'bad count',
    })).rejects.toBeInstanceOf(StockError);

    expect(await movements()).toHaveLength(0);
    expect(await quantity()).toBe(10);
  });

  it('rejects a malformed request before touching the row', async () => {
    // Both forms at once
    await expect(adjustStock({
      inventoryId: stock.id,
      delta: 2,
      countedQuantity: 12,
      reason: 'ambiguous',
    })).rejects.toThrow(/either delta or countedQuantity/i);

    // Neither form
    await expect(adjustStock({
      inventoryId: stock.id,
      reason: 'nothing to change',
    })).rejects.toThrow(/either delta or countedQuantity/i);

    // No reason
    await expect(adjustStock({
      inventoryId: stock.id,
      delta: 2,
      reason: '   ',
    })).rejects.toThrow(/reason is required/i);

    expect(await movements()).toHaveLength(0);
    expect(await quantity()).toBe(10);
  });

  it('reports an unknown inventory row as 404', async () => {
    const error = await adjustStock({
      inventoryId: 999_999,
      delta: 1,
      reason: 'ghost row',
    }).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(StockError);
    expect((error as StockError).status).toBe(404);
  });

  describe('stock take list', () => {
    it('shows the system quantity next to the last count', async () => {
      const [dcRow] = await db.insert(inventory).values({
        productId: data.products.product.id,
        storeId: null,
        inventoryType: 'DC',
        quantity: 4,
      }).returning({ id: inventory.id });

      await adjustStock({
        inventoryId: stock.id,
        countedQuantity: 6,
        reason: 'counted shelf',
        userId: data.users.admin.id,
      });

      const rows = await listStockTake({ kind: 'global' });
      expect(rows).toHaveLength(2);

      const storeRow = rows.find((row) => row.inventoryId === stock.id)!;
      expect(storeRow).toMatchObject({
        productName: data.products.product.name,
        storeName: data.stores.store1.name,
        systemQuantity: 6,
        lastCountedQuantity: 6,
        lastVariance: -4,
        lastNote: 'counted shelf',
      });
      expect(storeRow.lastCountedAt).toBeTruthy();

      // Never counted: no last count to show.
      const untouched = rows.find((row) => row.inventoryId === dcRow.id)!;
      expect(untouched.lastCountedQuantity).toBeNull();
      expect(untouched.lastVariance).toBeNull();
      expect(untouched.lastCountedAt).toBeNull();
    });

    it('hides other stores but keeps shared DC stock', async () => {
      await db.insert(inventory).values({
        productId: data.products.product.id,
        storeId: null,
        inventoryType: 'DC',
        quantity: 4,
      });

      const foreign = await listStockTake({
        kind: 'stores',
        storeIds: [data.stores.warehouse.id],
      });
      expect(foreign.map((row) => row.inventoryId)).not.toContain(stock.id);
      expect(foreign).toHaveLength(1);
      expect(foreign[0].storeId).toBeNull();

      const own = await listStockTake({
        kind: 'stores',
        storeIds: [data.stores.store1.id],
      });
      expect(own.map((row) => row.inventoryId)).toContain(stock.id);
    });

    it('shows the latest count when a row is counted twice', async () => {
      await adjustStock({ inventoryId: stock.id, countedQuantity: 8, reason: 'first count' });
      await adjustStock({ inventoryId: stock.id, countedQuantity: 9, reason: 'second count' });

      const [row] = await listStockTake({ kind: 'global' });
      expect(row).toMatchObject({
        systemQuantity: 9,
        lastCountedQuantity: 9,
        lastVariance: 1,
        lastNote: 'second count',
      });
    });
  });
});

