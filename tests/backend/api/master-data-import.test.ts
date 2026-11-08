import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { brands, categories, inventory, products, suppliers } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import {
    importBrands,
    importCategories,
    importSuppliers,
} from '../../../server/master-data-import';
import {
    bulkDeleteBrands,
    bulkDeleteCategories,
    bulkDeleteSuppliers,
} from '../../../server/master-data-bulk-delete';
import {
    cleanDatabase,
    resetSequences,
    resetTestDatabase,
} from '../../helpers/test-db';

/**
 * CSV/Excel import + bulk delete for the master data screens
 * (POST /api/{categories,brands,suppliers}/import and .../bulk-delete).
 *
 * The client parses the spreadsheet and posts canonical rows; these tests cover
 * the server rules: name matching (case-insensitive), per-row error reporting,
 * parent resolution and the delete protection rules.
 */
describe('Master Data Import & Bulk Delete', () => {
    beforeAll(async () => {
        await resetTestDatabase();
    });

    beforeEach(async () => {
        await cleanDatabase();
        await resetSequences();
    });

    /** Helper: create a valid product so deletion rules can be exercised. */
    const createProduct = async (values: Partial<typeof products.$inferInsert> = {}) => {
        const [category] = await db
            .insert(categories)
            .values({ name: `Category ${Date.now()}${Math.random()}` })
            .returning();

        const [product] = await db
            .insert(products)
            .values({
                name: 'Test Product',
                sku: `SKU-${Date.now()}${Math.round(Math.random() * 1000)}`,
                price: '100.00',
                categoryId: category.id,
                ...values,
            })
            .returning();

        return { product, category };
    };

    describe('Category import', () => {
        it('creates categories and auto-creates the parent category', async () => {
            const result = await importCategories([
                { name: 'Food', description: 'Food products', parent: '' },
                { name: 'Dry Food', description: 'Kibble', parent: 'Food' },
            ]);

            expect(result.created).toBe(2);
            expect(result.createdParents).toBe(0);
            expect(result.errors).toEqual([]);

            const all = await db.select().from(categories);
            expect(all).toHaveLength(2);

            const parent = all.find((row) => row.name === 'Food');
            const child = all.find((row) => row.name === 'Dry Food');
            expect(parent?.parentId).toBeNull();
            expect(child?.parentId).toBe(parent?.id);
        });

        it('creates a missing parent category and reports it separately', async () => {
            const result = await importCategories([
                { name: 'Puppy Food', description: '', parent: 'Dogs' },
            ]);

            expect(result.created).toBe(1);
            expect(result.createdParents).toBe(1);

            const [parent] = await db
                .select()
                .from(categories)
                .where(eq(categories.name, 'Dogs'));
            expect(parent.parentId).toBeNull();
        });

        it('updates an existing category matched case-insensitively', async () => {
            const [existing] = await db
                .insert(categories)
                .values({ name: 'Food', description: 'Old description' })
                .returning();

            const result = await importCategories([
                { name: '  food ', description: 'New description', parent: '' },
            ]);

            expect(result.created).toBe(0);
            expect(result.updated).toBe(1);
            expect(result.errors).toEqual([]);

            const [updated] = await db
                .select()
                .from(categories)
                .where(eq(categories.id, existing.id));
            expect(updated.name).toBe('food');
            expect(updated.description).toBe('New description');
        });

        it('keeps the stored description when the cell is empty', async () => {
            const [existing] = await db
                .insert(categories)
                .values({ name: 'Food', description: 'Keep me' })
                .returning();

            await importCategories([{ name: 'Food', description: '', parent: '' }]);

            const [updated] = await db
                .select()
                .from(categories)
                .where(eq(categories.id, existing.id));
            expect(updated.description).toBe('Keep me');
        });

        it('skips existing categories when updateExisting is false', async () => {
            await db.insert(categories).values({ name: 'Food' });

            const result = await importCategories(
                [{ name: 'Food', description: 'ignored', parent: '' }],
                { updateExisting: false }
            );

            expect(result.updated).toBe(0);
            expect(result.skipped).toBe(1);
        });

        it('reports a category that is used as its own parent', async () => {
            const result = await importCategories([
                { name: 'Food', description: '', parent: 'Food' },
            ]);

            expect(result.created).toBe(0);
            expect(result.errors[0]?.row).toBe(2);
            expect(result.errors[0]?.message).toMatch(/cannot be its own parent/i);
        });

        it('reports a missing category name', async () => {
            const result = await importCategories([{ name: '   ', parent: '' }]);

            expect(result.created).toBe(0);
            expect(result.errors[0]?.message).toMatch(/Category name is required/i);
        });
    });

    describe('Brand import', () => {
        it('creates brands from the rows', async () => {
            const result = await importBrands([
                { name: 'Pedigree', description: 'Dog food brand' },
                { name: 'Whiskas', description: '' },
            ]);

            expect(result.created).toBe(2);
            expect(result.errors).toEqual([]);

            const all = await db.select().from(brands);
            expect(all.map((brand) => brand.name).sort()).toEqual(['Pedigree', 'Whiskas']);
        });

        it('updates the description of a brand matched by name', async () => {
            const [existing] = await db
                .insert(brands)
                .values({ name: 'Pedigree', description: 'Old' })
                .returning();

            const result = await importBrands([
                { name: 'PEDIGREE', description: 'New' },
            ]);

            expect(result.updated).toBe(1);

            const [updated] = await db
                .select()
                .from(brands)
                .where(eq(brands.id, existing.id));
            expect(updated.description).toBe('New');
        });

        it('reports a missing brand name', async () => {
            const result = await importBrands([{ name: '', description: '' }]);

            expect(result.created).toBe(0);
            expect(result.errors[0]?.message).toMatch(/Brand name is required/i);
        });
    });

    describe('Supplier import', () => {
        it('creates suppliers with contact information and address', async () => {
            const result = await importSuppliers([
                { name: 'Acme Trading', contactInfo: '0901234567', address: 'HCMC' },
            ]);

            expect(result.created).toBe(1);
            expect(result.errors).toEqual([]);

            const [supplier] = await db
                .select()
                .from(suppliers)
                .where(eq(suppliers.name, 'Acme Trading'));
            expect(supplier.contactInfo).toBe('0901234567');
            expect(supplier.address).toBe('HCMC');
        });

        it('rejects a new supplier without contact information', async () => {
            const result = await importSuppliers([
                { name: 'No Contact', contactInfo: '', address: 'HCMC' },
            ]);

            expect(result.created).toBe(0);
            expect(result.errors[0]?.message).toMatch(/Contact information is required/i);
        });

        it('rejects a new supplier without an address', async () => {
            const result = await importSuppliers([
                { name: 'No Address', contactInfo: '0901234567', address: '' },
            ]);

            expect(result.created).toBe(0);
            expect(result.errors[0]?.message).toMatch(/Address is required/i);
        });

        it('keeps the stored contact details when the cells are empty', async () => {
            const [existing] = await db
                .insert(suppliers)
                .values({ name: 'Acme Trading', contactInfo: '111', address: 'HCMC' })
                .returning();

            const result = await importSuppliers([
                { name: 'Acme Trading', contactInfo: '', address: '' },
            ]);

            expect(result.updated).toBe(1);

            const [updated] = await db
                .select()
                .from(suppliers)
                .where(eq(suppliers.id, existing.id));
            expect(updated.contactInfo).toBe('111');
            expect(updated.address).toBe('HCMC');
        });
    });

    describe('Bulk delete - categories', () => {
        it('deletes unused categories', async () => {
            const [a] = await db.insert(categories).values({ name: 'A' }).returning();
            const [b] = await db.insert(categories).values({ name: 'B' }).returning();

            const result = await bulkDeleteCategories([a.id, b.id]);

            expect(result.deleted.sort()).toEqual([a.id, b.id].sort());
            expect(result.failed).toEqual([]);
            expect(await db.select().from(categories)).toHaveLength(0);
        });

        it('keeps a category that still has sub categories', async () => {
            const [parent] = await db.insert(categories).values({ name: 'Dogs' }).returning();
            await db.insert(categories).values({ name: 'Dry Food', parentId: parent.id });

            const result = await bulkDeleteCategories([parent.id]);

            expect(result.deleted).toEqual([]);
            expect(result.failed[0].name).toBe('Dogs');
            expect(result.failed[0].message).toMatch(/sub category/i);
            expect(await db.select().from(categories)).toHaveLength(2);
        });

        it('keeps a category that is assigned to a product', async () => {
            const { category } = await createProduct();

            const result = await bulkDeleteCategories([category.id]);

            expect(result.deleted).toEqual([]);
            expect(result.failed[0].message).toMatch(/Assigned to 1 product/i);
        });

        it('deletes what it can and reports the protected rows', async () => {
            const [protectedCategory] = await db
                .insert(categories)
                .values({ name: 'Protected' })
                .returning();
            await createProduct({ categoryId: protectedCategory.id });
            const [free] = await db.insert(categories).values({ name: 'Free' }).returning();

            const result = await bulkDeleteCategories([protectedCategory.id, free.id, 99999]);

            expect(result.deleted).toEqual([free.id]);
            expect(result.failed.map((item) => item.id)).toEqual(
                expect.arrayContaining([protectedCategory.id, 99999])
            );
        });
    });

    describe('Bulk delete - brands', () => {
        it('deletes a brand that is not used by any product', async () => {
            const [brand] = await db.insert(brands).values({ name: 'Unused' }).returning();

            const result = await bulkDeleteBrands([brand.id]);

            expect(result.deleted).toEqual([brand.id]);
            expect(result.failed).toEqual([]);
        });

        it('keeps a brand that is assigned to a product', async () => {
            const [brand] = await db.insert(brands).values({ name: 'Used' }).returning();
            await createProduct({ brandId: brand.id });

            const result = await bulkDeleteBrands([brand.id]);

            expect(result.deleted).toEqual([]);
            expect(result.failed[0].message).toMatch(/Assigned to 1 product/i);
            expect(await db.select().from(brands)).toHaveLength(1);
        });
    });

    describe('Bulk delete - suppliers', () => {
        it('deletes a supplier without inventory or products', async () => {
            const [supplier] = await db
                .insert(suppliers)
                .values({ name: 'Unused Co', contactInfo: '111', address: 'HCMC' })
                .returning();

            const result = await bulkDeleteSuppliers([supplier.id]);

            expect(result.deleted).toEqual([supplier.id]);
            expect(result.failed).toEqual([]);
        });

        it('keeps a supplier that still has inventory', async () => {
            const [supplier] = await db
                .insert(suppliers)
                .values({ name: 'Stocked Co', contactInfo: '111', address: 'HCMC' })
                .returning();
            const { product } = await createProduct();

            await db.insert(inventory).values({
                productId: product.id,
                supplierId: supplier.id,
                quantity: 5,
            });

            const result = await bulkDeleteSuppliers([supplier.id]);

            expect(result.deleted).toEqual([]);
            expect(result.failed[0].message).toMatch(/inventory record/i);
        });

        it('keeps a supplier that is assigned to a product', async () => {
            const [supplier] = await db
                .insert(suppliers)
                .values({ name: 'Linked Co', contactInfo: '111', address: 'HCMC' })
                .returning();
            await createProduct({ supplierId: supplier.id });

            const result = await bulkDeleteSuppliers([supplier.id]);

            expect(result.deleted).toEqual([]);
            expect(result.failed[0].message).toMatch(/Assigned to 1 product/i);
        });
    });
});

