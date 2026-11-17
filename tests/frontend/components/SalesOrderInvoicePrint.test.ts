import { describe, it, expect } from 'vitest';
import { buildSalesOrderInvoiceDocument } from '@/components/SalesOrders/SalesOrderInvoicePrint';
import type { SalesOrderInvoicePayload } from '@shared/invoice';

/**
 * The printed VAT invoice of a sales order.
 *
 * The document is the legal paper, so what matters is that it names the VAT company that was
 * selected on the order (not the shop) and that buyer-supplied text can never inject markup.
 */
const invoice: SalesOrderInvoicePayload = {
    salesOrderId: 7,
    orderNumber: 'SO-20261115-0001',
    invoiceNumber: 'CI-20261115-0001',
    invoiceDate: '2026-11-15T10:00:00.000Z',
    seller: {
        name: 'Conqueror International',
        taxId: '0312362838',
        address: '12 Nguyen Hue, District 1',
    },
    sellerMissingFields: [],
    buyer: {
        name: 'Pet Shop A',
        companyName: 'Pet Shop A',
        taxId: '0319999999',
        address: '99 Le Loi, District 1',
        phone: '0900000000',
    },
    lines: [
        {
            lineNumber: 1,
            productCode: 'PC-RM-002',
            description: 'Nasal Hair Trimmer',
            quantity: 2,
            unitPrice: 500000,
            lineTotal: 1000000,
        },
    ],
    subtotal: 1000000,
    vatRate: 0.1,
    vatAmount: 100000,
    total: 1100000,
    currency: 'VND',
};

describe('buildSalesOrderInvoiceDocument', () => {
    it('prints the VAT company letterhead and the allocated number', () => {
        const html = buildSalesOrderInvoiceDocument(invoice);

        expect(html).toContain('Conqueror International');
        expect(html).toContain('0312362838');
        expect(html).toContain('CI-20261115-0001');
        expect(html).toContain('VAT INVOICE');
        expect(html).toContain('SO-20261115-0001');
        expect(html).toContain('Nasal Hair Trimmer');
        expect(html).toContain('0319999999');
    });

    it('escapes buyer text instead of letting it break the sheet', () => {
        const html = buildSalesOrderInvoiceDocument({
            ...invoice,
            buyer: { ...invoice.buyer, name: '<script>alert(1)</script>' },
        });

        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });
});
