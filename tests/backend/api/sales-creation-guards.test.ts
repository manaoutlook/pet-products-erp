import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { db } from '../../../db';
import { vatCompanies, salesTransactions, userStoreAssignments } from '../../../db/schema';
import { cancelSale, createSale, refundSale, SaleError } from '../../../server/sales';
import { cleanDatabase, resetSequences, resetTestDatabase, seedTestData } from '../../helpers/test-db';

/**
 * The guards in front of `createSale`.
 *
 * Every rule here is one the till relies on to refuse a sale *before* any stock moves: an empty
 * cart, a DC sale asked for a VAT invoice, a VAT company that is inactive or still missing its
 * tax code, a VAT sale with no buyer, and a cart line with a nonsense quantity. They all throw
 * `SaleError` with a status the route turns into an HTTP code, so the cashier gets a sentence
 * they can act on rather than a 500.
 */

describe('createSale guards', () => {
    let seeded: Awaited<ReturnType<typeof seedTestData>>;
    let userId: number;

    beforeAll(async () => {
        await resetTestDatabase();
    });

    beforeEach(async () => {
        await cleanDatabase();
        await resetSequences();
        seeded = await seedTestData();
        userId = seeded.users.admin.id;
    });

    afterEach(async () => {
        await cleanDatabase();
    });

    const baseInput = () => ({
        userId,
        items: [{ productId: seeded.products.product.id, quantity: 1 }],
        paymentMethod: 'CASH',
    });

    const completeVatCompany = () => ({
        code: 'CI',
        name: 'Conqueror International',
        taxId: '0312362838',
        address: '12 Nguyen Hue',
        vatRate: '0.1000',
        isActive: true,
    });

    const assignStore = () =>
        db.insert(userStoreAssignments).values({ userId, storeId: seeded.stores.store1.id });

    it('refuses an empty cart', async () => {
        await expect(createSale({ ...baseInput(), items: [] })).rejects.toMatchObject({
            name: 'SaleError',
            status: 400,
            message: 'At least one item is required',
        });
    });

    it('refuses a sale with no payment method', async () => {
        await expect(createSale({ ...baseInput(), paymentMethod: '' })).rejects.toMatchObject({
            status: 400,
            message: 'Payment method is required',
        });
    });

    it('refuses a store sale for a user with no store assignment', async () => {
        await expect(createSale(baseInput())).rejects.toMatchObject({
            name: 'SaleError',
            status: 403,
            message: 'User is not assigned to any store',
        });
    });

    it('refuses to issue a VAT invoice for a DC sale', async () => {
        const [company] = await db.insert(vatCompanies).values(completeVatCompany()).returning();

        await expect(
            createSale({
                ...baseInput(),
                transactionType: 'DC_SALE',
                withVat: true,
                vatCompanyId: company.id,
            }),
        ).rejects.toMatchObject({
            status: 400,
            message: 'A VAT invoice cannot be issued for a DC sale',
        });
    });

    it('refuses VAT with no company chosen', async () => {
        await assignStore();

        await expect(createSale({ ...baseInput(), withVat: true })).rejects.toMatchObject({
            status: 400,
            message: 'Select the company that issues the VAT invoice',
        });
    });

    it('refuses a VAT company that does not exist', async () => {
        await assignStore();

        await expect(
            createSale({ ...baseInput(), withVat: true, vatCompanyId: 9999 }),
        ).rejects.toMatchObject({
            status: 400,
            message: 'The selected VAT company does not exist',
        });
    });

    it('refuses an inactive VAT company', async () => {
        const [company] = await db
            .insert(vatCompanies)
            .values({ ...completeVatCompany(), isActive: false })
            .returning();
        await assignStore();

        await expect(
            createSale({ ...baseInput(), withVat: true, vatCompanyId: company.id }),
        ).rejects.toMatchObject({
            status: 400,
            message: 'VAT invoices cannot be issued under Conqueror International because it is inactive',
        });
    });

    it('refuses a VAT company whose letterhead is still incomplete', async () => {
        const [company] = await db
            .insert(vatCompanies)
            .values({ ...completeVatCompany(), taxId: '   ', address: '' })
            .returning();
        await assignStore();

        await expect(
            createSale({ ...baseInput(), withVat: true, vatCompanyId: company.id }),
        ).rejects.toMatchObject({
            status: 400,
            message: 'Conqueror International cannot issue a VAT invoice: Tax code, Address missing',
        });
    });

    it('refuses a VAT sale without a buyer', async () => {
        const [company] = await db.insert(vatCompanies).values(completeVatCompany()).returning();
        await assignStore();

        await expect(
            createSale({ ...baseInput(), withVat: true, vatCompanyId: company.id }),
        ).rejects.toMatchObject({
            status: 400,
            message: 'A VAT invoice needs the buyer name and address',
        });
    });

    it('refuses a cart line with a nonsense quantity or product', async () => {
        await assignStore();

        await expect(
            createSale({ ...baseInput(), items: [{ productId: seeded.products.product.id, quantity: 0 }] }),
        ).rejects.toMatchObject({ status: 400, message: 'Invalid item data' });

        await expect(
            createSale({ ...baseInput(), items: [{ productId: -3, quantity: 1 }] }),
        ).rejects.toBeInstanceOf(SaleError);
    });
});

describe('refundSale / cancelSale guards', () => {
    let seeded: Awaited<ReturnType<typeof seedTestData>>;
    let userId: number;

    beforeEach(async () => {
        await cleanDatabase();
        await resetSequences();
        seeded = await seedTestData();
        userId = seeded.users.admin.id;
    });

    const makeSale = async (overrides: Record<string, unknown> = {}) => {
        const [sale] = await db
            .insert(salesTransactions)
            .values({
                invoiceNumber: `STR001-20261119-${String(Math.floor(Math.random() * 9000) + 1000)}`,
                storeId: seeded.stores.store1.id,
                transactionType: 'STORE_SALE',
                cashierUserId: userId,
                subtotal: '100000.00',
                vatRate: '0.0000',
                vatAmount: '0.00',
                totalAmount: '100000.00',
                paymentMethod: 'CASH',
                status: 'completed',
                ...overrides,
            })
            .returning();
        return sale;
    };

    it('refuses a refund of an unknown sale', async () => {
        await expect(
            refundSale({ transactionId: 999_999, userId }),
        ).rejects.toMatchObject({ status: 404, message: 'Sales transaction not found' });
    });

    it('refuses to refund a sale twice', async () => {
        const sale = await makeSale({ status: 'refunded' });

        await expect(refundSale({ transactionId: sale.id, userId })).rejects.toMatchObject({
            status: 400,
            message: 'Transaction has already been refunded',
        });
    });

    it('refuses to refund a cancelled sale', async () => {
        const sale = await makeSale({ status: 'cancelled' });

        await expect(refundSale({ transactionId: sale.id, userId })).rejects.toMatchObject({
            status: 400,
            message: 'Cannot refund a voided or cancelled transaction',
        });
    });

    it('refuses to refund a sale that is not completed', async () => {
        const sale = await makeSale({ status: 'pending' });

        await expect(refundSale({ transactionId: sale.id, userId })).rejects.toMatchObject({
            status: 400,
            message: 'Cannot refund a transaction in status "pending"',
        });
    });

    it('refuses a zero, negative or non-numeric refund', async () => {
        const sale = await makeSale();

        for (const refundAmount of [0, -100, 'abc']) {
            await expect(
                refundSale({ transactionId: sale.id, userId, refundAmount: refundAmount as never }),
            ).rejects.toMatchObject({ message: 'Refund amount must be greater than zero' });
        }
    });

    it('refuses a refund larger than the sale', async () => {
        const sale = await makeSale();

        await expect(
            refundSale({ transactionId: sale.id, userId, refundAmount: 100_001 }),
        ).rejects.toMatchObject({ status: 400, message: 'Refund amount cannot exceed transaction total' });
    });

    it('refuses to cancel an unknown sale', async () => {
        await expect(cancelSale({ transactionId: 999_999, userId })).rejects.toMatchObject({
            status: 404,
        });
    });

    it('refuses to cancel a sale that is no longer completed', async () => {
        const sale = await makeSale({ status: 'refunded' });

        await expect(cancelSale({ transactionId: sale.id, userId })).rejects.toMatchObject({
            status: 400,
            message: 'Only completed transactions can be cancelled',
        });
    });
});

