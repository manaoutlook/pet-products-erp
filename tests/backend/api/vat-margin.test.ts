import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import {
  deliveryNotes,
  products,
  salesOrderItems,
  salesOrders,
} from '../../../db/schema';
import {
  cleanDatabase,
  resetSequences,
  resetTestDatabase,
  seedTestData,
} from '../../helpers/test-db';
import {
  computeVatMarginStatement,
  normaliseProfitMarginRate,
  type VatMarginSourceLine,
} from '../../../shared/vat-margin';
import { readVatMarginSettings, saveVatMarginSettings } from '../../../server/vat-margin-settings';
import {
  buildVatMarginStatement,
  listVatMarginDocuments,
  registerVatMarginRoutes,
} from '../../../server/routes/vat-margin';
import { generateDeliveryNoteNumber, generateSalesOrderNumber } from '../../../server/numbering';
import { recordRoutes } from '../../helpers/route-harness';

/**
 * VAT Margin Calculator.
 *
 * Two things must never be wrong here, because the output is sent to a tax company:
 *
 *   1. the arithmetic - the worksheet's H..Q columns, rounded to the dong;
 *   2. the source of the prices - landing price and B2B price come LIVE from the Product module,
 *      so a product with either one blank blocks the statement instead of printing a zero.
 *
 * The pure module is pinned without a database first; the route is then exercised against real
 * sales orders, delivery notes and products.
 */

const line = (overrides: Partial<VatMarginSourceLine> = {}): VatMarginSourceLine => ({
  productCode: 'SKU-1',
  description: 'Product one',
  landingPrice: 100_000,
  b2bPrice: 150_000,
  quantity: 2,
  ...overrides,
});

describe('VAT margin arithmetic', () => {
  const params = {
    profitMarginRate: 0.97,
    incomeTaxRate: 0.2,
    serviceFeeRate: 0,
    vatRate: 0.1,
  };

  it('splits one line exactly as the worksheet does', () => {
    const [row] = computeVatMarginStatement([line()], params).lines;

    // H = 97% x (F - E); I = E + H; J = F - I
    expect(row.marginAmount).toBe(48_500);
    expect(row.smartLifePrice).toBe(148_500);
    expect(row.conquerorProfitUnit).toBe(1_500);
    // K = J x G; O = F x G; L = 20% x K; N = O - L - M
    expect(row.conquerorProfitTotal).toBe(3_000);
    expect(row.salesValue).toBe(300_000);
    expect(row.incomeTax).toBe(600);
    expect(row.serviceFee).toBe(0);
    expect(row.paybackToSmartLife).toBe(299_400);
    // P = 10% x O; Q = O + P
    expect(row.vatAmount).toBe(30_000);
    expect(row.invoiceTotal).toBe(330_000);
    expect(row.hasError).toBe(false);
  });

  it('charges the service fee on the sales value, not on the profit', () => {
    const statement = computeVatMarginStatement([line()], { ...params, serviceFeeRate: 0.05 });
    const [row] = statement.lines;

    // 5% x O (300,000), not 5% x K (3,000).
    expect(row.serviceFee).toBe(15_000);
    expect(row.paybackToSmartLife).toBe(284_400);
  });

  it('clamps the profit margin into 95%-99%', () => {
    expect(normaliseProfitMarginRate(0.5)).toBe(0.95);
    expect(normaliseProfitMarginRate(2)).toBe(0.99);
    expect(normaliseProfitMarginRate(Number.NaN)).toBe(0.97);

    const statement = computeVatMarginStatement([line()], { ...params, profitMarginRate: 1 });
    expect(statement.params.profitMarginRate).toBe(0.99);
  });

  it('totals the quantity and every money column', () => {
    const statement = computeVatMarginStatement(
      [line(), line({ productCode: 'SKU-2', quantity: 3, landingPrice: 10_000, b2bPrice: 20_000 })],
      params
    );

    expect(statement.totals.quantity).toBe(5);
    expect(statement.totals.salesValue).toBe(360_000);
    expect(statement.totals.invoiceTotal).toBe(396_000);
    expect(statement.totals.conquerorProfitTotal).toBe(
      statement.lines.reduce((sum, row) => sum + row.conquerorProfitTotal, 0)
    );
  });

  it('names the Product module field that is missing, per SKU', () => {
    const statement = computeVatMarginStatement(
      [
        line({ productCode: 'NO-LANDING', landingPrice: null }),
        line({ productCode: 'NO-B2B', b2bPrice: null }),
      ],
      params
    );

    expect(statement.lines.every((row) => row.hasError)).toBe(true);
    expect(statement.errors).toEqual([
      expect.objectContaining({
        productCode: 'NO-LANDING',
        field: 'landingPrice',
        message: 'Landing Price is not updated in the Product module for NO-LANDING',
      }),
      expect.objectContaining({
        productCode: 'NO-B2B',
        field: 'b2bPrice',
        message: 'B2B Price is not updated in the Product module for NO-B2B',
      }),
    ]);
  });
});

describe('VAT margin settings and documents', () => {
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

  /** The catalogue prices the calculator reads live: E = 100,000, F = 150,000. */
  async function priceProduct(landing: string | null, b2b: string | null) {
    await db
      .update(products)
      .set({ landingPrice: landing, b2bPrice: b2b })
      .where(eq(products.id, testData.products.product.id));
  }

  async function seedOrder(
    lines: Array<{ quantity: number }> = [{ quantity: 2 }],
    overrides: Partial<typeof salesOrders.$inferInsert> = {}
  ) {
    const [order] = await db
      .insert(salesOrders)
      .values({
        orderNumber: generateSalesOrderNumber(),
        customerName: 'Nguyen Van A',
        companyName: 'Pet Shop A',
        orderDate: new Date(),
        totalAmount: '0.00',
        status: 'open',
        vatRate: '0.0800',
        preparedByUserId: testData.users.admin.id,
        ...overrides,
      })
      .returning();

    await db.insert(salesOrderItems).values(
      lines.map((orderLine) => ({
        salesOrderId: order.id,
        productId: testData.products.product.id,
        productCode: 'TEST-001',
        description: 'Test Product',
        quantity: orderLine.quantity,
        unitPrice: '150000.00',
        totalPrice: (orderLine.quantity * 150_000).toFixed(2),
      }))
    );

    return order;
  }

  it('opens on the documented defaults when nothing has ever been saved', async () => {
    expect(await readVatMarginSettings()).toEqual({
      incomeTaxRate: 0.2,
      profitMarginRate: 0.97,
      serviceFeeRate: 0,
    });
  });

  it('round-trips the settings and clamps the profit margin on the way in', async () => {
    const saved = await saveVatMarginSettings(
      { profitMarginRate: 1, incomeTaxRate: 0.15, serviceFeeRate: 0.02 },
      testData.users.admin.id
    );

    expect(saved).toEqual({
      incomeTaxRate: 0.15,
      profitMarginRate: 0.99,
      serviceFeeRate: 0.02,
    });
    expect(await readVatMarginSettings()).toEqual(saved);
  });

  it('leaves settings that were not sent untouched', async () => {
    await saveVatMarginSettings({ incomeTaxRate: 0.15 }, testData.users.admin.id);
    await saveVatMarginSettings({ serviceFeeRate: 0.01 }, testData.users.admin.id);

    expect(await readVatMarginSettings()).toEqual({
      incomeTaxRate: 0.15,
      profitMarginRate: 0.97,
      serviceFeeRate: 0.01,
    });
  });

  it('builds a statement for a sales order from the Product module prices', async () => {
    await priceProduct('100000.00', '150000.00');
    const order = await seedOrder([{ quantity: 2 }]);

    const statement = await buildVatMarginStatement('sales_order', order.id);

    expect(statement?.document.reference).toBe(order.orderNumber);
    expect(statement?.params.vatRate).toBeCloseTo(0.08, 4);
    expect(statement?.params.profitMarginRate).toBe(0.97);
    expect(statement?.lines).toHaveLength(1);

    const row = statement!.lines[0];
    expect(row.productCode).toBe('TEST-001');
    expect(row.quantity).toBe(2);
    expect(row.landingPrice).toBe(100_000);
    expect(row.b2bPrice).toBe(150_000);
    expect(row.conquerorProfitTotal).toBe(3_000);
    expect(row.salesValue).toBe(300_000);
    // The order's own rate, not the company's current one.
    expect(row.vatAmount).toBe(24_000);
    expect(statement?.errors).toEqual([]);
  });

  it('takes the rates from the request, clamped, when the operator changes a field', async () => {
    await priceProduct('100000.00', '150000.00');
    const order = await seedOrder();

    const statement = await buildVatMarginStatement('sales_order', order.id, {
      profitMarginRate: 0.95,
      incomeTaxRate: 0.1,
      serviceFeeRate: 0.05,
    });

    const row = statement!.lines[0];
    // H = 95% x 50,000 = 47,500; J = 2,500; K = 5,000; L = 500; M = 5% x 300,000 = 15,000.
    expect(row.marginAmount).toBe(47_500);
    expect(row.conquerorProfitTotal).toBe(5_000);
    expect(row.incomeTax).toBe(500);
    expect(row.serviceFee).toBe(15_000);
  });

  it('reports a price that is missing from the Product module instead of zero-filling it', async () => {
    await priceProduct(null, '150000.00');
    const order = await seedOrder();

    const statement = await buildVatMarginStatement('sales_order', order.id);

    expect(statement?.errors).toEqual([
      expect.objectContaining({ field: 'landingPrice', productCode: 'TEST-001' }),
    ]);
    expect(statement?.lines[0].hasError).toBe(true);
  });

  it('lists only issued VAT invoices under "invoice"', async () => {
    const plain = await seedOrder();
    await seedOrder([{ quantity: 1 }], { vatInvoiceNumber: 'CI-20260101-0001' });

    const invoices = await listVatMarginDocuments('invoice');
    expect(invoices).toHaveLength(1);
    expect(invoices[0].reference).toBe('CI-20260101-0001');

    // Asking for the invoice of an order that never got one is not an empty statement.
    expect(await buildVatMarginStatement('invoice', plain.id)).toBeNull();
  });

  it('resolves a delivery note to its whole order, not to what was delivered', async () => {
    await priceProduct('100000.00', '150000.00');
    const order = await seedOrder([{ quantity: 5 }]);

    const [note] = await db
      .insert(deliveryNotes)
      .values({
        deliveryNoteNumber: generateDeliveryNoteNumber(),
        salesOrderId: order.id,
        customerName: 'Nguyen Van A',
        companyName: 'Pet Shop A',
        deliveredByUserId: testData.users.admin.id,
      })
      .returning();

    const documents = await listVatMarginDocuments('delivery_note');
    expect(documents).toEqual([
      expect.objectContaining({
        id: note.id,
        salesOrderId: order.id,
        reference: note.deliveryNoteNumber,
      }),
    ]);

    const statement = await buildVatMarginStatement('delivery_note', note.id);
    expect(statement?.document.reference).toBe(note.deliveryNoteNumber);
    expect(statement?.lines[0].quantity).toBe(5);
    expect(statement?.totals.salesValue).toBe(750_000);
  });

  it('registers the four endpoints, with the write behind permission and validation', () => {
    const registrations = recordRoutes(registerVatMarginRoutes);
    const keys = registrations.map((entry) => `${entry.method} ${entry.path}`).sort();

    expect(keys).toEqual([
      'GET /api/vat-margin/documents',
      'GET /api/vat-margin/settings',
      'GET /api/vat-margin/statement',
      'PUT /api/vat-margin/settings',
    ]);

    const put = registrations.find((entry) => entry.method === 'PUT');
    // requirePermission + validateBody + the handler itself.
    expect(put?.handlers.length).toBeGreaterThanOrEqual(3);
  });

});

