import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { db } from '../../../db';
import { eq } from 'drizzle-orm';
import { invoicePayments, invoices, salesOrders, salesTransactions } from '../../../db/schema';
import {
    InvoiceError,
    ensureSalesOrderInvoiceRegistered,
    insertInvoicePayment,
    refreshInvoiceBalance,
    registerInvoice,
    registerPosSaleInvoice,
    vietnamDateOffset,
} from '../../../server/invoices';
import { DEFAULT_PAYMENT_TERM_DAYS } from '../../../shared/invoice-payment';
import { vietnamDayOf } from '../../../shared/vietnam-day';
import { cleanDatabase, resetSequences, resetTestDatabase, seedTestData } from '../../helpers/test-db';

/**
 * The receivables service at the level the callers use it.
 *
 * Every document that owes money - a till sale, an issued sales-order invoice - goes through
 * `registerInvoice`, and every receipt goes through `insertInvoicePayment` +
 * `refreshInvoiceBalance`. The rules pinned here are the ones that would otherwise silently
 * change a receivable: the due date is a *Vietnamese* day offset, a counter sale is due on
 * issue day, and money taken at the till cannot exceed the sale.
 */

let userId: number;
let saleSeq = 0;

beforeAll(async () => {
    await resetTestDatabase();
});

beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    saleSeq = 0;
    const seeded = await seedTestData();
    userId = seeded.users.admin.id;
});

afterEach(async () => {
    await cleanDatabase();
});

/**
 * A till sale to hang the receivable on.
 *
 * `invoices_source_consistency` requires a POS invoice to point at its sale (and a sales-order
 * invoice at its order), so every fixture here writes the source document first.
 */
async function makeSale(invoiceNumber?: string) {
    const [store] = await db.query.stores.findMany();
    const [sale] = await db
        .insert(salesTransactions)
        .values({
            invoiceNumber: invoiceNumber ?? `STR${String(++saleSeq).padStart(3, '0')}-20261119-0001`,
            storeId: store?.id ?? null,
            transactionType: 'STORE_SALE',
            cashierUserId: userId,
            subtotal: '1000000.00',
            vatRate: '0.1000',
            vatAmount: '100000.00',
            totalAmount: '1100000.00',
            paymentMethod: 'CASH',
            status: 'completed',
        })
        .returning();
    return sale;
}

const baseSale = async (invoiceNumber: string) => ({
    invoiceNumber,
    kind: 'RETAIL' as const,
    source: 'POS_SALE' as const,
    salesTransactionId: (await makeSale()).id,
    subtotal: 1_000_000,
    vatRate: 0.1,
    vatAmount: 100_000,
    totalAmount: 1_100_000,
});


describe('registerInvoice', () => {
    it('opens a receivable due after the default term, from today', async () => {
        const before = vietnamDayOf(new Date());

        const invoice = await registerInvoice(db, await baseSale('INV-1'));

        expect(invoice).not.toBeNull();
        expect(invoice!.amountPaid).toBe('0.00');
        expect(invoice!.balanceDue).toBe('1100000.00');
        expect(invoice!.status).toBe('issued');
        // No buyer name supplied: stored as an empty string, never as null.
        expect(invoice!.buyerName).toBe('');
        // The due date is a Vietnamese calendar day, not a UTC slice.
        expect(invoice!.dueDate).toBe(vietnamDateOffset(new Date(), DEFAULT_PAYMENT_TERM_DAYS));
        expect(invoice!.dueDate >= before).toBe(true);
    });

    it('keeps a counter sale on its own issue day when the term is zero', async () => {
        const issuedAt = new Date('2026-11-19T18:30:00.000Z'); // 01:30 on the 20th in Vietnam

        const invoice = await registerInvoice(db, {
            ...(await baseSale('INV-2')),
            issuedAt,
            paymentTermDays: 0,
        });

        expect(invoice!.dueDate).toBe('2026-11-20');
    });

    it('clamps a negative or fractional term instead of producing a past due date', async () => {
        const issuedAt = new Date('2026-11-19T03:00:00.000Z');

        const negative = await registerInvoice(db, {
            ...(await baseSale('INV-3')),
            issuedAt,
            paymentTermDays: -10,
        });
        const fractional = await registerInvoice(db, {
            ...(await baseSale('INV-4')),
            issuedAt,
            paymentTermDays: 2.7,
        });

        expect(negative!.dueDate).toBe('2026-11-19');
        expect(fractional!.dueDate).toBe('2026-11-21');
    });

    it('trims the buyer name and leaves unset relations null', async () => {
        const invoice = await registerInvoice(db, {
            ...(await baseSale('INV-5')),
            buyerName: '   Pet Shop A   ',
        });

        expect(invoice!.buyerName).toBe('Pet Shop A');
        expect(invoice!.salesOrderId).toBeNull();
        expect(invoice!.vatCompanyId).toBeNull();
        expect(invoice!.storeId).toBeNull();
    });

    it('returns null instead of throwing when the number is already taken and conflicts are allowed', async () => {
        await registerInvoice(db, await baseSale('INV-6'));

        const duplicate = await registerInvoice(
            db,
            await baseSale('INV-6'),
            { onConflictDoNothing: true },
        );

        expect(duplicate).toBeNull();
        expect(await db.select().from(invoices).where(eq(invoices.invoiceNumber, 'INV-6'))).toHaveLength(1);
    });
});

describe('registerPosSaleInvoice', () => {
    const posInput = async (invoiceNumber: string, extra: Record<string, unknown> = {}) => ({
        ...(await baseSale(invoiceNumber)),
        paymentMethod: 'cash',
        userId,
        ...extra,
    });

    it('treats an omitted amount as "paid in full at the till"', async () => {
        const invoice = await registerPosSaleInvoice(db, await posInput('INV-7'));

        expect(invoice!.status).toBe('paid');
        expect(invoice!.amountPaid).toBe('1100000.00');
        expect(invoice!.balanceDue).toBe('0.00');

        const payments = await db.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, invoice!.id));
        expect(payments).toHaveLength(1);
        // The receipt is its own document with its own number, and the method is normalised.
        expect(payments[0].receiptNumber).toMatch(/^RCPT-\d{8}-\d{4}$/);
        expect(payments[0].paymentMethod).toBe('CASH');
    });

    it('leaves the sale unpaid when nothing was handed over', async () => {
        const invoice = await registerPosSaleInvoice(db, await posInput('INV-8', { amountPaidNow: 0 }));

        expect(invoice!.status).toBe('issued');
        expect(invoice!.balanceDue).toBe('1100000.00');
        expect(
            await db.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, invoice!.id)),
        ).toHaveLength(0);
    });

    it('records a part payment and keeps the shortfall', async () => {
        const invoice = await registerPosSaleInvoice(db, await posInput('INV-9', { amountPaidNow: 400000 }));

        expect(invoice!.status).toBe('partially_paid');
        expect(invoice!.amountPaid).toBe('400000.00');
        expect(invoice!.balanceDue).toBe('700000.00');
    });

    it('refuses a negative amount paid', async () => {
        await expect(
            registerPosSaleInvoice(db, await posInput('INV-10', { amountPaidNow: -1 })),
        ).rejects.toMatchObject({
            name: 'InvoiceError',
            status: 400,
            message: 'The amount paid cannot be negative',
        });
    });

    it('refuses more money than the sale is worth', async () => {
        await expect(
            registerPosSaleInvoice(db, await posInput('INV-11', { amountPaidNow: 2_000_000 })),
        ).rejects.toThrow(InvoiceError);
        await expect(
            registerPosSaleInvoice(db, await posInput('INV-12', { amountPaidNow: 1_200_000 })),
        ).rejects.toMatchObject({ status: 400 });
    });
});

describe('insertInvoicePayment', () => {
    it('normalises the method and drops blank reference and notes', async () => {
        const invoice = await registerInvoice(db, await baseSale('INV-13'));

        const payment = await insertInvoicePayment(db, {
            invoiceId: invoice!.id,
            amount: 100_000,
            paymentMethod: '  bank transfer  ',
            reference: '   ',
            notes: '   ',
            receivedByUserId: userId,
        });

        expect(payment.paymentMethod).toBe('BANK TRANSFER');
        expect(payment.amount).toBe('100000.00');
        expect(payment.reference).toBeNull();
        expect(payment.notes).toBeNull();
        expect(payment.receiptNumber).toMatch(/^RCPT-\d{8}-\d{4}$/);
    });

    it('keeps a real reference and notes', async () => {
        const invoice = await registerInvoice(db, await baseSale('INV-14'));

        const payment = await insertInvoicePayment(db, {
            invoiceId: invoice!.id,
            amount: 50_000,
            paymentMethod: 'CASH',
            reference: '  VCB-9911  ',
            notes: '  paid by the owner  ',
            receivedByUserId: userId,
        });

        expect(payment.reference).toBe('VCB-9911');
        expect(payment.notes).toBe('paid by the owner');
    });
});

describe('refreshInvoiceBalance / ensureSalesOrderInvoiceRegistered', () => {
    it('refuses to balance an invoice that does not exist', async () => {
        await expect(refreshInvoiceBalance(db, 999_999)).rejects.toMatchObject({
            name: 'InvoiceError',
            status: 404,
            message: 'Invoice not found',
        });
    });

    it('reports a missing sales order instead of creating a nameless invoice', async () => {
        await expect(ensureSalesOrderInvoiceRegistered(db, 999_999)).rejects.toMatchObject({
            status: 404,
            message: 'Sales order not found',
        });
    });

    it('refuses an order whose invoice number has not been issued', async () => {
        const [order] = await db
            .insert(salesOrders)
            .values({
                orderNumber: 'SO-20261119-0001',
                customerName: 'Pet Shop A',
                totalAmount: '1000000.00',
                vatRate: '0.1000',
                preparedByUserId: userId,
            })
            .returning();

        await expect(ensureSalesOrderInvoiceRegistered(db, order.id)).rejects.toMatchObject({
            status: 409,
            message: 'The sales order has no invoice number yet',
        });
    });

    it('copies the order snapshot once, and returns the same row the second time', async () => {
        const [order] = await db
            .insert(salesOrders)
            .values({
                orderNumber: 'SO-20261119-0002',
                customerName: 'Pet Shop A',
                companyName: 'Pet Shop A Co., Ltd.',
                vatInvoiceNumber: 'CI-20261119-0001',
                vatInvoiceIssuedAt: new Date('2026-11-19T03:00:00.000Z'),
                totalAmount: '1000000.00',
                vatRate: '0.1000',
                preparedByUserId: userId,
            })
            .returning();

        const invoice = await ensureSalesOrderInvoiceRegistered(db, order.id);

        expect(invoice).not.toBeNull();
        expect(invoice.invoiceNumber).toBe('CI-20261119-0001');
        expect(invoice.kind).toBe('VAT');
        expect(invoice.source).toBe('SALES_ORDER');
        // The company block is the snapshot stored on the order, not today's profile.
        expect(invoice.buyerName).toBe('Pet Shop A Co., Ltd.');
        // VAT is added on top of the stored VAT-exclusive total.
        expect(invoice.subtotal).toBe('1000000.00');
        expect(invoice.vatAmount).toBe('100000.00');
        expect(invoice.totalAmount).toBe('1100000.00');

        const again = await ensureSalesOrderInvoiceRegistered(db, order.id);
        expect(again.id).toBe(invoice.id);
        expect(await db.select().from(invoices).where(eq(invoices.salesOrderId, order.id))).toHaveLength(1);
    });
});
