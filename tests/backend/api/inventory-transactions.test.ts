import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../../../db';
import {
  inventory,
  inventoryImportFiles,
  stockMovements,
  userStoreAssignments,
} from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData } from '../../helpers/test-db';
import { asc, eq } from 'drizzle-orm';
import { createSale } from '../../../server/sales';
import { adjustStock } from '../../../server/stock-adjust';
import { recordOpeningStock } from '../../../server/stock-ledger';
import { importInventory } from '../../../server/inventory-import';
import {
  InventoryImportFileError,
  saveInventoryImportFile,
} from '../../../server/inventory-import-files';
import {
  describeInventoryTransaction,
  listInventoryTransactions,
} from '../../../server/inventory-transactions';

/**
 * The transaction log is what makes a stock change auditable. These tests pin down the two
 * promises the screen depends on:
 *   1. every writer stamps a business reason (`transactionType`) plus before/after;
 *   2. a rejected bulk import writes nothing, while still keeping the uploaded file.
 */
describe('inventory transaction log', () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let stock: { id: number };

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    data = await seedTestData();

    // A sale needs a till: the cashier must be assigned to the store they sell from.
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

  /** Movements the code under test wrote, ignoring the fixture's opening balance. */
  async function businessMovements() {
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

  it('maps every internal reason onto an audited transaction type', () => {
    expect(describeInventoryTransaction('PURCHASE_ORDER')).toContain('purchase order');
    expect(describeInventoryTransaction('SALES_ORDER')).toContain('sold');
    // Transfers read in the direction the stock moved.
    expect(describeInventoryTransaction('STOCK_TRANSFER', { quantityChange: 5 }))
      .toContain('Received');
    expect(describeInventoryTransaction('STOCK_TRANSFER', { quantityChange: -5 }))
      .toContain('Sent');
    expect(describeInventoryTransaction('BULK_IMPORT')).toContain('bulk');
  });

  it('stamps a sale with SALES_ORDER and the quantities around it', async () => {
    await createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 3 }],
      paymentMethod: 'CASH',
    });

    const [movement] = await businessMovements();
    expect(movement).toMatchObject({
      transactionType: 'SALES_ORDER',
      reason: 'sale',
      delta: -3,
      quantityBefore: 10,
      quantityAfter: 7,
      refType: 'sales_transaction',
    });
  });

  it('defaults a stock take to PHYSICAL_COUNT and honours an explicit type', async () => {
    await adjustStock({
      inventoryId: stock.id,
      countedQuantity: 8,
      reason: 'shelf count',
      userId: data.users.admin.id,
    });

    await adjustStock({
      inventoryId: stock.id,
      countedQuantity: 6,
      reason: 'damaged in the aisle',
      userId: data.users.admin.id,
      transactionType: 'DAMAGE_OR_WRITE_OFF',
    });

    const rows = await businessMovements();
    expect(rows.map((row) => row.transactionType))
      .toEqual(['PHYSICAL_COUNT', 'DAMAGE_OR_WRITE_OFF']);
    expect(rows.map((row) => [row.quantityBefore, row.quantityAfter]))
      .toEqual([[10, 8], [8, 6]]);
  });

  it('filters a family of transaction types with transactionTypes', async () => {
    // The stock-adjustment screen asks for the corrections family in one request.
    await adjustStock({
      inventoryId: stock.id,
      delta: -2,
      reason: 'broken bottle',
      userId: data.users.admin.id,
      transactionType: 'DAMAGE_OR_WRITE_OFF',
    });
    await adjustStock({
      inventoryId: stock.id,
      delta: -1,
      reason: 'found one short',
      userId: data.users.admin.id,
      transactionType: 'MANUAL_ADJUSTMENT',
    });
    await createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 1 }],
      paymentMethod: 'CASH',
    });

    const corrections = (await listInventoryTransactions(
      { kind: 'global' },
      { transactionTypes: ['MANUAL_ADJUSTMENT', 'DAMAGE_OR_WRITE_OFF', 'PHYSICAL_COUNT'] },
    ))
      // The fixture's opening balance is a manual adjustment too - ignore it here.
      .filter((row) => row.referenceDocumentType !== 'test_fixture');

    expect(corrections.map((row) => row.transactionType))
      .toEqual(['MANUAL_ADJUSTMENT', 'DAMAGE_OR_WRITE_OFF']);
    // A sale is not a correction, so it must not appear in that family.
    expect(corrections.some((row) => row.transactionType === 'SALES_ORDER')).toBe(false);
  });

  it('records one BULK_IMPORT movement per imported row', async () => {
    const result = await importInventory(
      [
        { productSku: data.products.product.sku, inventoryType: 'STORE',
          store: data.stores.store1.name, quantity: 4 },
      ],
      { userId: data.users.admin.id },
    );

    expect(result.status).toBe('completed');
    expect(result.updated).toBe(1);
    expect(result.rowResults[0]).toMatchObject({
      status: 'updated',
      quantityBefore: 10,
      quantityAfter: 4,
      quantityChange: -6,
    });

    const [movement] = await businessMovements();
    expect(movement).toMatchObject({
      transactionType: 'BULK_IMPORT',
      reason: 'adjustment',
      delta: -6,
      quantityBefore: 10,
      quantityAfter: 4,
      refType: 'inventory_import',
    });
    expect(await quantity()).toBe(4);
  });

  it('rejects the whole file when one row is invalid, writing nothing', async () => {
    const result = await importInventory(
      [
        { productSku: data.products.product.sku, inventoryType: 'STORE',
          store: data.stores.store1.name, quantity: 99 },
        { productSku: 'DOES-NOT-EXIST', inventoryType: 'STORE',
          store: data.stores.store1.name, quantity: 5 },
      ],
      { userId: data.users.admin.id },
    );

    expect(result.status).toBe('failed');
    expect(result.created + result.updated).toBe(0);
    expect(result.errors).toHaveLength(1);
    // The valid row is reported as held back, not silently dropped.
    expect(result.rowResults.some((row) => row.status === 'skipped')).toBe(true);

    expect(await businessMovements()).toHaveLength(0);
    expect(await quantity()).toBe(10);
  });

  it('refuses a file that is not a spreadsheet', async () => {
    await expect(saveInventoryImportFile({
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      dataUrl: `data:text/plain;base64,${Buffer.from('hello').toString('base64')}`,
    })).rejects.toBeInstanceOf(InventoryImportFileError);
  });

  it('keeps the uploaded spreadsheet and links the movements to it', async () => {
    const stored = await saveInventoryImportFile({
      fileName: 'stock-take.csv',
      mimeType: 'text/csv',
      dataUrl: `data:text/csv;base64,${Buffer.from('sku,quantity\nABC,5\n').toString('base64')}`,
    });

    const filePath = path.resolve(process.cwd(), stored.storedFileUrl.replace(/^\//, ''));
    expect(stored.storedFileUrl.startsWith('/uploads/inventory-imports/')).toBe(true);

    try {
      // The bytes the user uploaded are still there, not just a filename.
      expect(await fs.readFile(filePath, 'utf8')).toContain('ABC,5');

      const [record] = await db.insert(inventoryImportFiles).values({
        originalFileName: stored.originalFileName,
        storedFileUrl: stored.storedFileUrl,
        mimeType: stored.mimeType,
        fileSize: stored.fileSize,
        status: 'completed',
        totalRows: 1,
        updatedRows: 1,
        uploadedByUserId: data.users.admin.id,
      }).returning({ id: inventoryImportFiles.id });

      await importInventory(
        [
          { productSku: data.products.product.sku, inventoryType: 'STORE',
            store: data.stores.store1.name, quantity: 12 },
        ],
        {
          userId: data.users.admin.id,
          importFileId: record.id,
          fileName: stored.originalFileName,
        },
      );

      const rows = await listInventoryTransactions(
        { kind: 'global' },
        { importFileId: record.id },
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        transactionType: 'BULK_IMPORT',
        quantityBefore: 10,
        quantityAfter: 12,
        importFileName: stored.originalFileName,
        importFileUrl: stored.storedFileUrl,
        productName: data.products.product.name,
      });
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });
});
