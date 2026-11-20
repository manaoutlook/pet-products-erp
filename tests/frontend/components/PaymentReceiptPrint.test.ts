import { describe, it, expect } from 'vitest';
import {
  buildPaymentReceiptDocument,
  type CustomerReceipt,
} from '@/components/Receipts/PaymentReceiptPrint';

/**
 * The printed customer receipt (`RCPT-…`).
 *
 * What matters on paper: it names the company that ISSUED the invoice (not whatever the shop is
 * called today), it prints the numbers stored on the receipt register, a voided receipt is
 * recognisable, and buyer-supplied text cannot inject markup.
 */

const receipt: CustomerReceipt = {
  id: 4,
  receiptNumber: 'RCPT-20261117-0004',
  amount: 200000,
  paymentMethod: 'BANK_TRANSFER',
  paidAt: '2026-11-17T11:10:00.000Z',
  reference: 'VCB-884422',
  notes: null,
  voided: false,
  voidedAt: null,
  voidReason: null,
  receivedBy: { id: 1, username: 'admin' },
  store: null,
  paidBefore: 0,
  balanceAfter: 128500,
  invoice: {
    id: 10,
    invoiceNumber: 'CI-20261117-0004',
    source: 'SALES_ORDER',
    kind: 'VAT',
    buyerName: 'Acme Stationery',
    subtotal: 300000,
    vatRate: 0.095,
    vatAmount: 28500,
    totalAmount: 328500,
    orderNumber: 'SO-20261117-4223',
    vatCompany: {
      id: 1,
      name: 'Conqueror International',
      taxId: '0312362838',
      address: '1073/63B Duong Cach Mang Thang Tam, Ho Chi Minh City',
    },
  },
};

const fallbackCompany = {
  companyName: 'HO KINH DOANH TIEN ICH GIA DINH',
  registeredAddress: '1D TMT17 KP3, Ho Chi Minh City',
  deliveryAddress: '1D TMT17 KP3, Ho Chi Minh City',
  taxId: '086183007829',
};

describe('buildPaymentReceiptDocument', () => {
  it('prints the issuing VAT company and the stored receipt numbers', () => {
    const html = buildPaymentReceiptDocument(receipt, fallbackCompany);

    expect(html).toContain('PAYMENT RECEIPT');
    expect(html).toContain('Conqueror International');
    expect(html).toContain('0312362838');
    expect(html).toContain('RCPT-20261117-0004');
    expect(html).toContain('CI-20261117-0004');
    expect(html).toContain('SO-20261117-4223');
    expect(html).toContain('Acme Stationery');
    expect(html).toContain('VCB-884422');
    // Stored register numbers, formatted - never recomputed from the invoice total.
    expect(html).toContain('328.500');
    expect(html).toContain('200.000');
    expect(html).toContain('128.500');

    // The shop's own letterhead must NOT appear on an invoice issued by the VAT company.
    expect(html).not.toContain('HO KINH DOANH TIEN ICH GIA DINH');
  });

  it('falls back to the shop letterhead for a retail invoice', () => {
    const retail: CustomerReceipt = {
      ...receipt,
      invoice: { ...receipt.invoice, invoiceNumber: 'DC-20261117-0004', vatCompany: null },
    };

    const html = buildPaymentReceiptDocument(retail, fallbackCompany);

    expect(html).toContain('HO KINH DOANH TIEN ICH GIA DINH');
    expect(html).toContain('Shop (retail invoice)');
  });

  it('stamps a voided receipt and prints the reason', () => {
    const html = buildPaymentReceiptDocument(
      {
        ...receipt,
        voided: true,
        voidedAt: '2026-11-18T09:00:00.000Z',
        voidReason: 'Recorded against the wrong invoice',
      },
      fallbackCompany
    );

    expect(html).toContain('VOIDED');
    expect(html).toContain('Recorded against the wrong invoice');
  });

  it('escapes buyer text instead of letting it break the sheet', () => {
    const html = buildPaymentReceiptDocument(
      {
        ...receipt,
        invoice: { ...receipt.invoice, buyerName: '<script>alert(1)</script>' },
      },
      fallbackCompany
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('refuses to print when the issuing letterhead is incomplete', () => {
    const noLetterhead: CustomerReceipt = {
      ...receipt,
      invoice: { ...receipt.invoice, vatCompany: null },
    };

    expect(() =>
      buildPaymentReceiptDocument(noLetterhead, { ...fallbackCompany, taxId: '' })
    ).toThrow(/Tax ID/i);
  });
});
