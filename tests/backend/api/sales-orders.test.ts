import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { db } from '../../../db';
import {
    customerProfiles,
    deliveryNoteItems,
    deliveryNotes,
    inventory,
    products,
    salesOrderItems,
    salesOrders,
    stockMovements,
    vatCompanies,
} from '../../../db/schema';
import { eq, isNull } from 'drizzle-orm';
import {
    SalesOrderError,
    buildSalesOrderLines,
    cancelDeliveryNote,
    issueDeliveryNote,
    orderLineTotals,
    orderTotal,
    recalculateSalesOrderStatus,
    resolveCustomerTaxId,
    resyncUnsignedDeliveredOrders,
    summariseStatus,
} from '../../../server/sales-orders';
import { SalesOrderStockError, assertStockAvailable } from '../../../server/sales-order-stock';
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

        // The goods issue needs a shelf to take units off. Orders in this suite ship from the
        // Distribution Centre (`store_id IS NULL`); tests that ship from a shop add its own row.
        await db.insert(inventory).values({
            productId: testData.products.product.id,
            storeId: null,
            quantity: 1000,
            inventoryType: 'DC',
        });
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

        it('waits for the signature once everything shipped unsigned', () => {
            // Printing the note is not proof of delivery - the signed copy is.
            expect(
                summariseStatus(
                    [
                        { quantity: 10, deliveredQuantity: 10 },
                        { quantity: 2, deliveredQuantity: 2 },
                    ],
                    'open',
                    1
                )
            ).toBe('awaiting_signature');
        });

        it('stays partially delivered while units are still owed, signed or not', () => {
            expect(
                summariseStatus([{ quantity: 10, deliveredQuantity: 6 }], 'open', 1)
            ).toBe('partially_delivered');
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

    describe('product prices', () => {
        /** A catalogue product with the given price columns, for the guard tests below. */
        async function seedPricedProduct(overrides: {
            sku: string;
            name: string;
            landingPrice?: string | null;
            b2bPrice?: string | null;
            b2cPrice?: string | null;
        }) {
            const [product] = await db
                .insert(products)
                .values({
                    name: overrides.name,
                    description: overrides.name,
                    sku: overrides.sku,
                    price: '100.00',
                    landingPrice: overrides.landingPrice ?? null,
                    b2bPrice: overrides.b2bPrice ?? null,
                    b2cPrice: overrides.b2cPrice ?? null,
                    categoryId: testData.categories.category.id,
                    brandId: testData.brands.brand.id,
                    minStock: 1,
                })
                .returning();

            return product;
        }

        it('refuses a product with no Landing, B2B or B2C price and says what to fill in', async () => {
            const unpriced = await seedPricedProduct({
                sku: 'UNPRICED-001',
                name: 'Unpriced Feed',
            });

            const error = await buildSalesOrderLines(db, [
                { productId: unpriced.id, quantity: 2 },
            ]).catch((thrown) => thrown);

            expect(error).toBeInstanceOf(SalesOrderError);
            expect(error.status).toBe(400);
            // The message names the product and every blank field, so the user can fix it.
            expect(error.message).toContain('1 product is missing prices');
            expect(error.message).toContain(
                'UNPRICED-001 (Unpriced Feed): Landing Price, B2B Price, B2C Price'
            );
            expect(error.suggestion).toContain(
                'fill in Landing Price, B2B Price and B2C Price'
            );
        });

        it('lists only the blank fields when a product is partially priced', async () => {
            const halfPriced = await seedPricedProduct({
                sku: 'HALF-001',
                name: 'Half Priced Food',
                landingPrice: '80.00',
                b2bPrice: '100.00',
                b2cPrice: null,
            });

            const error = await buildSalesOrderLines(db, [
                { productId: halfPriced.id, quantity: 1 },
            ]).catch((thrown) => thrown);

            expect(error).toBeInstanceOf(SalesOrderError);
            expect(error.message).toContain('HALF-001 (Half Priced Food): B2C Price.');
            expect(error.message).not.toContain('Landing Price');
            expect(error.message).not.toContain('B2B Price');
        });

        it('treats a price of 0 as filled in', async () => {
            const free = await seedPricedProduct({
                sku: 'FREE-001',
                name: 'Sample Sachet',
                landingPrice: '0.00',
                b2bPrice: '0.00',
                b2cPrice: '0.00',
            });

            const { lines, total } = await buildSalesOrderLines(db, [
                { productId: free.id, quantity: 3 },
            ]);

            expect(lines[0]).toMatchObject({ productCode: 'FREE-001', unitPrice: '100.00' });
            expect(total).toBe(300);
        });

        it('reports every offending product in one message', async () => {
            const first = await seedPricedProduct({ sku: 'NOPRICE-001', name: 'No Price A' });
            const second = await seedPricedProduct({
                sku: 'NOPRICE-002',
                name: 'No Price B',
                landingPrice: '10.00',
                b2bPrice: '20.00',
                b2cPrice: null,
            });

            const error = await buildSalesOrderLines(db, [
                { productId: first.id, quantity: 1 },
                { productId: second.id, quantity: 1 },
            ]).catch((thrown) => thrown);

            expect(error).toBeInstanceOf(SalesOrderError);
            expect(error.message).toContain('2 products are missing prices');
            expect(error.message).toContain('NOPRICE-001 (No Price A)');
            expect(error.message).toContain('NOPRICE-002 (No Price B): B2C Price.');
        });

        it('accepts an unpriced product when the guard is switched off for an edit', async () => {
            // Orders raised before this rule must stay editable - filling the product in is the
            // fix, not losing the order.
            const legacy = await seedPricedProduct({ sku: 'LEGACY-001', name: 'Legacy Food' });

            const { lines } = await buildSalesOrderLines(
                db,
                [{ productId: legacy.id, quantity: 2 }],
                { requirePrices: false }
            );

            expect(lines[0]).toMatchObject({ productCode: 'LEGACY-001', quantity: 2 });
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
        it('copies the VAT company snapshot from the order onto the note', async () => {
            const [company] = await db
                .insert(vatCompanies)
                .values({
                    code: 'CI',
                    name: 'Conqueror International',
                    taxId: '0312362838',
                    address: '12 Nguyen Hue, District 1',
                    isActive: true,
                })
                .returning();

            const { order, items } = await seedSalesOrder([{ quantity: 1 }], {
                vatCompanyId: company.id,
                vatCompanyCode: company.code,
                vatCompanyName: company.name,
                vatCompanyTaxId: company.taxId,
                vatCompanyAddress: company.address,
            });

            const result = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
                items: [{ salesOrderItemId: items[0].id, deliveredQuantity: 1 }],
            });

            // A reprint of the note must name the company that issued the order, even if the
            // company record is corrected afterwards - hence the snapshot, not a join.
            expect(result.deliveryNote.vatCompanyId).toBe(company.id);
            expect(result.deliveryNote.vatCompanyCode).toBe('CI');
            expect(result.deliveryNote.vatCompanyName).toBe('Conqueror International');
            expect(result.deliveryNote.vatCompanyTaxId).toBe('0312362838');
            expect(result.deliveryNote.vatCompanyAddress).toBe('12 Nguyen Hue, District 1');
        });

        it('ships the outstanding quantity and waits for the signature', async () => {
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
            // The goods are out, but the note travels unsigned - only the signed copy closes it.
            expect(result.status).toBe('awaiting_signature');
            expect(result.outstandingQuantity).toBe(0);

            const [stored] = await db.select().from(salesOrders).where(eq(salesOrders.id, order.id));
            expect(stored.status).toBe('awaiting_signature');

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

            expect(second.status).toBe('awaiting_signature');
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

        it('holds a fully shipped order at awaiting_signature until the note is signed', async () => {
            const { order } = await seedSalesOrder([{ quantity: 3 }]);

            await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });

            // The unsigned note is what keeps the order open, even though nothing is owed.
            expect(await recalculateSalesOrderStatus(db, order.id)).toBe('awaiting_signature');
        });

        it('repairs orders closed under the old rule (delivered without a signature)', async () => {
            const { order } = await seedSalesOrder([{ quantity: 3 }]);

            await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });

            // Pretend this order was closed before signatures were required.
            await db
                .update(salesOrders)
                .set({ status: 'delivered' })
                .where(eq(salesOrders.id, order.id));

            expect(await resyncUnsignedDeliveredOrders(db)).toBe(1);

            const [stored] = await db.select().from(salesOrders).where(eq(salesOrders.id, order.id));
            expect(stored.status).toBe('awaiting_signature');
        });

    });

    /**
     * The stock side of the two documents.
     *
     * Ordered here on purpose: the order is a promise (checked, never deducted), the delivery
     * note is the goods issue (deducts, and points at the signed sheet). Deducting on both would
     * take the units out twice; deducting on neither is what let an order ship without moving
     * inventory at all.
     */
    describe('stock movements', () => {
        /** The Distribution Centre row (`inventory.store_id IS NULL`). */
        async function dcStock() {
            const [row] = await db
                .select()
                .from(inventory)
                .where(isNull(inventory.storeId));
            return row;
        }

        it('checks an order against stock without taking anything off the shelf', async () => {
            const { order } = await seedSalesOrder([{ quantity: 4 }]);

            await assertStockAvailable(db, {
                storeId: order.storeId,
                lines: [
                    {
                        productId: testData.products.product.id,
                        productCode: testData.products.product.sku,
                        quantity: 4,
                    },
                ],
            });

            expect((await dcStock()).quantity).toBe(1000);
            expect(await db.select().from(stockMovements)).toHaveLength(0);
        });

        it('refuses an order the location cannot cover, naming the product', async () => {
            await db.update(inventory).set({ quantity: 2 }).where(isNull(inventory.storeId));

            await expect(
                assertStockAvailable(db, {
                    storeId: null,
                    lines: [
                        {
                            productId: testData.products.product.id,
                            productCode: testData.products.product.sku,
                            quantity: 5,
                        },
                    ],
                })
            ).rejects.toThrow(/only 2 in stock at the Distribution Centre/);
        });

        it('takes the delivered units off the Distribution Centre and links the movement to the note', async () => {
            const { order } = await seedSalesOrder([{ quantity: 4 }]);

            const { deliveryNote } = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });

            // The note snapshots the order's location (null = DC), not a separate choice.
            expect(deliveryNote.storeId).toBeNull();
            expect((await dcStock()).quantity).toBe(996);

            const movements = await db.select().from(stockMovements);
            expect(movements).toHaveLength(1);
            expect(movements[0]).toMatchObject({
                delta: -4,
                reason: 'sale',
                transactionType: 'SALES_ORDER',
                refType: 'delivery_note',
                refId: deliveryNote.id,
                quantityBefore: 1000,
                quantityAfter: 996,
                userId: testData.users.admin.id,
            });
            expect(movements[0].note).toContain(order.orderNumber);
        });

        it('deducts only what a partial note actually shipped', async () => {
            const { order, items } = await seedSalesOrder([{ quantity: 10 }]);

            const first = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
                items: [{ salesOrderItemId: items[0].id, deliveredQuantity: 3 }],
            });

            expect((await dcStock()).quantity).toBe(997);
            expect(first.outstandingQuantity).toBe(7);

            await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });

            // The balance (7) leaves the shelf on the second note; 10 in total.
            expect((await dcStock()).quantity).toBe(990);
        });

        it('ships from the order store when one is chosen, leaving the DC alone', async () => {
            const [storeStock] = await db
                .insert(inventory)
                .values({
                    productId: testData.products.product.id,
                    storeId: testData.stores.store1.id,
                    quantity: 5,
                    inventoryType: 'STORE',
                })
                .returning();

            const { order } = await seedSalesOrder([{ quantity: 2 }], {
                storeId: testData.stores.store1.id,
            });

            const { deliveryNote } = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });

            expect(deliveryNote.storeId).toBe(testData.stores.store1.id);
            expect((await dcStock()).quantity).toBe(1000);

            const [stored] = await db
                .select()
                .from(inventory)
                .where(eq(inventory.id, storeStock.id));
            expect(stored.quantity).toBe(3);

            const [movement] = await db.select().from(stockMovements);
            expect(movement).toMatchObject({
                inventoryId: storeStock.id,
                storeId: testData.stores.store1.id,
                delta: -2,
            });
        });

        it('refuses a note the shelf cannot cover and rolls the whole shipment back', async () => {
            await db.update(inventory).set({ quantity: 1 }).where(isNull(inventory.storeId));
            const { order, items } = await seedSalesOrder([{ quantity: 3 }]);

            // The route issues a note inside one transaction, so a refused goods issue rolls the
            // note, the tallies and the status back together.
            await expect(
                db.transaction((tx) =>
                    issueDeliveryNote(tx, {
                        salesOrderId: order.id,
                        deliveryDate: new Date(),
                        userId: testData.users.admin.id,
                    })
                )
            ).rejects.toBeInstanceOf(SalesOrderStockError);

            // No note, no line tally, no movement - the shipment never happened.
            expect(await db.select().from(deliveryNotes)).toHaveLength(0);
            const [line] = await db
                .select()
                .from(salesOrderItems)
                .where(eq(salesOrderItems.id, items[0].id));
            expect(line.deliveredQuantity).toBe(0);
            expect(await db.select().from(stockMovements)).toHaveLength(0);
            expect((await dcStock()).quantity).toBe(1);

            const [storedOrder] = await db
                .select()
                .from(salesOrders)
                .where(eq(salesOrders.id, order.id));
            expect(storedOrder.status).toBe('open');
        });

        it('refuses a note when the location has no stock record at all', async () => {
            await db.delete(inventory).where(isNull(inventory.storeId));
            const { order } = await seedSalesOrder([{ quantity: 1 }]);

            await expect(
                issueDeliveryNote(db, {
                    salesOrderId: order.id,
                    deliveryDate: new Date(),
                    userId: testData.users.admin.id,
                })
            ).rejects.toThrow(/has no stock record at the Distribution Centre/);
        });
    });

    /**
     * Cancelling a delivery note is the reverse of issuing it, never a delete.
     *
     * The note took the units off the shelf, so cancelling it must put exactly those units back
     * on the same inventory row - and only for a note the customer has not signed and an order
     * with no VAT invoice, because those are returns, not cancellations.
     */
    describe('cancelling delivery notes', () => {
        async function dcStock() {
            const [row] = await db
                .select()
                .from(inventory)
                .where(isNull(inventory.storeId));
            return row;
        }

        it('returns the units with a RETURN movement linked to the note', async () => {
            const { order } = await seedSalesOrder([{ quantity: 4 }]);
            const { deliveryNote } = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });
            expect((await dcStock()).quantity).toBe(996);

            const result = await cancelDeliveryNote(db, {
                deliveryNoteId: deliveryNote.id,
                userId: testData.users.admin.id,
                reason: 'wrong truck',
            });

            expect(result.restoredUnits).toBe(4);
            expect(result.orderStatus).toBe('open');
            expect(result.deliveryNote.status).toBe('cancelled');
            expect(result.deliveryNote.cancelledByUserId).toBe(testData.users.admin.id);
            expect(result.deliveryNote.cancelReason).toBe('wrong truck');
            expect(result.deliveryNote.cancelledAt).toBeInstanceOf(Date);
            expect((await dcStock()).quantity).toBe(1000);

            const movements = await db.select().from(stockMovements);
            expect(movements).toHaveLength(2);
            const returned = movements.find((movement) => movement.reason === 'cancel');
            expect(returned).toMatchObject({
                delta: 4,
                transactionType: 'RETURN',
                refType: 'delivery_note',
                refId: deliveryNote.id,
                quantityBefore: 996,
                quantityAfter: 1000,
                userId: testData.users.admin.id,
            });
            expect(returned?.note).toContain(deliveryNote.deliveryNoteNumber);
            expect(returned?.note).toContain(order.orderNumber);
            expect(returned?.note).toContain('wrong truck');
        });

        it('reduces the line tally so the order can ship again', async () => {
            const { order, items } = await seedSalesOrder([{ quantity: 4 }]);
            const { deliveryNote } = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });

            await cancelDeliveryNote(db, {
                deliveryNoteId: deliveryNote.id,
                userId: testData.users.admin.id,
            });

            const [line] = await db
                .select()
                .from(salesOrderItems)
                .where(eq(salesOrderItems.id, items[0].id));
            expect(line.deliveredQuantity).toBe(0);

            const again = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });
            expect(again.items[0].deliveredQuantity).toBe(4);
            expect((await dcStock()).quantity).toBe(996);
        });

        it('restores only the cancelled note when another shipment stays out', async () => {
            const { order, items } = await seedSalesOrder([{ quantity: 10 }]);

            const first = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
                items: [{ salesOrderItemId: items[0].id, deliveredQuantity: 3 }],
            });
            await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
                items: [{ salesOrderItemId: items[0].id, deliveredQuantity: 7 }],
            });
            expect((await dcStock()).quantity).toBe(990);

            const result = await cancelDeliveryNote(db, {
                deliveryNoteId: first.deliveryNote.id,
                userId: testData.users.admin.id,
            });

            expect(result.restoredUnits).toBe(3);
            expect(result.orderStatus).toBe('partially_delivered');
            expect((await dcStock()).quantity).toBe(993);

            const [line] = await db
                .select()
                .from(salesOrderItems)
                .where(eq(salesOrderItems.id, items[0].id));
            expect(line.deliveredQuantity).toBe(7);
        });

        it('is idempotent - a second cancel does not restock twice', async () => {
            const { order } = await seedSalesOrder([{ quantity: 2 }]);
            const { deliveryNote } = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });

            await cancelDeliveryNote(db, {
                deliveryNoteId: deliveryNote.id,
                userId: testData.users.admin.id,
            });
            const second = await cancelDeliveryNote(db, {
                deliveryNoteId: deliveryNote.id,
                userId: testData.users.admin.id,
            });

            expect(second.restoredUnits).toBe(0);
            expect(second.deliveryNote.status).toBe('cancelled');
            expect((await dcStock()).quantity).toBe(1000);
            expect(await db.select().from(stockMovements)).toHaveLength(2);
        });

        it('refuses a note the customer already signed', async () => {
            const { order } = await seedSalesOrder([{ quantity: 2 }]);
            const { deliveryNote } = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
                customerConfirmed: true,
            });

            await expect(
                cancelDeliveryNote(db, {
                    deliveryNoteId: deliveryNote.id,
                    userId: testData.users.admin.id,
                })
            ).rejects.toThrow(/signed by the customer/);

            const [stored] = await db
                .select()
                .from(deliveryNotes)
                .where(eq(deliveryNotes.id, deliveryNote.id));
            expect(stored.status).toBe('issued');
            expect((await dcStock()).quantity).toBe(998);
            expect(await db.select().from(stockMovements)).toHaveLength(1);
        });

        it('refuses a note whose order carries a VAT invoice', async () => {
            const { order } = await seedSalesOrder([{ quantity: 2 }]);
            const { deliveryNote } = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });
            // The invoice is raised after delivery, so the guard has to read the order live.
            await db
                .update(salesOrders)
                .set({ vatInvoiceNumber: 'INV-0001' })
                .where(eq(salesOrders.id, order.id));

            await expect(
                cancelDeliveryNote(db, {
                    deliveryNoteId: deliveryNote.id,
                    userId: testData.users.admin.id,
                })
            ).rejects.toThrow(/VAT invoice/);

            expect((await dcStock()).quantity).toBe(998);
        });

        it('returns the units to the shop the goods actually left from', async () => {
            const [storeStock] = await db
                .insert(inventory)
                .values({
                    productId: testData.products.product.id,
                    storeId: testData.stores.store1.id,
                    quantity: 5,
                    inventoryType: 'STORE',
                })
                .returning();

            const { order } = await seedSalesOrder([{ quantity: 2 }], {
                storeId: testData.stores.store1.id,
            });
            const { deliveryNote } = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });

            await cancelDeliveryNote(db, {
                deliveryNoteId: deliveryNote.id,
                userId: testData.users.admin.id,
            });

            const [stored] = await db
                .select()
                .from(inventory)
                .where(eq(inventory.id, storeStock.id));
            expect(stored.quantity).toBe(5);
            // The DC never saw these units, so its row must not move either way.
            expect((await dcStock()).quantity).toBe(1000);
        });

        it('merges duplicate products into one stock movement', async () => {
            // Two order lines for the same product: the ledger must see one +5, not two rows.
            const { order } = await seedSalesOrder([{ quantity: 2 }, { quantity: 3 }]);
            const { deliveryNote } = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });
            expect((await dcStock()).quantity).toBe(995);

            const result = await cancelDeliveryNote(db, {
                deliveryNoteId: deliveryNote.id,
                userId: testData.users.admin.id,
            });

            expect(result.restoredUnits).toBe(5);
            const returns = (await db.select().from(stockMovements)).filter(
                (movement) => movement.reason === 'cancel'
            );
            expect(returns).toHaveLength(1);
            expect(returns[0]).toMatchObject({ delta: 5, quantityAfter: 1000 });
        });

        it('rolls the cancellation back when the shelf row has disappeared', async () => {
            const { order, items } = await seedSalesOrder([{ quantity: 4 }]);
            const { deliveryNote } = await issueDeliveryNote(db, {
                salesOrderId: order.id,
                deliveryDate: new Date(),
                userId: testData.users.admin.id,
            });
            await db.delete(inventory).where(isNull(inventory.storeId));

            // The route runs this inside one transaction: a refused restock must not leave the
            // note cancelled with its units still missing from the shelf.
            await expect(
                db.transaction((tx) =>
                    cancelDeliveryNote(tx, {
                        deliveryNoteId: deliveryNote.id,
                        userId: testData.users.admin.id,
                    })
                )
            ).rejects.toBeInstanceOf(SalesOrderStockError);

            const [stored] = await db
                .select()
                .from(deliveryNotes)
                .where(eq(deliveryNotes.id, deliveryNote.id));
            expect(stored.status).toBe('issued');
            expect(stored.cancelledAt).toBeNull();

            const [line] = await db
                .select()
                .from(salesOrderItems)
                .where(eq(salesOrderItems.id, items[0].id));
            expect(line.deliveredQuantity).toBe(4);
        });

        it('404s for a note that does not exist', async () => {
            await expect(
                cancelDeliveryNote(db, {
                    deliveryNoteId: 999999,
                    userId: testData.users.admin.id,
                })
            ).rejects.toBeInstanceOf(SalesOrderError);
        });
    });

    /**
     * The buyer tax code is Customer Master data. The route resolves it from the profile inside
     * the order transaction, so a stale tab (or a hand-written request) cannot store a code the
     * customer master does not have. Walk-in orders have no profile and keep what was typed.
     */
    describe('resolveCustomerTaxId', () => {
        async function seedCustomer(taxId: string) {
            const [profile] = await db
                .insert(customerProfiles)
                .values({
                    mobileNumber: '0900000001',
                    companyName: 'Pet Shop A',
                    contactPerson: 'Ms Lan',
                    email: 'lan@petshopa.example',
                    address: '99 Le Loi',
                    taxId,
                    customerType: 'B2B',
                })
                .returning();
            return profile;
        }

        it('uses the customer master code even when the request sends another', async () => {
            const profile = await seedCustomer('0319999999');

            await expect(resolveCustomerTaxId(db, profile.id, '0310000000')).resolves.toBe(
                '0319999999'
            );
        });

        it('keeps the submitted code for a walk-in with no profile', async () => {
            await expect(resolveCustomerTaxId(db, null, '0310000000')).resolves.toBe('0310000000');
        });

        it('keeps the submitted code when the profile no longer exists', async () => {
            await expect(resolveCustomerTaxId(db, 999999, '0310000000')).resolves.toBe(
                '0310000000'
            );
        });
    });
});
