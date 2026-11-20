import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { categories, brands, suppliers, products, inventory } from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData, resetTestDatabase } from '../../helpers/test-db';
import { eq } from 'drizzle-orm';

describe('Master Data Management Tests', () => {
    let testData: Awaited<ReturnType<typeof seedTestData>>;

    beforeAll(async () => {
        // Reset database once per test file for clean state
        await resetTestDatabase();
    });

    beforeEach(async () => {
        // Clean data between tests but keep schema
        await cleanDatabase();
        await resetSequences();
        testData = await seedTestData();
    });

    afterEach(async () => {
        await cleanDatabase();
    });

    describe('Category Management', () => {
        it('should create a new category', async () => {
            const [category] = await db.insert(categories).values({
                name: 'New Test Category',
                description: 'New category for testing',
            }).returning();

            expect(category).toBeDefined();
            expect(category.name).toBe('New Test Category');
            expect(category.description).toBe('New category for testing');
        });

        it('should read category with products relationship', async () => {
            const category = await db.query.categories.findFirst({
                where: eq(categories.name, 'Test Category'),
                with: {
                    products: true,
                },
            });

            expect(category).toBeDefined();
            expect(category?.name).toBe('Test Category');
            expect(category?.products).toBeDefined();
            expect(category?.products.length).toBeGreaterThan(0);
        });

        it('should update category details', async () => {
            const category = await db.query.categories.findFirst({
                where: eq(categories.name, 'Test Category'),
            });

            const [updated] = await db.update(categories)
                .set({
                    name: 'Updated Category',
                    description: 'Updated description'
                })
                .where(eq(categories.id, category!.id))
                .returning();

            expect(updated.name).toBe('Updated Category');
            expect(updated.description).toBe('Updated description');
        });

        it('should delete category', async () => {
            // A category nothing points at can go. ("Test Category" cannot: the seeded product
            // still references it, and the schema deliberately refuses that - see the next test.)
            const [unused] = await db.insert(categories).values({
                name: 'Unused Category',
                description: 'No products reference this category',
            }).returning();

            await db.delete(categories).where(eq(categories.id, unused.id));

            const deleted = await db.query.categories.findFirst({
                where: eq(categories.id, unused.id),
            });

            expect(deleted).toBeUndefined();
        });

        it('refuses to delete a category that products still use', async () => {
            // Deleting the category would orphan priced catalogue rows, so the foreign key blocks
            // it; the API turns that into a 409 (CATEGORY_ASSIGNED_TO_PRODUCTS) before it gets here.
            await expect(
                db.delete(categories).where(eq(categories.id, testData.categories.category.id))
            ).rejects.toThrow();

            const survivor = await db.query.categories.findFirst({
                where: eq(categories.id, testData.categories.category.id),
            });

            expect(survivor?.name).toBe('Test Category');
        });

        it('should enforce unique category names', async () => {
            await expect(async () => {
                await db.insert(categories).values({
                    name: 'Test Category', // Duplicate name
                    description: 'Duplicate category',
                });
            }).rejects.toThrow();
        });
    });

    describe('Brand Management', () => {
        it('should create a new brand', async () => {
            const [brand] = await db.insert(brands).values({
                name: 'New Test Brand',
                description: 'New brand for testing',
            }).returning();

            expect(brand).toBeDefined();
            expect(brand.name).toBe('New Test Brand');
            expect(brand.description).toBe('New brand for testing');
        });

        it('should read brand with products relationship', async () => {
            const brand = await db.query.brands.findFirst({
                where: eq(brands.name, 'Test Brand'),
                with: {
                    products: true,
                },
            });

            expect(brand).toBeDefined();
            expect(brand?.name).toBe('Test Brand');
            expect(brand?.products).toBeDefined();
        });

        it('should update brand details', async () => {
            const brand = await db.query.brands.findFirst({
                where: eq(brands.name, 'Test Brand'),
            });

            const [updated] = await db.update(brands)
                .set({
                    name: 'Updated Brand',
                    description: 'Updated brand description'
                })
                .where(eq(brands.id, brand!.id))
                .returning();

            expect(updated.name).toBe('Updated Brand');
            expect(updated.description).toBe('Updated brand description');
        });

        it('should delete brand', async () => {
            // Same rule as categories: only a brand no product points at may go.
            const [unused] = await db.insert(brands).values({
                name: 'Unused Brand',
                description: 'No products reference this brand',
            }).returning();

            await db.delete(brands).where(eq(brands.id, unused.id));

            const deleted = await db.query.brands.findFirst({
                where: eq(brands.id, unused.id),
            });

            expect(deleted).toBeUndefined();
        });

        it('refuses to delete a brand that products still use', async () => {
            await expect(
                db.delete(brands).where(eq(brands.id, testData.brands.brand.id))
            ).rejects.toThrow();

            const survivor = await db.query.brands.findFirst({
                where: eq(brands.id, testData.brands.brand.id),
            });

            expect(survivor?.name).toBe('Test Brand');
        });

        it('should enforce unique brand names', async () => {
            await expect(async () => {
                await db.insert(brands).values({
                    name: 'Test Brand', // Duplicate name
                    description: 'Duplicate brand',
                });
            }).rejects.toThrow();
        });
    });

    describe('Supplier Management', () => {
        it('should create a new supplier', async () => {
            const [supplier] = await db.insert(suppliers).values({
                name: 'New Test Supplier Co.',
                contactInfo: '555-9999',
                address: 'New Test Address',
            }).returning();

            expect(supplier).toBeDefined();
            expect(supplier.name).toBe('New Test Supplier Co.');
            expect(supplier.contactInfo).toBe('555-9999');
            expect(supplier.address).toBe('New Test Address');
        });

        it('should read supplier with inventory relationship', async () => {
            const supplier = await db.query.suppliers.findFirst({
                where: eq(suppliers.name, 'Test Supplier Co.'),
                with: {
                    inventory: true,
                    purchaseOrders: true,
                },
            });

            expect(supplier).toBeDefined();
            expect(supplier?.name).toBe('Test Supplier Co.');
            expect(supplier?.inventory).toBeDefined();
            expect(supplier?.purchaseOrders).toBeDefined();
        });

        it('should update supplier details', async () => {
            const supplier = await db.query.suppliers.findFirst({
                where: eq(suppliers.name, 'Test Supplier Co.'),
            });

            const [updated] = await db.update(suppliers)
                .set({
                    name: 'Updated Supplier Co.',
                    contactInfo: '555-8888',
                    address: 'Updated Address'
                })
                .where(eq(suppliers.id, supplier!.id))
                .returning();

            expect(updated.name).toBe('Updated Supplier Co.');
            expect(updated.contactInfo).toBe('555-8888');
            expect(updated.address).toBe('Updated Address');
        });

        it('should delete supplier', async () => {
            const supplier = await db.query.suppliers.findFirst({
                where: eq(suppliers.name, 'Test Supplier Co.'),
            });

            await db.delete(suppliers).where(eq(suppliers.id, supplier!.id));

            const deleted = await db.query.suppliers.findFirst({
                where: eq(suppliers.id, supplier!.id),
            });

            expect(deleted).toBeUndefined();
        });

        it('should allow suppliers with same contact info', async () => {
            // Suppliers can have same contact info (different companies)
            const [supplier2] = await db.insert(suppliers).values({
                name: 'Different Supplier Co.',
                contactInfo: '555-0003', // Same as existing
                address: 'Different Address',
            }).returning();

            expect(supplier2).toBeDefined();
            expect(supplier2.name).toBe('Different Supplier Co.');
        });
    });

    describe('Master Data Relationships', () => {
        it('should link products to categories and brands', async () => {
            const product = await db.query.products.findFirst({
                where: eq(products.sku, 'TEST-001'),
                with: {
                    category: true,
                    brand: true,
                },
            });

            expect(product?.category?.name).toBe('Test Category');
            expect(product?.brand?.name).toBe('Test Brand');
        });

        it('should link inventory to suppliers', async () => {
            // Create inventory with supplier
            const [inv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                supplierId: testData.suppliers.supplier.id,
                quantity: 100,
            }).returning();

            const inventoryItem = await db.query.inventory.findFirst({
                where: eq(inventory.id, inv.id),
                with: {
                    supplier: true,
                },
            });

            expect(inventoryItem?.supplier?.name).toBe('Test Supplier Co.');
        });

        it('frees a category and a brand once their last product is gone', async () => {
            // A product holds its category and brand in place. Remove every product that uses them
            // and the master data becomes deletable - nothing cascades silently in either direction.
            const [product] = await db.insert(products).values({
                name: 'Cascade Test Product',
                sku: 'CASCADE-001',
                price: '50.00',
                categoryId: testData.categories.category.id,
                brandId: testData.brands.brand.id,
            }).returning();

            await expect(
                db.delete(categories).where(eq(categories.id, testData.categories.category.id))
            ).rejects.toThrow();

            // The seeded product carries the same category and brand, so both have to go.
            await db.delete(products).where(eq(products.id, product.id));
            await db.delete(products).where(eq(products.id, testData.products.product.id));

            await db.delete(categories).where(eq(categories.id, testData.categories.category.id));
            await db.delete(brands).where(eq(brands.id, testData.brands.brand.id));

            expect(
                await db.query.categories.findFirst({
                    where: eq(categories.id, testData.categories.category.id),
                })
            ).toBeUndefined();
            expect(
                await db.query.brands.findFirst({
                    where: eq(brands.id, testData.brands.brand.id),
                })
            ).toBeUndefined();
        });
    });
});
