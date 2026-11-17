import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { inventory, orderItems, orders } from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData, resetTestDatabase } from '../../helpers/test-db';
import {
  buildProductDeletionError,
  describeProductDeletionBlockers,
  getProductDeletionBlockers,
  hasProductDeletionBlockers,
} from '../../../server/product-delete';

/**
 * Product deletion is refused while anything still references the product.
 *
 * AI Agent Note: this used to be a cascade - DELETE /api/products/:id removed the product's
 * inventory rows first, so a product could vanish (with its stock) while nothing warned the
 * user. These tests pin the guard that replaced it.
 */
describe('Product deletion guard', () => {
  let testData: Awaited<ReturnType<typeof seedTestData>>;

  beforeAll(async () => {
    await resetTestDatabase();
  });

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    testData = await seedTestData();
  });

  afterEach(async () => {
    await cleanDatabase();
  });

  it('allows a product with no associated records', async () => {
    const blockers = await getProductDeletionBlockers(testData.products.product.id);

    expect(blockers).toEqual({
      inventory: 0,
      orderItems: 0,
      purchaseOrderItems: 0,
      salesOrderItems: 0,
      salesTransactionItems: 0,
      transferRequestItems: 0,
      transferHistory: 0,
    });
    expect(hasProductDeletionBlockers(blockers)).toBe(false);
  });

  it('blocks a product that still has an inventory row', async () => {
    await db.insert(inventory).values({
      productId: testData.products.product.id,
      storeId: testData.stores.warehouse.id,
      supplierId: testData.suppliers.supplier.id,
      quantity: 0,
      inventoryType: 'DC',
      barcode: 'INV-DELETE-GUARD-1',
    });

    const blockers = await getProductDeletionBlockers(testData.products.product.id);

    expect(blockers.inventory).toBe(1);
    expect(hasProductDeletionBlockers(blockers)).toBe(true);
  });

  it('explains which records block the deletion and what to do', async () => {
    await db.insert(inventory).values({
      productId: testData.products.product.id,
      storeId: testData.stores.warehouse.id,
      supplierId: testData.suppliers.supplier.id,
      quantity: 12,
      inventoryType: 'DC',
      barcode: 'INV-DELETE-GUARD-2',
    });

    const blockers = await getProductDeletionBlockers(testData.products.product.id);
    const error = buildProductDeletionError(testData.products.product.name, blockers);

    expect(describeProductDeletionBlockers(blockers)).toBe('1 inventory record(s)');
    expect(error.message).toBe(
      `Cannot delete product "${testData.products.product.name}" because it is still linked to 1 inventory record(s).`,
    );
    expect(error.suggestion).toBe('Please remove or transfer the inventory first.');
  });

  it('reports order lines before letting a product with history disappear', async () => {
    const [order] = await db
      .insert(orders)
      .values({
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        total: '100.00',
      })
      .returning();

    await db.insert(orderItems).values({
      orderId: order.id,
      productId: testData.products.product.id,
      quantity: 1,
      price: '100.00',
    });

    const blockers = await getProductDeletionBlockers(testData.products.product.id);
    const error = buildProductDeletionError(testData.products.product.name, blockers);

    expect(blockers.orderItems).toBe(1);
    expect(error.message).toContain('1 order line(s)');
    expect(error.suggestion).toContain('kept for reporting');
  });
});
