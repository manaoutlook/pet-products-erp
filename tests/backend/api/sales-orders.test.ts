import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { db } from '../../../db';
import {
    deliveryNoteItems,
    deliveryNotes,
    products,
    salesOrderItems,
    salesOrders,
} from '../../../db/schema';
import { eq } from 'drizzle-orm';
import {
    SalesOrderError,
    buildSalesOrderLines,
    issueDeliveryNote,
    orderLineTotals,
    orderTotal,
    recalculateSalesOrderStatus,
    summariseStatus,
} from '../../../server/sales-orders';
import { generateDeliveryNoteNumber, generateSalesOrderNumber } from '../../../server/numbering';
import { cleanDatabase, resetSequences, seedTestData, resetTestDatabase } from '../../helpers/test-db';

/**
 * Sales orders and delivery notes.
 *
 * The money and the status are the two things a customer can see wrong and argue about, so both
 * are pinned here without a database first, then the shipment flow is exercised end to end:
 * partial delivery, the second shipment that closes the order, and the guards that stop a double
 * click from shipping (and billing) more units than were ordered.
 */
describe('Sales Orders & Delivery Notes', () => {
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


    /** An open order with `lines` entries against the same catalogue product. */
    async function seedSalesOrder(
        lines: Array<{ quantity: number; unitPrice?: string }> = [{ quantity: 10, unitPrice: '100.00' }],
        overrides: Partial<typeof salesOrders.$inferInsert> = {}
    ) {
        const total = lines.reduce(
            (sum, line) => sum + line.quantity * Number(line.unitPrice ?? '100'),
            0
        );

        const [order] = await db
            .insert(salesOrders)
            .values({
                orderNumber: generateSalesOrderNumber(),
                customerName: 'Nguyen Van A',
                companyName: 'Pet Shop A',
                contactPerson: 'Mr A',
                phone: '0900000000',
                deliveryAddress: '12 Le Loi, District 1',
                orderDate: new Date(),
                totalAmount: total.toFixed(2),
                status: 'open',
                preparedByUserId: testData.users.admin.id,
                ...overrides,
            })
            .returning();

        const items = await db
            .insert(salesOrderItems)
            .values(
                lines.map((line) => ({
                    salesOrderId: order.id,
                    productId: testData.products.product.id,
                    productCode: testData.products.product.sku,
                    description: testData.products.product.name,
                    quantity: line.quantity,
                    unitPrice: Number(line.unitPrice ?? '100').toFixed(2),
                    totalPrice: (line.quantity * Number(line.unitPrice ?? '100')).toFixed(2),
                    deliveredQuantity: 0,
                }))
            )
            .returning();

        return { order, items };
    }

    describe('status derivation', () => {
        it('is open while nothing has shipped', () => {
            expect(summariseStatus([{ quantity: 10, deliveredQuantity: 0 }])).toBe('open');
        });

        it('is partially delivered once some units shipped', () => {
            expect(summariseStatus([{ quantity: 10, deliveredQuantity: 4 }])).toBe(
                'partially_delivered'
            );
        });

        it('is delivered once every line is covered', () => {
            expect(
                summariseStatus([
                    { quantity: 10, deliveredQuantity: 10 },
                    { quantity: 2, deliveredQuantity: 2 },
                ])
            ).toBe('delivered');
        });

        it('counts a line as complete at its ordered quantity, never above it', () => {
            // An over-delivered line must not make the *rest* of the order look complete.
            expect(
                summariseStatus([
                    { quantity: 5, deliveredQuantity: 99 },
                    { quantity: 5, deliveredQuantity: 0 },
                ])
            ).toBe('partially_delivered');
        });

        it('treats an order with no lines as open', () => {
            expect(summariseStatus([])).toBe('open');
        });

        it('never revives a cancelled order', () => {
            expect(summariseStatus([{ quantity: 1, deliveredQuantity: 1 }], 'cancelled')).toBe(
                'cancelled'
            );
        });
    });

    describe('line and order money', () => {
        it('recomputes a line total from quantity x unit price', () => {
            expect(orderLineTotals({ quantity: 3, unitPrice: 33.33 })).toEqual({
                unitPrice: 33.33,
                totalPrice: 99.99,
            });
            // Money is rounded to cents so the header total matches the printed lines.
            expect(orderLineTotals({ quantity: 2, unitPrice: 12.5 })).toEqual({
                unitPrice: 12.5,
                totalPrice: 25,
            });
        });

        it('adds the lines up, ignoring floating point dust', () => {
            expect(
                orderTotal([
                    { quantity: 3, unitPrice: 0.1 },
                    { quantity: 3, unitPrice: 0.2 },
                ])
            ).toBe(0.9);
        });
    });

    describe('numbering', () => {
        it('issues SO-YYYYMMDD-NNNN and DN-YYYYMMDD-NNNN numbers', () => {
            expect(generateSalesOrderNumber()).toMatch(/^SO-\d{8}-\d{4}$/);
            expect(generateDeliveryNoteNumber()).toMatch(/^DN-\d{8}-\d{4}$/);
        });

        it('uses today for the date stamp', () => {
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            expect(generateSalesOrderNumber()).toContain(today);
            expect(generateDeliveryNoteNumber()).toContain(today);
        });
    });

    describe('buildSalesOrderLines', () => {
        it('snapshots the catalogue code and description and prices the line', async () => {
            const { lines, total } = await buildSalesOrderLines(db, [
                { productId: testData.products.product.id, quantity: 4 },
            ]);

            expect(lines[0]).toMatchObject({
                productId: testData.products.product.id,
                productCode: 'TEST-001',
                description: 'Test Product',
                quantity: 4,
                unitPrice: '100.00',
                totalPrice: '400.00',
            });
            expect(total).toBe(400);
        });

        it('recomputes the total when the client sends its own unit price', async () => {
            const { lines } = await buildSalesOrderLines(db, [
                { productId: testData.products.product.id, quantity: 5, unitPrice: 90 },
            ]);

            expect(lines[0].unitPrice).toBe('90.00');
            expect(lines[0].totalPrice).toBe('450.00');
        });

        it('refuses a product that no longer exists', async () => {
            const [gone] = await db
                .insert(products)
                .values({
                    name: 'Deleted Product',
                    description: 'gone',
                    sku: 'GONE-001',
                    price: '10.00',
                    categoryId: testData.categories.category.id,
                    brandId: testData.brands.brand.id,
                    minStock: 1,
                })
                .returning();

            await db.delete(products).where(eq(products.id, gone.id));

            await expect(
                buildSalesOrderLines(db, [{ productId: gone.id, quantity: 1 }])
            ).rejects.toThrow(SalesOrderError);
        });
    });

    describe('schema constraints', () => {
        it('refuses a duplicate sales order number', async () => {
            const { order } = await seedSalesOrder([{ quantity: 1 }]);

            await expect(
                db.insert(salesOrders).values({
                    orderNumber: order.orderNumber,
                    customerName: 'Someone Else',
                    orderDate: new Date(),
                    totalAmount: '0.00',
                    status: 'open',
                    preparedByUserId: testData.users.admin.id,
                })
            ).rejects.toThrow();
        });

        it('deletes the lines with the order', async () => {
            const { order } = await seedSalesOrder([{ quantity: 2 }]);

            await db.delete(salesOrders).where(eq(salesOrders.id, order.id));

            const lines = await db
                .select()
                .from(salesOrderItems)
                .where(eq(salesOrderItems.salesOrderId, order.id));
            expect(lines).toHaveLength(0);
        });

        it('keeps the delivery note serial unique', async () => {
            const { order, items } = await seedSalesOrder([{ quantity: 2 }]);

            const first = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
                items: [{ salesOrderItemId: items[0].id, deliveredQuantity: 1 }],
            });

            await expect(
                db.insert(deliveryNotes).values({
                    deliveryNoteNumber: first.deliveryNote.deliveryNoteNumber,
                    salesOrderId: order.id,
                    deliveryDate: new Date(),
                    customerName: 'Nguyen Van A',
                    deliveredByUserId: testData.users.admin.id,
                    status: 'issued',
                })
            ).rejects.toThrow();
        });
    });

    describe('issuing delivery notes', () => {
        it('ships the outstanding quantity and closes the order', async () => {
            const { order } = await seedSalesOrder([{ quantity: 4 }]);

            const result = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });

            expect(result.deliveryNote.deliveryNoteNumber).toMatch(/^DN-\d{8}-\d{4}$/);
            expect(result.deliveryNote.customerName).toBe('Nguyen Van A');
            expect(result.deliveryNote.companyName).toBe('Pet Shop A');
            expect(result.deliveryNote.deliveryAddress).toBe('12 Le Loi, District 1');
            expect(result.deliveryNote.deliveredByUserId).toBe(testData.users.admin.id);
            expect(result.items[0]).toMatchObject({
                productCode: 'TEST-001',
                orderedQuantity: 4,
                deliveredQuantity: 4,
            });
            expect(result.status).toBe('delivered');
            expect(result.outstandingQuantity).toBe(0);

            const [stored] = await db.select().from(salesOrders).where(eq(salesOrders.id, order.id));
            expect(stored.status).toBe('delivered');

            const [line] = await db
                .select()
                .from(salesOrderItems)
                .where(eq(salesOrderItems.salesOrderId, order.id));
            expect(line.deliveredQuantity).toBe(4);
        });

        it('records a partial shipment without closing the order', async () => {
            const { order, items } = await seedSalesOrder([{ quantity: 10 }]);

            const first = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
                items: [{ salesOrderItemId: items[0].id, deliveredQuantity: 6 }],
            });

            expect(first.status).toBe('partially_delivered');
            expect(first.outstandingQuantity).toBe(4);

            const second = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
                items: [{ salesOrderItemId: items[0].id, deliveredQuantity: 4 }],
            });

            expect(second.status).toBe('delivered');
            expect(second.outstandingQuantity).toBe(0);

            // Two notes, each reporting the ordered quantity as it was - reprints must not drift.
            const notes = await db
                .select()
                .from(deliveryNotes)
                .where(eq(deliveryNotes.salesOrderId, order.id));
            expect(notes).toHaveLength(2);

            const rows = await db
                .select()
                .from(deliveryNoteItems)
                .where(eq(deliveryNoteItems.deliveryNoteId, first.deliveryNote.id));
            expect(rows[0].orderedQuantity).toBe(10);
            expect(rows[0].deliveredQuantity).toBe(6);
        });

        it('rejects over-delivery instead of shipping more than was ordered', async () => {
            const { order, items } = await seedSalesOrder([{ quantity: 3 }]);

            await expect(
                issueDeliveryNote(db, {
                    salesOrderId: order.id,
                    deliveryDate: new Date(),
                    userId: testData.users.admin.id,
                    items: [{ salesOrderItemId: items[0].id, deliveredQuantity: 4 }],
                })
            ).rejects.toThrow(/only 3 still outstanding/);

            const notes = await db
                .select()
                .from(deliveryNotes)
                .where(eq(deliveryNotes.salesOrderId, order.id));
            expect(notes).toHaveLength(0);
        });

        it('rejects a line that appears twice on the same note', async () => {
            const { order, items } = await seedSalesOrder([{ quantity: 5 }]);

            await expect(
                issueDeliveryNote(db, {
                    salesOrderId: order.id,
                    deliveryDate: new Date(),
                    userId: testData.users.admin.id,
                    items: [
                        { salesOrderItemId: items[0].id, deliveredQuantity: 1 },
                        { salesOrderItemId: items[0].id, deliveredQuantity: 1 },
                    ],
                })
            ).rejects.toThrow(/appears twice/);
        });

        it('rejects zero and fractional quantities', async () => {
            const { order, items } = await seedSalesOrder([{ quantity: 5 }]);

            await expect(
                issueDeliveryNote(db, {
                    salesOrderId: order.id,
                    deliveryDate: new Date(),
                    userId: testData.users.admin.id,
                    items: [{ salesOrderItemId: items[0].id, deliveredQuantity: 0 }],
                })
            ).rejects.toThrow(/whole number above zero/);

            await expect(
                issueDeliveryNote(db, {
                    salesOrderId: order.id,
                    deliveryDate: new Date(),
                    userId: testData.users.admin.id,
                    items: [{ salesOrderItemId: items[0].id, deliveredQuantity: 1.5 }],
                })
            ).rejects.toThrow(/whole number above zero/);
        });


        it('rejects a line belonging to a different order', async () => {
            const { order } = await seedSalesOrder([{ quantity: 5 }]);
            const other = await seedSalesOrder([{ quantity: 5 }]);

            await expect(
                issueDeliveryNote(db, {
                    salesOrderId: order.id,
                    deliveryDate: new Date(),
                    userId: testData.users.admin.id,
                    items: [{ salesOrderItemId: other.items[0].id, deliveredQuantity: 1 }],
                })
            ).rejects.toThrow(/does not belong to order/);
        });

        it('refuses to deliver a cancelled order', async () => {
            const { order } = await seedSalesOrder([{ quantity: 5 }], { status: 'cancelled' });

            await expect(
                issueDeliveryNote(db, {
                    salesOrderId: order.id,
                    deliveryDate: new Date(),
                    userId: testData.users.admin.id,
                })
            ).rejects.toThrow(/is cancelled/);
        });

        it('refuses a second shipment once everything is delivered', async () => {
            const { order } = await seedSalesOrder([{ quantity: 2 }]);

            await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });

            await expect(
                issueDeliveryNote(db, {
                    salesOrderId: order.id,
                    deliveryDate: new Date(),
                    userId: testData.users.admin.id,
                })
            ).rejects.toThrow(/nothing left to deliver/);
        });

        it('404s for an order that does not exist', async () => {
            await expect(
                issueDeliveryNote(db, {
                    salesOrderId: 999999,
                    deliveryDate: new Date(),
                    userId: testData.users.admin.id,
                })
            ).rejects.toThrow(/not found/);
        });

        it('re-derives the stored status from the lines', async () => {
            const { order, items } = await seedSalesOrder([{ quantity: 6 }]);

            await db
                .update(salesOrderItems)
                .set({ deliveredQuantity: 6 })
                .where(eq(salesOrderItems.id, items[0].id));

            expect(await recalculateSalesOrderStatus(db, order.id)).toBe('delivered');

            const [stored] = await db.select().from(salesOrders).where(eq(salesOrders.id, order.id));
            expect(stored.status).toBe('delivered');
        });

    });
});
