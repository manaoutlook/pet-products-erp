import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { db } from '../../../db';
import {
    invoiceCounters,
    salesOrderItems,
    salesOrders,
    vatCompanies,
} from '../../../db/schema';
import { and, eq } from 'drizzle-orm';
import {
    SalesOrderInvoiceError,
    getSalesOrderInvoice,
    issueSalesOrderInvoice,
} from '../../../server/sales-order-invoices';
import { generateSalesOrderNumber } from '../../../server/numbering';
import {
    cleanDatabase,
    resetSequences,
    resetTestDatabase,
    seedTestData,
} from '../../helpers/test-db';

/**
 * The VAT invoice issued for a Sales Order.
 *
 * Three rules are pinned here because they are the ones a customer or a tax inspector can
 * challenge: the number comes from the SELECTED company's sequence, it is written only once
 * (a second open is the same document), and an order without a complete VAT company cannot be
 * invoiced at all.
 */
describe('Sales Order VAT invoice', () => {
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

    async function seedVatOrder(
        snapshot: Partial<typeof salesOrders.$inferInsert> = {},
        total = '1000.00'
    ) {
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

        const [order] = await db
            .insert(salesOrders)
            .values({
                orderNumber: generateSalesOrderNumber(),
                customerName: 'Nguyen Van A',
                companyName: 'Pet Shop A',
                contactPerson: 'Mr A',
                customerTaxId: '0319999999',
                phone: '0900000000',
                deliveryAddress: '12 Le Loi, District 1',
                orderDate: new Date(),
                totalAmount: total,
                status: 'open',
                preparedByUserId: testData.users.admin.id,
                vatCompanyId: company.id,
                vatCompanyCode: company.code,
                vatCompanyName: company.name,
                vatCompanyTaxId: company.taxId,
                vatCompanyAddress: company.address,
                ...snapshot,
            })
            .returning();

        await db.insert(salesOrderItems).values({
            salesOrderId: order.id,
            productId: testData.products.product.id,
            productCode: testData.products.product.sku,
            description: testData.products.product.name,
            quantity: 2,
            unitPrice: '500.00',
            totalPrice: '1000.00',
            deliveredQuantity: 0,
        });

        return { order, company };
    }

    it('allocates the number from the selected VAT company sequence', async () => {
        const { order } = await seedVatOrder();

        const invoice = await issueSalesOrderInvoice(order.id);

        expect(invoice.invoiceNumber).toMatch(/^CI-\d{8}-0001$/);
        expect(invoice.seller.name).toBe('Conqueror International');
        expect(invoice.seller.taxId).toBe('0312362838');
        expect(invoice.buyer.taxId).toBe('0319999999');
        expect(invoice.subtotal).toBe(1000);
        expect(invoice.vatAmount).toBe(100);
        expect(invoice.total).toBe(1100);

        const stored = await db.query.salesOrders.findFirst({
            where: eq(salesOrders.id, order.id),
        });
        expect(stored?.vatInvoiceNumber).toBe(invoice.invoiceNumber);
        expect(stored?.vatInvoiceIssuedAt).toBeTruthy();
    });

    it('prints VAT at the rate stored on the order, not the company’s current rate', async () => {
        // The order was raised while CI charged 5%, and the invoice is issued later.
        const { order, company } = await seedVatOrder({ vatRate: '0.0500' });

        // CI's rate is corrected in between - the issued invoice must not change.
        await db
            .update(vatCompanies)
            .set({ vatRate: '0.1200' })
            .where(eq(vatCompanies.id, company.id));

        const invoice = await issueSalesOrderInvoice(order.id);

        // 1,000 excl. VAT at the snapshotted 5% = 50 VAT, 1,050 total.
        expect(invoice.vatRate).toBeCloseTo(0.05, 4);
        expect(invoice.vatAmount).toBe(50);
        expect(invoice.total).toBe(1050);
    });

    it('returns the same document when issued again, without burning a number', async () => {
        const { order, company } = await seedVatOrder();

        const first = await issueSalesOrderInvoice(order.id);
        const second = await issueSalesOrderInvoice(order.id);

        expect(second.invoiceNumber).toBe(first.invoiceNumber);

        const counter = await db.query.invoiceCounters.findFirst({
            where: and(
                eq(invoiceCounters.counterType, 'VAT_COMPANY'),
                eq(invoiceCounters.vatCompanyId, company.id)
            ),
        });
        expect(counter?.currentNumber).toBe(1);
    });

    it('re-opens the issued invoice from the order', async () => {
        const { order } = await seedVatOrder();
        const issued = await issueSalesOrderInvoice(order.id);

        const reopened = await getSalesOrderInvoice(order.id);
        expect(reopened.invoiceNumber).toBe(issued.invoiceNumber);
        expect(reopened.lines).toHaveLength(1);
    });

    it('refuses to invoice an order that has no VAT company', async () => {
        const { order } = await seedVatOrder({
            vatCompanyId: null,
            vatCompanyCode: null,
            vatCompanyName: null,
            vatCompanyTaxId: null,
            vatCompanyAddress: null,
        });

        await expect(issueSalesOrderInvoice(order.id)).rejects.toBeInstanceOf(
            SalesOrderInvoiceError
        );
    });

    it('refuses an incomplete VAT company snapshot', async () => {
        const { order } = await seedVatOrder({ vatCompanyTaxId: '' });

        await expect(issueSalesOrderInvoice(order.id)).rejects.toMatchObject({ status: 409 });
    });

    it('404s when no invoice has been issued yet', async () => {
        const { order } = await seedVatOrder();

        await expect(getSalesOrderInvoice(order.id)).rejects.toMatchObject({ status: 404 });
    });
});
