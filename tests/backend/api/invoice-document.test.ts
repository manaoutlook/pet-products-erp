import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../../../db';
import {
  customerProfiles,
  inventory,
  products,
  userStoreAssignments,
  vatCompanies,
} from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { cleanDatabase, resetSequences, seedTestData } from '../../helpers/test-db';
import { createSale } from '../../../server/sales';
import {
  archiveIssuedInvoiceDocument,
  buildInvoicePayload,
  invoiceArchiveDir,
  invoiceArchiveFileName,
} from '../../../server/invoice-documents';
import { computeSaleTotals } from '../../../shared/tax';

/**
 * The invoice acceptance criteria, as tests:
 *
 *   - the total at the till, the total in the database and the total on a reprint are the same
 *     number (the 110,000 / 100,000 / 90,909.09 bug);
 *   - a reprint after a product rename still shows the old name;
 *   - a VAT invoice runs on its company's own sequence (CI-/HI-), separate from the store's;
 *   - the issued document is archived once and never replaced.
 */
describe('invoice documents', () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let ciCompany: typeof vatCompanies.$inferSelect;
  let hiCompany: typeof vatCompanies.$inferSelect;

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    data = await seedTestData();

    // The cashier must be assigned to a store - createSale resolves it from here.
    await db.insert(userStoreAssignments).values({
      userId: data.users.admin.id,
      storeId: data.stores.store1.id,
    });

    await db.insert(inventory).values({
      productId: data.products.product.id,
      storeId: data.stores.store1.id,
      inventoryType: 'STORE',
      quantity: 20,
    });

    // 100,000 VND a unit makes the arithmetic readable: 2 units = 200,000 excl. VAT.
    await db
      .update(products)
      .set({ price: '100000.00' })
      .where(eq(products.id, data.products.product.id));

    // cleanDatabase() truncates the seeded rows, so the two companies are re-created here.
    const [ci] = await db
      .insert(vatCompanies)
      .values({
        code: 'CI',
        name: 'Conqueror International',
        taxId: '0301234567',
        address: '1 Conqueror Street, Ho Chi Minh City',
      })
      .returning();
    const [hi] = await db
      .insert(vatCompanies)
      .values({
        code: 'HI',
        name: 'Hasim International',
        taxId: '0307654321',
        address: '2 Hasim Street, Ho Chi Minh City',
      })
      .returning();

    ciCompany = ci;
    hiCompany = hi;
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  const sellTwoUnits = (options: { withVat?: boolean; vatCompanyId?: number | null } = {}) =>
    createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 2 }],
      paymentMethod: 'CASH',
      transactionType: 'STORE_SALE',
      withVat: options.withVat,
      vatCompanyId: options.vatCompanyId ?? null,
      // A VAT invoice needs a buyer; the sale snapshots it, so the test provides it here.
      buyer: options.withVat
        ? {
            name: 'Beta Buyer Co.',
            companyName: 'Beta Buyer Co.',
            taxId: '0309999999',
            address: '9 Buyer Street, Hanoi',
            phone: '0900000000',
          }
        : null,
    });

  it('stores subtotal, VAT and total that agree with each other', async () => {
    const sale = await sellTwoUnits({ withVat: true, vatCompanyId: ciCompany.id });
    expect(sale).toBeTruthy();

    // 2 x 100,000 = 200,000 excl. VAT; 10% = 20,000; total 220,000.
    expect(Number(sale!.subtotal)).toBe(200000);
    expect(Number(sale!.vatRate)).toBeCloseTo(0.1, 4);
    expect(Number(sale!.vatAmount)).toBe(20000);
    expect(Number(sale!.totalAmount)).toBe(220000);
    expect(Number(sale!.subtotal) + Number(sale!.vatAmount)).toBe(Number(sale!.totalAmount));
    expect(sale!.printedWithVat).toBe(true);
    expect(sale!.vatCompanyId).toBe(ciCompany.id);
  });

  it('adds no VAT when the customer does not ask for a VAT invoice', async () => {
    const sale = await sellTwoUnits();
    expect(Number(sale!.subtotal)).toBe(200000);
    expect(Number(sale!.vatRate)).toBe(0);
    expect(Number(sale!.vatAmount)).toBe(0);
    expect(Number(sale!.totalAmount)).toBe(200000);
    expect(sale!.vatCompanyId).toBeNull();
  });

  it('prints the same total on a reprint as the sale stored', async () => {
    const sale = await sellTwoUnits({ withVat: true, vatCompanyId: ciCompany.id });
    const invoice = await buildInvoicePayload(sale!.id);

    // The three numbers the old code disagreed on. A reprint must not divide by 1.1.
    expect(invoice.subtotal).toBe(200000);
    expect(invoice.vatAmount).toBe(20000);
    expect(invoice.total).toBe(220000);
    expect(invoice.kind).toBe('VAT');
    expect(invoice.seller.name).toBe('Conqueror International');
    expect(invoice.seller.taxId).toBe('0301234567');
    // The buyer block comes from the sale, not from a customer profile that may change.
    expect(invoice.buyer?.name).toBe('Beta Buyer Co.');
    expect(invoice.buyer?.taxId).toBe('0309999999');
  });

  it('refuses a VAT sale without a buyer', async () => {
    await expect(
      createSale({
        userId: data.users.admin.id,
        items: [{ productId: data.products.product.id, quantity: 1 }],
        paymentMethod: 'CASH',
        transactionType: 'STORE_SALE',
        withVat: true,
        vatCompanyId: ciCompany.id,
      })
    ).rejects.toThrow(/buyer name/i);
  });

  it('fills the buyer block, including the tax code, from the attached customer profile', async () => {
    const [customer] = await db.insert(customerProfiles).values({
      mobileNumber: '0908888888',
      companyName: 'Attached Customer Co.',
      contactPerson: 'Pham Thi Lan',
      email: 'lan@attached.example',
      address: '15 Dong Khoi, District 1, Ho Chi Minh City',
      taxId: '0313623838',
      customerType: 'B2B',
    }).returning();

    const sale = await createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 1 }],
      paymentMethod: 'CASH',
      transactionType: 'STORE_SALE',
      customerProfileId: customer.id,
      withVat: true,
      vatCompanyId: ciCompany.id,
      // Only the name was typed at the counter; the rest has to come from the profile.
      buyer: { name: 'Pham Thi Lan' },
    });

    // The tax code is the part a VAT invoice is checked for, and the cashier should not have to
    // re-type a number the profile already holds.
    expect(sale!.buyerTaxId).toBe('0313623838');
    expect(sale!.buyerCompanyName).toBe('Attached Customer Co.');
    expect(sale!.buyerAddress).toBe('15 Dong Khoi, District 1, Ho Chi Minh City');

    const invoice = await buildInvoicePayload(sale!.id);
    expect(invoice.buyer?.taxId).toBe('0313623838');
  });

  it('keeps the product name that was sold when the catalogue is renamed', async () => {
    const sale = await sellTwoUnits();
    const before = await buildInvoicePayload(sale!.id);
    expect(before.lines[0].description).toBe('Test Product');
    expect(before.lines[0].productCode).toBe('TEST-001');

    await db
      .update(products)
      .set({ name: 'Renamed Product', sku: 'TEST-RENAMED' })
      .where(eq(products.id, data.products.product.id));

    const after = await buildInvoicePayload(sale!.id);
    expect(after.lines[0].description).toBe('Test Product');
    expect(after.lines[0].productCode).toBe('TEST-001');
  });

  it('runs each VAT company on its own invoice number sequence', async () => {
    const firstCi = await sellTwoUnits({ withVat: true, vatCompanyId: ciCompany.id });
    const secondCi = await sellTwoUnits({ withVat: true, vatCompanyId: ciCompany.id });
    const firstHi = await sellTwoUnits({ withVat: true, vatCompanyId: hiCompany.id });
    const retail = await sellTwoUnits();

    expect(firstCi!.invoiceNumber).toMatch(/^CI-\d{8}-0001$/);
    expect(secondCi!.invoiceNumber).toMatch(/^CI-\d{8}-0002$/);
    expect(firstHi!.invoiceNumber).toMatch(/^HI-\d{8}-0001$/);
    // The retail book is independent of both company books.
    expect(retail!.invoiceNumber).toMatch(/^STR\d{3}-\d{8}-\d{4}$/);
  });

  it('refuses a VAT sale without a company', async () => {
    await expect(sellTwoUnits({ withVat: true, vatCompanyId: null })).rejects.toThrow(
      /Select the company that issues the VAT invoice/i
    );
  });

  it('archives the issued document once and never replaces it', async () => {
    const sale = await sellTwoUnits();
    const invoice = await buildInvoicePayload(sale!.id);
    const first = '<!doctype html><html><body>issued copy</body></html>';
    const second = '<!doctype html><html><body>a later print</body></html>';

    const archived = await archiveIssuedInvoiceDocument(sale!.id, first);
    expect(archived.created).toBe(true);

    const again = await archiveIssuedInvoiceDocument(sale!.id, second);
    expect(again.created).toBe(false);
    expect(again.url).toBe(archived.url);

    // The stored file is the FIRST document, not the later one.
    const filePath = path.join(invoiceArchiveDir, invoiceArchiveFileName(invoice.invoiceNumber));
    const stored = await fs.readFile(filePath, 'utf8');
    expect(stored).toContain('issued copy');
    expect(stored).not.toContain('a later print');

    const refreshed = await buildInvoicePayload(sale!.id);
    expect(refreshed.archivedDocumentUrl).toBe(archived.url);

    await fs.rm(filePath, { force: true });
  });

  it('computes VAT with one shared rule', () => {
    expect(computeSaleTotals(100000, false)).toEqual({
      subtotal: 100000,
      vatAmount: 0,
      total: 100000,
      vatRate: 0,
    });
    expect(computeSaleTotals(100000, true)).toEqual({
      subtotal: 100000,
      vatAmount: 10000,
      total: 110000,
      vatRate: 0.1,
    });
  });
});
