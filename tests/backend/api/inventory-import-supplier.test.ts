import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { inventory, products, suppliers } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { importInventory } from '../../../server/inventory-import';
import {
    cleanDatabase,
    resetSequences,
    seedTestData,
    resetTestDatabase,
} from '../../helpers/test-db';

/**
 * A stock row's supplier is derived from its product - `products.supplier_id` is the
 * single source of truth. The inventory import may not set a different one, even when
 * the spreadsheet has a Supplier column, and re-importing an old file repairs rows that
 * were written before that rule existed.
 */
describe('Inventory Import - supplier comes from the product', () => {
    let testData: Awaited<ReturnType<typeof seedTestData>>;

    beforeAll(async () => {
        await resetTestDatabase();
    });

    beforeEach(async () => {
        await cleanDatabase();
        await resetSequences();
        testData = await seedTestData();

        // The seed product has no supplier; give it one so "derived" is observable.
        await db
            .update(products)
            .set({ supplierId: testData.suppliers.supplier.id })
            .where(eq(products.id, testData.products.product.id));
    });

    afterEach(async () => {
        await cleanDatabase();
    });

    const row = (supplier: string) => ({
        productSku: testData.products.product.sku,
        inventoryType: 'DC',
        quantity: '5',
        supplier,
    });

    it('ignores a supplier in the file and copies the product supplier', async () => {
        const [otherSupplier] = await db
            .insert(suppliers)
            .values({ name: 'Other Supplier', contactInfo: '555-9999', address: 'Elsewhere' })
            .returning();

        const result = await importInventory([row(otherSupplier.name)]);

        expect(result.created).toBe(1);
        expect(result.errors).toEqual([]);

        const [stock] = await db.select().from(inventory);
        expect(stock.supplierId).toBe(testData.suppliers.supplier.id);
        expect(stock.supplierId).not.toBe(otherSupplier.id);
    });

    it('repairs an existing row whose supplier disagreed with its product', async () => {
        const [otherSupplier] = await db
            .insert(suppliers)
            .values({ name: 'Legacy Placeholder', contactInfo: '555-0000', address: 'Nowhere' })
            .returning();

        await db.insert(inventory).values({
            productId: testData.products.product.id,
            quantity: 2,
            inventoryType: 'DC',
            supplierId: otherSupplier.id,
        });

        const result = await importInventory([row(otherSupplier.name)]);

        expect(result.updated).toBe(1);
        const [stock] = await db.select().from(inventory);
        expect(stock.supplierId).toBe(testData.suppliers.supplier.id);
    });

    it('leaves the supplier empty when the product has none', async () => {
        const [otherSupplier] = await db
            .insert(suppliers)
            .values({ name: 'Unrelated Supplier', contactInfo: '555-1111', address: 'Elsewhere' })
            .returning();
        await db
            .update(products)
            .set({ supplierId: null })
            .where(eq(products.id, testData.products.product.id));

        await importInventory([row(otherSupplier.name)]);

        const [stock] = await db.select().from(inventory);
        expect(stock.supplierId).toBeNull();
    });
});
