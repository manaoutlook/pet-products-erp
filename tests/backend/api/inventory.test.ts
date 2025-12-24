import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { inventory, products, stores } from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData, resetTestDatabase } from '../../helpers/test-db';
import { eq } from 'drizzle-orm';

describe('Inventory API Tests', () => {
    let testData: Awaited<ReturnType<typeof seedTestData>>;

    beforeAll(async () => {
        // Reset database once per test file for clean state
        await resetTestDatabase();
    });

    beforeEach(async () => {
        // Clean data between tests but keep schema
        await cleanDatabase();
        await resetSequences();
        testData = await seedTestData();
    });

    afterEach(async () => {
        await cleanDatabase();
    });

    describe('Inventory CRUD Operations', () => {
        it('should create inventory record', async () => {
            const [inv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                supplierId: testData.suppliers.supplier.id,
                quantity: 100,
                location: 'Aisle 5',
                inventoryType: 'STORE',
            }).returning();

            expect(inv).toBeDefined();
            expect(inv.quantity).toBe(100);
            expect(inv.location).toBe('Aisle 5');
        });

        it('should read inventory with relationships', async () => {
            const [inv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                supplierId: testData.suppliers.supplier.id,
                quantity: 100,
            }).returning();

            const inventoryItem = await db.query.inventory.findFirst({
                where: eq(inventory.id, inv.id),
                with: {
                    product: true,
                    store: true,
                    supplier: true,
                },
            });

            expect(inventoryItem?.product.name).toBe('Test Product');
            expect(inventoryItem?.store?.name).toBe('Test Store 1');
            expect(inventoryItem?.supplier?.name).toBe('Test Supplier');
        });

        it('should update inventory quantity', async () => {
            const [inv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                quantity: 100,
            }).returning();

            const [updated] = await db.update(inventory)
                .set({ quantity: 150 })
                .where(eq(inventory.id, inv.id))
                .returning();

            expect(updated.quantity).toBe(150);
        });

        it('should delete inventory record', async () => {
            const [inv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                quantity: 100,
            }).returning();

            await db.delete(inventory).where(eq(inventory.id, inv.id));

            const deleted = await db.query.inventory.findFirst({
                where: eq(inventory.id, inv.id),
            });

            expect(deleted).toBeUndefined();
        });
    });

    describe('Multi-Store Inventory', () => {
        it('should track inventory across multiple stores', async () => {
            await db.insert(inventory).values([
                {
                    productId: testData.products.product.id,
                    storeId: testData.stores.store1.id,
                    quantity: 50,
                },
                {
                    productId: testData.products.product.id,
                    storeId: testData.stores.warehouse.id,
                    quantity: 200,
                },
            ]);

            const allInventory = await db.query.inventory.findMany({
                where: eq(inventory.productId, testData.products.product.id),
                with: { store: true },
            });

            expect(allInventory).toHaveLength(2);
            expect(allInventory.some(i => i.store?.type === 'RETAIL')).toBe(true);
            expect(allInventory.some(i => i.store?.type === 'WAREHOUSE')).toBe(true);
        });

        it('should filter inventory by store type', async () => {
            await db.insert(inventory).values([
                {
                    productId: testData.products.product.id,
                    storeId: testData.stores.store1.id,
                    quantity: 50,
                },
                {
                    productId: testData.products.product.id,
                    storeId: testData.stores.warehouse.id,
                    quantity: 200,
                },
            ]);

            const warehouseInventory = await db.query.inventory.findMany({
                where: eq(inventory.storeId, testData.stores.warehouse.id),
            });

            expect(warehouseInventory).toHaveLength(1);
            expect(warehouseInventory[0].quantity).toBe(200);
        });
    });

    describe('Inventory Tracking', () => {
        it('should track inventory location', async () => {
            const [inv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                quantity: 100,
                location: 'Warehouse Section A, Shelf 3',
            }).returning();

            expect(inv.location).toBe('Warehouse Section A, Shelf 3');
        });

        it('should track inventory type', async () => {
            const [storeInv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                quantity: 50,
                inventoryType: 'STORE',
            }).returning();

            const [dcInv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.warehouse.id,
                quantity: 200,
                inventoryType: 'DC',
            }).returning();

            expect(storeInv.inventoryType).toBe('STORE');
            expect(dcInv.inventoryType).toBe('DC');
        });

        it('should generate unique barcodes', async () => {
            const [inv1] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                quantity: 100,
                barcode: 'BAR-001-001',
            }).returning();

            const [inv2] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.warehouse.id,
                quantity: 200,
                barcode: 'BAR-001-002',
            }).returning();

            expect(inv1.barcode).not.toBe(inv2.barcode);
        });
    });

    describe('Stock Level Management', () => {
        it('should allow zero quantity', async () => {
            const [inv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                quantity: 0,
            }).returning();

            expect(inv.quantity).toBe(0);
        });

        it('should track quantity changes', async () => {
            const [inv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                quantity: 100,
            }).returning();

            // Simulate sale - reduce quantity
            await db.update(inventory)
                .set({ quantity: 95 })
                .where(eq(inventory.id, inv.id));

            // Simulate restock - increase quantity
            await db.update(inventory)
                .set({ quantity: 120 })
                .where(eq(inventory.id, inv.id));

            const final = await db.query.inventory.findFirst({
                where: eq(inventory.id, inv.id),
            });

            expect(final?.quantity).toBe(120);
        });
    });
});
