import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { purchaseOrders, purchaseOrderItems, purchaseOrderActions, suppliers, stores } from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData, resetTestDatabase } from '../../helpers/test-db';
import { eq } from 'drizzle-orm';

describe('Purchase Order Management Tests', () => {
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

    describe('Purchase Order Creation', () => {
        it('should create a new purchase order', async () => {
            const orderDate = new Date();
            const deliveryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days later

            const [po] = await db.insert(purchaseOrders).values({
                orderNumber: 'PO-TEST-001',
                supplierId: testData.suppliers.supplier.id,
                destinationStoreId: testData.stores.warehouse.id,
                orderDate: orderDate,
                deliveryDate: deliveryDate,
                status: 'pending',
                totalAmount: '50000.00',
                notes: 'Test purchase order',
            }).returning();

            expect(po).toBeDefined();
            expect(po.orderNumber).toBe('PO-TEST-001');
            expect(po.status).toBe('pending');
            expect(po.totalAmount).toBe('50000.00');
        });

        it('should enforce unique order numbers', async () => {
            const orderDate = new Date();

            // Create first PO
            await db.insert(purchaseOrders).values({
                orderNumber: 'PO-DUP-001',
                supplierId: testData.suppliers.supplier.id,
                destinationStoreId: testData.stores.warehouse.id,
                orderDate: orderDate,
                status: 'pending',
                totalAmount: '10000.00',
            });

            // Try to create duplicate
            await expect(async () => {
                await db.insert(purchaseOrders).values({
                    orderNumber: 'PO-DUP-001', // Same order number
                    supplierId: testData.suppliers.supplier.id,
                    destinationStoreId: testData.stores.warehouse.id,
                    orderDate: orderDate,
                    status: 'pending',
                    totalAmount: '20000.00',
                });
            }).rejects.toThrow();
        });

        it('should create PO with line items', async () => {
            const orderDate = new Date();

            const [po] = await db.insert(purchaseOrders).values({
                orderNumber: 'PO-ITEMS-001',
                supplierId: testData.suppliers.supplier.id,
                destinationStoreId: testData.stores.warehouse.id,
                orderDate: orderDate,
                status: 'pending',
                totalAmount: '25000.00',
            }).returning();

            // Add line items
            await db.insert(purchaseOrderItems).values([
                {
                    purchaseOrderId: po.id,
                    productId: testData.products.product.id,
                    quantity: 10,
                    unitPrice: '1500.00',
                    totalPrice: '15000.00',
                },
                {
                    purchaseOrderId: po.id,
                    productId: testData.products.product.id,
                    quantity: 5,
                    unitPrice: '2000.00',
                    totalPrice: '10000.00',
                }
            ]);

            const poWithItems = await db.query.purchaseOrders.findFirst({
                where: eq(purchaseOrders.id, po.id),
                with: {
                    items: true,
                },
            });

            expect(poWithItems?.items).toHaveLength(2);
            expect(poWithItems?.items[0].quantity).toBe(10);
            expect(poWithItems?.items[1].quantity).toBe(5);
        });
    });

    describe('Purchase Order Status Management', () => {
        it('should update PO status from pending to confirmed', async () => {
            const orderDate = new Date();

            const [po] = await db.insert(purchaseOrders).values({
                orderNumber: 'PO-STATUS-001',
                supplierId: testData.suppliers.supplier.id,
                destinationStoreId: testData.stores.warehouse.id,
                orderDate: orderDate,
                status: 'pending',
                totalAmount: '30000.00',
            }).returning();

            const [updated] = await db.update(purchaseOrders)
                .set({ status: 'confirmed' })
                .where(eq(purchaseOrders.id, po.id))
                .returning();

            expect(updated.status).toBe('confirmed');
        });

        it('should track PO status changes with actions', async () => {
            const orderDate = new Date();

            const [po] = await db.insert(purchaseOrders).values({
                orderNumber: 'PO-ACTION-001',
                supplierId: testData.suppliers.supplier.id,
                destinationStoreId: testData.stores.warehouse.id,
                orderDate: orderDate,
                status: 'pending',
                totalAmount: '40000.00',
            }).returning();

            // Add action for status change
            await db.insert(purchaseOrderActions).values({
                purchaseOrderId: po.id,
                actionType: 'status_change',
                actionData: { notes: 'Status changed from pending to confirmed' },
                performedByUserId: testData.users.admin.id,
            });

            const poWithActions = await db.query.purchaseOrders.findFirst({
                where: eq(purchaseOrders.id, po.id),
                with: {
                    actions: true,
                },
            });

            expect(poWithActions?.actions).toHaveLength(1);
            expect(poWithActions?.actions[0].actionType).toBe('status_change');
        });
    });

    describe('Purchase Order Actions', () => {
        it('should record print action', async () => {
            const orderDate = new Date();

            const [po] = await db.insert(purchaseOrders).values({
                orderNumber: 'PO-PRINT-001',
                supplierId: testData.suppliers.supplier.id,
                destinationStoreId: testData.stores.warehouse.id,
                orderDate: orderDate,
                status: 'confirmed',
                totalAmount: '35000.00',
            }).returning();

            await db.insert(purchaseOrderActions).values({
                purchaseOrderId: po.id,
                actionType: 'print',
                actionData: { notes: 'Printed 2 copies on Office Printer' },
                performedByUserId: testData.users.admin.id,
            });

            const actions = await db.query.purchaseOrderActions.findMany({
                where: eq(purchaseOrderActions.purchaseOrderId, po.id),
            });

            expect(actions).toHaveLength(1);
            expect(actions[0].actionType).toBe('print');
            expect(actions[0].actionData.notes).toContain('Printed 2 copies');
        });

        it('should record goods receipt action', async () => {
            const orderDate = new Date();

            const [po] = await db.insert(purchaseOrders).values({
                orderNumber: 'PO-RECEIPT-001',
                supplierId: testData.suppliers.supplier.id,
                destinationStoreId: testData.stores.warehouse.id,
                orderDate: orderDate,
                status: 'shipped',
                totalAmount: '45000.00',
            }).returning();

            await db.insert(purchaseOrderActions).values({
                purchaseOrderId: po.id,
                actionType: 'goods_receipt',
                actionData: {
                    quantity: 15,
                    notes: 'Received by John Warehouse, condition good'
                },
                performedByUserId: testData.users.admin.id,
            });

            const actions = await db.query.purchaseOrderActions.findMany({
                where: eq(purchaseOrderActions.purchaseOrderId, po.id),
            });

            expect(actions[0].actionType).toBe('goods_receipt');
            expect(actions[0]?.actionData?.quantity).toBe(15);
        });
    });

    describe('Purchase Order Relationships', () => {
        it('should link PO to supplier', async () => {
            const orderDate = new Date();

            const [po] = await db.insert(purchaseOrders).values({
                orderNumber: 'PO-SUPPLIER-001',
                supplierId: testData.suppliers.supplier.id,
                destinationStoreId: testData.stores.warehouse.id,
                orderDate: orderDate,
                status: 'pending',
                totalAmount: '55000.00',
            }).returning();

            const poWithSupplier = await db.query.purchaseOrders.findFirst({
                where: eq(purchaseOrders.id, po.id),
                with: {
                    supplier: true,
                },
            });

            expect(poWithSupplier?.supplier?.name).toBe('Test Supplier Co.');
        });

        it('should link PO to destination store', async () => {
            const orderDate = new Date();

            const [po] = await db.insert(purchaseOrders).values({
                orderNumber: 'PO-STORE-001',
                supplierId: testData.suppliers.supplier.id,
                destinationStoreId: testData.stores.warehouse.id,
                orderDate: orderDate,
                status: 'pending',
                totalAmount: '60000.00',
            }).returning();

            const poWithStore = await db.query.purchaseOrders.findFirst({
                where: eq(purchaseOrders.id, po.id),
                with: {
                    destinationStore: true,
                },
            });

            expect(poWithStore?.destinationStore?.name).toBe('Test Warehouse');
            expect(poWithStore?.destinationStore?.type).toBe('WAREHOUSE');
        });
    });

    describe('Purchase Order Validation', () => {
        it('should require valid supplier', async () => {
            const orderDate = new Date();

            await expect(async () => {
                await db.insert(purchaseOrders).values({
                    orderNumber: 'PO-INVALID-001',
                    supplierId: 99999, // Non-existent supplier
                    destinationStoreId: testData.stores.warehouse.id,
                    orderDate: orderDate,
                    status: 'pending',
                    totalAmount: '30000.00',
                });
            }).rejects.toThrow();
        });

        it('should require valid destination store', async () => {
            const orderDate = new Date();

            await expect(async () => {
                await db.insert(purchaseOrders).values({
                    orderNumber: 'PO-INVALID-002',
                    supplierId: testData.suppliers.supplier.id,
                    destinationStoreId: 99999, // Non-existent store
                    orderDate: orderDate,
                    status: 'pending',
                    totalAmount: '30000.00',
                });
            }).rejects.toThrow();
        });

        it('should validate PO item relationships', async () => {
            const orderDate = new Date();

            const [po] = await db.insert(purchaseOrders).values({
                orderNumber: 'PO-VALIDATE-001',
                supplierId: testData.suppliers.supplier.id,
                destinationStoreId: testData.stores.warehouse.id,
                orderDate: orderDate,
                status: 'pending',
                totalAmount: '20000.00',
            }).returning();

            // Try to add item with invalid product
            await expect(async () => {
                await db.insert(purchaseOrderItems).values({
                    purchaseOrderId: po.id,
                    productId: 99999, // Non-existent product
                    quantity: 5,
                    unitPrice: '1000.00',
                    totalPrice: '5000.00',
                });
            }).rejects.toThrow();
        });
    });
});
