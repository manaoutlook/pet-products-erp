import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { products, categories, brands } from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData, resetTestDatabase } from '../../helpers/test-db';
import { eq } from 'drizzle-orm';

describe('Products API Tests', () => {
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

    describe('Product CRUD Operations', () => {
        it('should create a new product', async () => {
            const [newProduct] = await db.insert(products).values({
                name: 'New Test Product',
                description: 'New product description',
                sku: 'NEW-001',
                price: '150.00',
                categoryId: testData.categories.category.id,
                brandId: testData.brands.brand.id,
                minStock: 15,
            }).returning();

            expect(newProduct).toBeDefined();
            expect(newProduct.name).toBe('New Test Product');
            expect(newProduct.sku).toBe('NEW-001');
            expect(newProduct.price).toBe('150.00');
        });

        it('should read product with relationships', async () => {
            const product = await db.query.products.findFirst({
                where: eq(products.sku, 'TEST-001'),
                with: {
                    category: true,
                    brand: true,
                },
            });

            expect(product).toBeDefined();
            expect(product?.category.name).toBe('Test Category');
            expect(product?.brand?.name).toBe('Test Brand');
        });

        it('should update product details', async () => {
            const product = await db.query.products.findFirst({
                where: eq(products.sku, 'TEST-001'),
            });

            const [updated] = await db.update(products)
                .set({ price: '120.00', minStock: 20 })
                .where(eq(products.id, product!.id))
                .returning();

            expect(updated.price).toBe('120.00');
            expect(updated.minStock).toBe(20);
        });

        it('should delete product', async () => {
            const product = await db.query.products.findFirst({
                where: eq(products.sku, 'TEST-001'),
            });

            await db.delete(products).where(eq(products.id, product!.id));

            const deleted = await db.query.products.findFirst({
                where: eq(products.id, product!.id),
            });

            expect(deleted).toBeUndefined();
        });
    });

    describe('Product Validation', () => {
        it('should enforce unique SKU', async () => {
            await expect(async () => {
                await db.insert(products).values({
                    name: 'Duplicate SKU Product',
                    description: 'Test',
                    sku: 'TEST-001', // Duplicate SKU
                    price: '100.00',
                    categoryId: testData.categories.category.id,
                    brandId: testData.brands.brand.id,
                    minStock: 10,
                });
            }).rejects.toThrow();
        });

        it('should require valid category', async () => {
            await expect(async () => {
                await db.insert(products).values({
                    name: 'Invalid Category Product',
                    description: 'Test',
                    sku: 'INVALID-001',
                    price: '100.00',
                    categoryId: 99999, // Non-existent category
                    brandId: testData.brands.brand.id,
                    minStock: 10,
                });
            }).rejects.toThrow();
        });

        it('should allow null brand', async () => {
            const [product] = await db.insert(products).values({
                name: 'No Brand Product',
                description: 'Test',
                sku: 'NOBRAND-001',
                price: '100.00',
                categoryId: testData.categories.category.id,
                brandId: null,
                minStock: 10,
            }).returning();

            expect(product.brandId).toBeNull();
        });
    });

    describe('Product Search and Filter', () => {
        it('should find products by SKU', async () => {
            const product = await db.query.products.findFirst({
                where: eq(products.sku, 'TEST-001'),
            });

            expect(product).toBeDefined();
            expect(product?.name).toBe('Test Product');
        });

        it('should find products by category', async () => {
            const categoryProducts = await db.query.products.findMany({
                where: eq(products.categoryId, testData.categories.category.id),
            });

            expect(categoryProducts.length).toBeGreaterThan(0);
            expect(categoryProducts[0].categoryId).toBe(testData.categories.category.id);
        });

        it('should find products by brand', async () => {
            const brandProducts = await db.query.products.findMany({
                where: eq(products.brandId, testData.brands.brand.id),
            });

            expect(brandProducts.length).toBeGreaterThan(0);
            expect(brandProducts[0].brandId).toBe(testData.brands.brand.id);
        });
    });

    describe('Product Stock Management', () => {
        it('should track minimum stock level', async () => {
            const product = await db.query.products.findFirst({
                where: eq(products.sku, 'TEST-001'),
            });

            expect(product?.minStock).toBe(10);
        });

        it('should update minimum stock level', async () => {
            const product = await db.query.products.findFirst({
                where: eq(products.sku, 'TEST-001'),
            });

            const [updated] = await db.update(products)
                .set({ minStock: 25 })
                .where(eq(products.id, product!.id))
                .returning();

            expect(updated.minStock).toBe(25);
        });
    });
});
