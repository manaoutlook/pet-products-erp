import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { inventory, stores, transferRequests, userStoreAssignments } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { cleanDatabase, resetSequences, seedTestData, resetTestDatabase } from '../../helpers/test-db';
import {
    getStoreDeletionBlockers,
    hasBlockers,
    buildStoreDeletionError,
} from '../../../server/store-deletion';

/**
 * Store deletion guard.
 *
 * These tests exercise the same function the DELETE /api/stores/:id route calls,
 * so they cover the rule that a store cannot be removed while inventory, user
 * assignments or transaction history still point at it - including inventory that
 * is only pinned by the free-text `location` column (that column has no foreign
 * key, so Postgres alone would happily orphan the rows).
 */
describe('Store Deletion Guard', () => {
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

    describe('unreferenced store', () => {
        it('reports no blockers when nothing points at the store', async () => {
            const blockers = await getStoreDeletionBlockers(
                testData.stores.store1.id,
                testData.stores.store1.location,
            );

            expect(blockers).toEqual({
                inventoryByStore: 0,
                inventoryByLocation: 0,
                assignments: 0,
                orders: 0,
                salesTransactions: 0,
                purchaseOrders: 0,
                transfers: 0,
            });
            expect(hasBlockers(blockers)).toBe(false);
        });

        it('lets the store be deleted once no blockers remain', async () => {
            await db.delete(stores).where(eq(stores.id, testData.stores.store1.id));

            const remaining = await db.query.stores.findFirst({
                where: eq(stores.id, testData.stores.store1.id),
            });

            expect(remaining).toBeUndefined();
        });
    });

    describe('inventory assigned by store id', () => {
        it('blocks deletion and explains what to move', async () => {
            await db.insert(inventory).values({
                storeId: testData.stores.store1.id,
                productId: testData.products.product.id,
                quantity: 12,
                location: 'Aisle 1',
            });

            const blockers = await getStoreDeletionBlockers(
                testData.stores.store1.id,
                testData.stores.store1.location,
            );

            expect(blockers.inventoryByStore).toBe(1);
            expect(blockers.inventoryByLocation).toBe(0);
            expect(hasBlockers(blockers)).toBe(true);

            const error = buildStoreDeletionError(
                testData.stores.store1.name,
                testData.stores.store1.location,
                blockers,
            );

            expect(error.message).toContain('Cannot delete store "Test Store 1"');
            expect(error.message).toContain('1 inventory record(s)');
            expect(error.suggestion).toContain('transfer or remove the inventory');
        });
    });

    describe('inventory assigned only by location', () => {
        it('blocks deletion when stock is pinned to the store location without a store id', async () => {
            // No store_id: the row is bound to the store purely by location text.
            await db.insert(inventory).values({
                storeId: null,
                productId: testData.products.product.id,
                quantity: 4,
                // Deliberately messy casing/spacing to prove the match is normalised.
                location: '  test LOCATION 1 ',
            });

            const blockers = await getStoreDeletionBlockers(
                testData.stores.store1.id,
                testData.stores.store1.location,
            );

            expect(blockers.inventoryByStore).toBe(0);
            expect(blockers.inventoryByLocation).toBe(1);
            expect(hasBlockers(blockers)).toBe(true);

            const error = buildStoreDeletionError(
                testData.stores.store1.name,
                testData.stores.store1.location,
                blockers,
            );

            expect(error.message).toContain('1 inventory record(s) assigned to the location "Test Location 1"');
            expect(error.suggestion).toContain('reassign or remove the inventory at this location');
        });

        it('ignores location matches that belong to another store by id', async () => {
            await db.insert(inventory).values({
                storeId: testData.stores.warehouse.id,
                productId: testData.products.product.id,
                quantity: 2,
                location: testData.stores.store1.location,
            });

            const blockers = await getStoreDeletionBlockers(
                testData.stores.store1.id,
                testData.stores.store1.location,
            );

            expect(blockers.inventoryByStore).toBe(0);
            expect(blockers.inventoryByLocation).toBe(0);
            expect(hasBlockers(blockers)).toBe(false);
        });

        it('does not match blank locations against each other', async () => {
            await db.insert(inventory).values({
                storeId: null,
                productId: testData.products.product.id,
                quantity: 1,
                location: '   ',
            });

            const blockers = await getStoreDeletionBlockers(testData.stores.store1.id, '  ');

            expect(blockers.inventoryByLocation).toBe(0);
            expect(hasBlockers(blockers)).toBe(false);
        });

        it('handles a store with no location value', async () => {
            await db.insert(inventory).values({
                storeId: null,
                productId: testData.products.product.id,
                quantity: 1,
                location: 'Somewhere',
            });

            const blockers = await getStoreDeletionBlockers(testData.stores.store1.id, null);

            expect(blockers.inventoryByLocation).toBe(0);
            expect(hasBlockers(blockers)).toBe(false);
        });
    });

    describe('other references', () => {
        it('blocks deletion when users are assigned to the store', async () => {
            await db.insert(userStoreAssignments).values({
                userId: testData.users.admin.id,
                storeId: testData.stores.store1.id,
            });

            const blockers = await getStoreDeletionBlockers(
                testData.stores.store1.id,
                testData.stores.store1.location,
            );

            expect(blockers.assignments).toBe(1);

            const error = buildStoreDeletionError(
                testData.stores.store1.name,
                testData.stores.store1.location,
                blockers,
            );

            expect(error.message).toContain('1 user assignment(s)');
            expect(error.suggestion).toContain('remove the user store assignments');
        });

        it('blocks deletion when the store has stock transfer history', async () => {
            await db.insert(transferRequests).values({
                transferNumber: 'TRF-DEL-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
            });

            const blockers = await getStoreDeletionBlockers(
                testData.stores.store1.id,
                testData.stores.store1.location,
            );

            expect(blockers.transfers).toBe(1);

            const error = buildStoreDeletionError(
                testData.stores.store1.name,
                testData.stores.store1.location,
                blockers,
            );

            expect(error.message).toContain('1 stock transfer(s)');
            expect(error.suggestion).toContain('kept for reporting');
        });

        it('reports movable records and transaction history in one message', async () => {
            await db.insert(inventory).values({
                storeId: testData.stores.store1.id,
                productId: testData.products.product.id,
                quantity: 3,
                location: 'Aisle 2',
            });
            await db.insert(inventory).values({
                storeId: null,
                productId: testData.products.product.id,
                quantity: 1,
                location: testData.stores.store1.location,
            });
            await db.insert(userStoreAssignments).values({
                userId: testData.users.admin.id,
                storeId: testData.stores.store1.id,
            });
            await db.insert(transferRequests).values({
                transferNumber: 'TRF-DEL-002',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
            });

            const blockers = await getStoreDeletionBlockers(
                testData.stores.store1.id,
                testData.stores.store1.location,
            );

            expect(blockers.inventoryByStore).toBe(1);
            expect(blockers.inventoryByLocation).toBe(1);
            expect(blockers.assignments).toBe(1);
            expect(blockers.transfers).toBe(1);

            const error = buildStoreDeletionError(
                testData.stores.store1.name,
                testData.stores.store1.location,
                blockers,
            );

            expect(error.message).toContain('1 inventory record(s)');
            expect(error.message).toContain('assigned to the location "Test Location 1"');
            expect(error.message).toContain('1 user assignment(s)');
            expect(error.message).toContain('1 stock transfer(s)');
            // Both actionable fixes come before the "frozen history" explanation.
            expect(error.suggestion).toMatch(/^Please .+ first\./);
            expect(error.suggestion).toContain('kept for reporting');
        });
    });
});

