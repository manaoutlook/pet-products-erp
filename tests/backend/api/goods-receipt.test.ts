import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { db } from '../../../db';
import {
    goodsReceiptItems,
    goodsReceipts,
    inventory,
    purchaseOrderActions,
    purchaseOrderItems,
    purchaseOrders,
    stockMovements,
} from '../../../db/schema';
import { eq } from 'drizzle-orm';
import {
    allocateLandedCost,
    landedCostBreakdown,
    receiveGoods,
} from '../../../server/goods-receipt';
import { cleanDatabase, resetSequences, seedTestData, resetTestDatabase } from '../../helpers/test-db';

/**
 * Receiving goods is the one place where "the truck arrived" becomes stock and money at the
 * same time, so these tests pin down both halves:
 *  - the arithmetic that spreads the import fees over the lines (landed cost), and
 *  - the booking itself: a receipt row, stock in, status delivered, and no second receipt.
 */
describe('Goods Receipt (GRN)', () => {
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

    describe('landed cost arithmetic', () => {
        it('sums every fee and treats missing ones as zero', () => {
            const costs = landedCostBreakdown({
                shippingFee: 120.5,
                customsDuty: 40,
                additionalFee: 9.5,
            });

            expect(costs.shippingFee).toBe(120.5);
            expect(costs.customsDuty).toBe(40);
            expect(costs.customsTax).toBe(0);
            expect(costs.brokerageFee).toBe(0);
            expect(costs.additionalFee).toBe(9.5);
            expect(costs.total).toBe(170);
        });

        it('spreads the fees by line value', () => {
            // Line A is three quarters of the order value, so it takes three quarters of the
            // 400 in fees: 300 of it, i.e. 25 per unit on 10 units. Line B takes the rest.
            const allocations = allocateLandedCost(400, [
                { id: 1, quantity: 10, unitPrice: 30 }, // 300
                { id: 2, quantity: 2, unitPrice: 50 }, // 100
            ]);

            expect(allocations[0].lineTotal).toBe(300);
            expect(allocations[0].allocatedCost).toBe(300);
            expect(allocations[0].landedCostPerUnit).toBe(60); // 30 + 300/10

            expect(allocations[1].lineTotal).toBe(100);
            expect(allocations[1].allocatedCost).toBe(100);
            expect(allocations[1].landedCostPerUnit).toBe(100); // 50 + 100/2
        });

        it('allocates the rounding remainder to the last line so nothing is lost', () => {
            // 100 spread over three equal lines is 33.33 each = 99.99 without the remainder.
            const allocations = allocateLandedCost(100, [
                { id: 1, quantity: 1, unitPrice: 1 },
                { id: 2, quantity: 1, unitPrice: 1 },
                { id: 3, quantity: 1, unitPrice: 1 },
            ]);

            const allocatedTotal = allocations.reduce((sum, line) => sum + line.allocatedCost, 0);
            expect(Math.round(allocatedTotal * 100) / 100).toBe(100);
            expect(allocations[2].allocatedCost).toBe(33.34);
        });

        it('leaves the unit price alone when there are no fees', () => {
            const allocations = allocateLandedCost(0, [{ id: 1, quantity: 4, unitPrice: 25 }]);

            expect(allocations[0].allocatedCost).toBe(0);
            expect(allocations[0].landedCostPerUnit).toBe(25);
        });
    });


    /** A shipped order for the given quantity, plus its single line. */
    async function seedOrder(quantity = 10, unitPrice = '100.00') {
        const expectedDelivery = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

        const [order] = await db
            .insert(purchaseOrders)
            .values({
                orderNumber: 'PO-GRN-001',
                supplierId: testData.suppliers.supplier.id,
                destinationStoreId: testData.stores.warehouse.id,
                orderDate: new Date(),
                deliveryDate: expectedDelivery,
                status: 'shipped',
                totalAmount: (quantity * Number(unitPrice)).toFixed(2),
            })
            .returning();

        const [item] = await db
            .insert(purchaseOrderItems)
            .values({
                purchaseOrderId: order.id,
                productId: testData.products.product.id,
                quantity,
                unitPrice,
                totalPrice: (quantity * Number(unitPrice)).toFixed(2),
            })
            .returning();

        return { order, item, expectedDelivery };
    }

    async function recordPayment(purchaseOrderId: number) {
        await db.insert(purchaseOrderActions).values({
            purchaseOrderId,
            actionType: 'payment_sent',
            performedByUserId: testData.users.admin.id,
        });
    }

    describe('receiving a purchase order', () => {
        it('creates the receipt, books the stock in and marks the order delivered', async () => {
            const { order, item, expectedDelivery } = await seedOrder(10, '100.00');
            await recordPayment(order.id);

            const result = await receiveGoods(db, {
                purchaseOrderId: order.id,
                userId: testData.users.admin.id,
                actualDeliveryDate: new Date(),
                shippingFee: 300,
                customsDuty: 100,
                customsTax: 50,
                brokerageFee: 30,
                additionalFee: 20,
                additionalFeeNote: 'fumigation certificate',
                notes: 'all cartons intact',
            });

            // The receipt carries what the delivery really cost: 500 in fees.
            expect(result.receipt.receiptNumber.startsWith('GRN-')).toBe(true);
            expect(Number(result.receipt.totalAdditionalCost)).toBe(500);
            expect(result.receipt.additionalFeeNote).toBe('fumigation certificate');

            const stored = await db.query.goodsReceipts.findFirst({
                where: eq(goodsReceipts.purchaseOrderId, order.id),
            });
            expect(stored?.receiptNumber).toBe(result.receipt.receiptNumber);

            // Stock arrived in the destination warehouse, with a ledger entry explaining it.
            const stock = await db.query.inventory.findMany();
            expect(stock).toHaveLength(1);
            expect(stock[0].quantity).toBe(10);
            expect(stock[0].storeId).toBe(testData.stores.warehouse.id);

            const movements = await db
                .select()
                .from(stockMovements)
                .where(eq(stockMovements.inventoryId, stock[0].id));
            expect(movements).toHaveLength(1);
            expect(movements[0].delta).toBe(10);
            expect(movements[0].reason).toBe('po_receipt');

            // The line is fully delivered and carries its true unit cost: 100 + 500/10.
            const [storedItem] = await db
                .select()
                .from(purchaseOrderItems)
                .where(eq(purchaseOrderItems.id, item.id));
            expect(storedItem.deliveredQuantity).toBe(10);
            expect(Number(storedItem.landedCostPerUnit)).toBe(150);

            // The order is delivered, and the promised (expected) date is untouched.
            const [deliveredOrder] = await db
                .select()
                .from(purchaseOrders)
                .where(eq(purchaseOrders.id, order.id));
            expect(deliveredOrder.status).toBe('delivered');
            expect(deliveredOrder.deliveryDate?.getTime()).toBe(expectedDelivery.getTime());

            // The receipt also shows up in the order's action history.
            const actions = await db
                .select()
                .from(purchaseOrderActions)
                .where(eq(purchaseOrderActions.purchaseOrderId, order.id));
            const receiptAction = actions.find((action) => action.actionType === 'goods_receipt');
            expect(receiptAction?.actionData?.reference).toBe(result.receipt.receiptNumber);
        });


        it('refuses a second receipt so stock cannot be booked in twice', async () => {
            const { order } = await seedOrder(5, '200.00');
            await recordPayment(order.id);

            await receiveGoods(db, {
                purchaseOrderId: order.id,
                userId: testData.users.admin.id,
                actualDeliveryDate: new Date(),
            });

            await expect(
                receiveGoods(db, {
                    purchaseOrderId: order.id,
                    userId: testData.users.admin.id,
                    actualDeliveryDate: new Date(),
                })
            ).rejects.toThrow(/already been received/);

            const stock = await db.query.inventory.findMany();
            expect(stock[0].quantity).toBe(5);
        });

        it('refuses to book stock in before the supplier is paid', async () => {
            const { order } = await seedOrder(5, '200.00');

            await expect(
                receiveGoods(db, {
                    purchaseOrderId: order.id,
                    userId: testData.users.admin.id,
                    actualDeliveryDate: new Date(),
                })
            ).rejects.toThrow(/Payment must be sent/);

            const stock = await db.query.inventory.findMany();
            expect(stock).toHaveLength(0);
        });

        it('refuses to receive a cancelled order', async () => {
            const { order } = await seedOrder(5, '200.00');
            await recordPayment(order.id);
            await db
                .update(purchaseOrders)
                .set({ status: 'cancelled' })
                .where(eq(purchaseOrders.id, order.id));

            await expect(
                receiveGoods(db, {
                    purchaseOrderId: order.id,
                    userId: testData.users.admin.id,
                    actualDeliveryDate: new Date(),
                })
            ).rejects.toThrow(/cancelled/);
        });
    });

    /**
     * A supplier rarely delivers a whole order in one truck. These tests pin the two halves
     * that matter: only the units that arrived move, and the order stays open until the rest do.
     */
    describe('partial deliveries', () => {
        it('books only the units that arrived and leaves the order open', async () => {
            const { order, item } = await seedOrder(10, '100.00');
            await recordPayment(order.id);

            const result = await receiveGoods(db, {
                purchaseOrderId: order.id,
                userId: testData.users.admin.id,
                actualDeliveryDate: new Date(),
                shippingFee: 200,
                items: [{ itemId: item.id, quantity: 4 }],
            });

            expect(result.fullyReceived).toBe(false);
            expect(result.outstandingQuantity).toBe(6);

            // Only the four units that turned up are in stock.
            const stock = await db.query.inventory.findMany();
            expect(stock[0].quantity).toBe(4);

            // This shipment's fee applies to the four units on it: 100 + 200/4.
            const [storedItem] = await db
                .select()
                .from(purchaseOrderItems)
                .where(eq(purchaseOrderItems.id, item.id));
            expect(storedItem.deliveredQuantity).toBe(4);
            expect(Number(storedItem.landedCostPerUnit)).toBe(150);

            // The receipt records the line it covered, so a shortfall stays auditable.
            const receiptLines = await db
                .select()
                .from(goodsReceiptItems)
                .where(eq(goodsReceiptItems.goodsReceiptId, result.receipt.id));
            expect(receiptLines).toHaveLength(1);
            expect(receiptLines[0].purchaseOrderItemId).toBe(item.id);
            expect(receiptLines[0].quantity).toBe(4);
            expect(Number(receiptLines[0].allocatedCost)).toBe(200);
            expect(Number(receiptLines[0].landedCostPerUnit)).toBe(150);

            // Goods are still owed, so the order is not delivered.
            const [openOrder] = await db
                .select()
                .from(purchaseOrders)
                .where(eq(purchaseOrders.id, order.id));
            expect(openOrder.status).toBe('shipped');
        });

        it('completes the order on the follow-up shipment and re-averages the landed cost', async () => {
            const { order, item } = await seedOrder(10, '100.00');
            await recordPayment(order.id);

            await receiveGoods(db, {
                purchaseOrderId: order.id,
                userId: testData.users.admin.id,
                actualDeliveryDate: new Date(),
                shippingFee: 200,
                items: [{ itemId: item.id, quantity: 4 }],
            });

            const second = await receiveGoods(db, {
                purchaseOrderId: order.id,
                userId: testData.users.admin.id,
                actualDeliveryDate: new Date(),
                // 100 + 120/6 = 120 per unit on this shipment.
                brokerageFee: 120,
                items: [{ itemId: item.id, quantity: 6 }],
            });

            expect(second.fullyReceived).toBe(true);
            expect(second.outstandingQuantity).toBe(0);

            const stock = await db.query.inventory.findMany();
            expect(stock[0].quantity).toBe(10);

            const [storedItem] = await db
                .select()
                .from(purchaseOrderItems)
                .where(eq(purchaseOrderItems.id, item.id));
            expect(storedItem.deliveredQuantity).toBe(10);
            // (4 x 150 + 6 x 120) / 10 = 132 - the earlier units keep their own freight.
            expect(Number(storedItem.landedCostPerUnit)).toBe(132);

            const [deliveredOrder] = await db
                .select()
                .from(purchaseOrders)
                .where(eq(purchaseOrders.id, order.id));
            expect(deliveredOrder.status).toBe('delivered');

            // Two receipts, two ledger entries - nothing booked twice.
            const receipts = await db
                .select()
                .from(goodsReceipts)
                .where(eq(goodsReceipts.purchaseOrderId, order.id));
            expect(receipts).toHaveLength(2);

            const movements = await db
                .select()
                .from(stockMovements)
                .where(eq(stockMovements.inventoryId, stock[0].id));
            expect(movements.map((movement) => movement.delta).sort((a, b) => a - b)).toEqual([4, 6]);
        });

        it('refuses to book in more units than are outstanding', async () => {
            const { order, item } = await seedOrder(10, '100.00');
            await recordPayment(order.id);

            await expect(
                receiveGoods(db, {
                    purchaseOrderId: order.id,
                    userId: testData.users.admin.id,
                    actualDeliveryDate: new Date(),
                    items: [{ itemId: item.id, quantity: 11 }],
                })
            ).rejects.toThrow(/outstanding/);

            // Nothing was stocked, and no receipt was left behind to contradict the stock.
            expect(await db.query.inventory.findMany()).toHaveLength(0);
            expect(await db.query.goodsReceipts.findMany()).toHaveLength(0);
        });

        it('refuses a line that is not part of the order', async () => {
            const { order } = await seedOrder(5, '100.00');
            await recordPayment(order.id);

            await expect(
                receiveGoods(db, {
                    purchaseOrderId: order.id,
                    userId: testData.users.admin.id,
                    actualDeliveryDate: new Date(),
                    items: [{ itemId: 999999, quantity: 1 }],
                })
            ).rejects.toThrow(/not part of purchase order/);
        });
    });
});

