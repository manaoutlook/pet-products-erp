import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { products, categories, suppliers } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import {
    importProducts,
    parseImportInteger,
    parseImportPrice,
} from '../../../server/product-import';
import {
    cleanDatabase,
    resetSequences,
    resetTestDatabase,
} from '../../helpers/test-db';

/**
 * Bulk product import (POST /api/products/import).
 *
 * The client parses the spreadsheet and posts the canonical import fields (see
 * client/src/utils/product-spreadsheet.ts); the server re-validates every row.
 * These tests cover the business rules: master-data auto-creation, update by
 * SKU, per-row error reporting and locale aware price parsing.
 */
describe('Product Import', () => {
    const validRow = {
        name: 'Imported Dog Food',
        sku: 'IMP-001',
        category: 'Food',
        supplier: 'Acme Supplies',
        brand: 'Pedigree',
        landingPrice: '8',
        b2bPrice: '10',
        b2cPrice: '12.50',
        minStock: '5',
        description: 'Imported from a spreadsheet',
    };

    beforeAll(async () => {
        await resetTestDatabase();
    });

    beforeEach(async () => {
        await cleanDatabase();
        await resetSequences();
    });


    describe('Creating products', () => {
        it('creates the product and auto-creates the missing master data', async () => {
            const result = await importProducts([validRow]);

            expect(result.created).toBe(1);
            expect(result.updated).toBe(0);
            expect(result.errors).toEqual([]);
            expect(result.createdCategories).toBe(1);
            expect(result.createdBrands).toBe(1);
            expect(result.createdSuppliers).toBe(1);

            const [product] = await db
                .select()
                .from(products)
                .where(eq(products.sku, 'IMP-001'));

            expect(product).toBeDefined();
            expect(product.name).toBe('Imported Dog Food');
            expect(Number(product.b2cPrice)).toBe(12.5);
            expect(Number(product.landingPrice)).toBe(8);
            expect(Number(product.b2bPrice)).toBe(10);
            // The legacy `price` column mirrors the retail price.
            expect(Number(product.price)).toBe(12.5);
            expect(product.minStock).toBe(5);
            expect(product.categoryId).not.toBeNull();
            expect(product.brandId).not.toBeNull();
            expect(product.supplierId).not.toBeNull();
        });

        it('reuses existing master data instead of creating duplicates', async () => {
            const [category] = await db
                .insert(categories)
                .values({ name: 'Food' })
                .returning();
            const [supplier] = await db
                .insert(suppliers)
                .values({ name: 'Acme Supplies', contactInfo: '-', address: '-' })
                .returning();

            const result = await importProducts([validRow]);

            expect(result.created).toBe(1);
            expect(result.createdCategories).toBe(0);
            expect(result.createdSuppliers).toBe(0);

            const [product] = await db
                .select()
                .from(products)
                .where(eq(products.sku, 'IMP-001'));
            expect(product.categoryId).toBe(category.id);
            expect(product.supplierId).toBe(supplier.id);
            expect(await db.select().from(categories)).toHaveLength(1);
            expect(await db.select().from(suppliers)).toHaveLength(1);
        });

        it('defaults minStock when the column is empty', async () => {
            await importProducts([{ ...validRow, minStock: '' }]);

            const [product] = await db
                .select()
                .from(products)
                .where(eq(products.sku, 'IMP-001'));
            expect(product.minStock).toBe(10);
        });

        it('stores the weight in kilograms, including sub-kilo decimals', async () => {
            await importProducts([{ ...validRow, weightKg: '0.35' }]);

            const [product] = await db
                .select()
                .from(products)
                .where(eq(products.sku, 'IMP-001'));
            expect(Number(product.weightKg)).toBeCloseTo(0.35, 3);
        });

        it('rejects a negative weight', async () => {
            const result = await importProducts([{ ...validRow, weightKg: '-1' }]);

            expect(result.created).toBe(0);
            expect(result.errors[0]?.message).toMatch(/Weight must be a positive number of kilograms/i);
        });
    });

    describe('Updating existing products', () => {
        it('updates the product matched by SKU', async () => {
            await importProducts([validRow]);
            const result = await importProducts([
                { ...validRow, name: 'Renamed Dog Food', b2cPrice: '15' },
            ]);

            expect(result.created).toBe(0);
            expect(result.updated).toBe(1);
            expect(result.errors).toEqual([]);

            const [product] = await db
                .select()
                .from(products)
                .where(eq(products.sku, 'IMP-001'));
            expect(product.name).toBe('Renamed Dog Food');
            expect(Number(product.b2cPrice)).toBe(15);
            expect(await db.select().from(products)).toHaveLength(1);
        });

        it('skips existing SKUs when updateExisting is false', async () => {
            await importProducts([validRow]);
            const result = await importProducts(
                [{ ...validRow, name: 'Should Not Apply' }],
                { updateExisting: false }
            );

            expect(result.created).toBe(0);
            expect(result.updated).toBe(0);
            expect(result.skipped).toBe(1);

            const [product] = await db
                .select()
                .from(products)
                .where(eq(products.sku, 'IMP-001'));
            expect(product.name).toBe('Imported Dog Food');
        });

        it('still imports new rows while skipping existing ones', async () => {
            await importProducts([validRow]);
            const result = await importProducts(
                [validRow, { ...validRow, sku: 'IMP-002', name: 'Second Product' }],
                { updateExisting: false }
            );

            expect(result.skipped).toBe(1);
            expect(result.created).toBe(1);
            expect(await db.select().from(products)).toHaveLength(2);
        });
    });

    describe('Row validation', () => {
        it('imports the valid rows and reports every invalid one', async () => {
            const result = await importProducts([
                validRow,
                { ...validRow, sku: 'IMP-002', name: '' },
                { ...validRow, sku: 'IMP-003', b2cPrice: 'not-a-price' },
                { ...validRow, sku: 'IMP-004', supplier: '' },
                { ...validRow, sku: 'IMP-005', category: '' },
            ]);

            expect(result.total).toBe(5);
            expect(result.created).toBe(1);
            expect(result.errors).toHaveLength(4);
            // Row numbers are 1-based and include the header row.
            expect(result.errors.map((error) => error.row)).toEqual([3, 4, 5, 6]);
            expect(result.errors.map((error) => error.message)).toEqual([
                'Product name is required',
                'B2C price is not a valid number',
                'Supplier is required',
                'Category is required',
            ]);
        });

        it('requires a supplier on every row, like the create/edit form', async () => {
            const result = await importProducts([{ ...validRow, supplier: '' }]);

            expect(result.created).toBe(0);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].message).toBe('Supplier is required');
            expect(await db.select().from(products)).toHaveLength(0);
        });

        it('requires a SKU on every row', async () => {
            const result = await importProducts([{ ...validRow, sku: '' }]);

            expect(result.created).toBe(0);
            expect(result.errors[0].message).toBe('SKU is required');
        });

        it('rejects unknown master data when createMissing is false', async () => {
            const result = await importProducts(
                [{ ...validRow, category: 'Never Seen' }],
                { createMissing: false }
            );

            expect(result.created).toBe(0);
            expect(result.errors[0].message).toBe('Category not found: Never Seen');
            expect(await db.select().from(categories)).toHaveLength(0);
        });
    });

    describe('Cell parsing', () => {
        it('parses locale formatted prices', () => {
            expect(parseImportPrice('32.000')).toBe(32000);
            expect(parseImportPrice('0,37')).toBe(0.37);
            expect(parseImportPrice('$20,00')).toBe(20);
            expect(parseImportPrice('1,234.56')).toBe(1234.56);
            expect(parseImportPrice(12.5)).toBe(12.5);
            expect(parseImportPrice('')).toBeNull();
            expect(parseImportPrice('abc')).toBe('invalid');
        });

        it('parses minimum stock cells', () => {
            expect(parseImportInteger('15', 10)).toBe(15);
            expect(parseImportInteger('15 pcs', 10)).toBe(15);
            expect(parseImportInteger('', 10)).toBe(10);
            expect(parseImportInteger('abc', 10)).toBe('invalid');
        });
    });
});

