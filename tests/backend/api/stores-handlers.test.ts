import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { db } from '../../../db';
import { and, eq } from 'drizzle-orm';
import { inventory, invoiceCounters, regions, stores } from '../../../db/schema';
import { registerStoreRoutes } from '../../../server/routes/stores';
import { cleanDatabase, resetSequences, resetTestDatabase } from '../../helpers/test-db';
import { handlerFor, invoke, recordRoutes, type RouteRegistration } from '../../helpers/route-harness';

/**
 * The store handlers themselves, not just the registration list.
 *
 * `server/routes/stores.ts` held the lowest coverage in the repo (7%): the module was only
 * ever asserted through `recordStoreRoutes()`, so none of the create/update/delete logic ran.
 * The behaviour pinned here is what the screen depends on:
 *
 *   - a store without a region is refused, because region-less stores are invisible to
 *     region-based access control;
 *   - a new store gets its invoice counter immediately, so its first sale can print a number;
 *   - a store that still has inventory or history is refused with a payload naming what
 *     blocks it (rather than a Postgres FK error the operator cannot act on);
 *   - deleting a clean store also removes its numbering state.
 */

describe('store handlers', () => {
    let routes: RouteRegistration[];
    let regionId: number;

    beforeAll(async () => {
        await resetTestDatabase();
    });

    beforeEach(async () => {
        await cleanDatabase();
        await resetSequences();

        routes = recordRoutes(registerStoreRoutes);

        const [region] = await db.insert(regions).values({ name: 'Test Region' }).returning();
        regionId = region.id;
    });

    afterEach(async () => {
        await cleanDatabase();
    });

    const createStore = async (overrides: Partial<typeof stores.$inferInsert> = {}) => {
        const [store] = await db
            .insert(stores)
            .values({
                name: 'Handler Store',
                location: 'Handler Location',
                contactInfo: '0900 000 000',
                type: 'RETAIL',
                regionId,
                ...overrides,
            })
            .returning();
        return store;
    };

    it('lists every store', async () => {
        await createStore({ name: 'Retail One' });
        await createStore({ name: 'Warehouse One', type: 'WAREHOUSE' });

        const res = await invoke(handlerFor(routes, 'GET', '/api/stores'));

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(res.body.map((store: { name: string }) => store.name).sort()).toEqual([
            'Retail One',
            'Warehouse One',
        ]);
    });

    it('refuses a store without a region', async () => {
        const res = await invoke(handlerFor(routes, 'POST', '/api/stores'), {
            body: { name: 'No Region', location: 'Somewhere', contactInfo: '0900' },
        });

        expect(res.statusCode).toBe(400);
        expect(res.body.errors).toEqual([{ field: 'regionId', message: 'Region is required' }]);
        expect(await db.query.stores.findMany()).toHaveLength(0);
    });

    it('refuses a second store with the same name', async () => {
        await createStore({ name: 'Duplicate' });

        const res = await invoke(handlerFor(routes, 'POST', '/api/stores'), {
            body: { name: 'Duplicate', location: 'Elsewhere', contactInfo: '0900', regionId },
        });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Store with this name already exists');
    });

    it('creates the store and opens its invoice counter', async () => {
        const res = await invoke(handlerFor(routes, 'POST', '/api/stores'), {
            body: {
                name: 'New Warehouse',
                location: 'Thu Duc',
                contactInfo: '0900 111 222',
                type: 'WAREHOUSE',
                regionId,
            },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('Store created successfully');
        expect(res.body.store).toMatchObject({ name: 'New Warehouse', type: 'WAREHOUSE', regionId });

        // The counter exists before the first sale, so numbering never depends on a sale
        // having happened first.
        const [counter] = await db
            .select()
            .from(invoiceCounters)
            .where(eq(invoiceCounters.storeId, res.body.store.id));

        expect(counter?.counterType).toBe('STORE');
        expect(counter?.prefix).toBe(`STR${String(res.body.store.id).padStart(3, '0')}-`);
    });

    it('defaults a store created without a type to RETAIL', async () => {
        const res = await invoke(handlerFor(routes, 'POST', '/api/stores'), {
            body: { name: 'Default Type', location: 'Hanoi', contactInfo: '0900', regionId },
        });

        expect(res.body.store.type).toBe('RETAIL');
    });

    it('reports 404 when updating a store that does not exist', async () => {
        const res = await invoke(handlerFor(routes, 'PUT', '/api/stores/:id'), {
            body: { name: 'Ghost', location: 'Nowhere', contactInfo: '0900', regionId },
            params: { id: 9999 },
        });

        expect(res.statusCode).toBe(404);
        expect(res.body.message).toBe('Store not found');
    });

    it("refuses to rename a store onto another store's name", async () => {
        const first = await createStore({ name: 'First' });
        await createStore({ name: 'Second' });

        const res = await invoke(handlerFor(routes, 'PUT', '/api/stores/:id'), {
            body: { name: 'Second', location: 'Somewhere', contactInfo: '0900', regionId },
            params: { id: first.id },
        });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Store with this name already exists');
    });

    it('updates name, location, contact info and type', async () => {
        const store = await createStore({ name: 'Before' });

        const res = await invoke(handlerFor(routes, 'PUT', '/api/stores/:id'), {
            body: {
                name: 'After',
                location: 'New Location',
                contactInfo: '0900 999 999',
                type: 'WAREHOUSE',
                regionId,
            },
            params: { id: store.id },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('Store updated successfully');
        expect(res.body.store).toMatchObject({
            id: store.id,
            name: 'After',
            location: 'New Location',
            contactInfo: '0900 999 999',
            type: 'WAREHOUSE',
        });

        const [reloaded] = await db.select().from(stores).where(eq(stores.id, store.id));
        expect(reloaded.name).toBe('After');
    });

    it('reports 404 when deleting a store that does not exist', async () => {
        const res = await invoke(handlerFor(routes, 'DELETE', '/api/stores/:id'), {
            params: { id: 9999 },
        });

        expect(res.statusCode).toBe(404);
        expect(res.body.message).toBe('Store not found');
    });

    it('refuses to delete a store that still holds inventory, naming the blocker', async () => {
        const store = await createStore({ name: 'Stocked Store' });

        // Inventory rows can be pinned to a store directly...
        await db.insert(inventory).values({
            storeId: store.id,
            location: store.location,
            quantity: 5,
        });

        // ...or only by the free-text location, which has no foreign key.
        await db.insert(inventory).values({
            storeId: null,
            location: `  ${store.location.toUpperCase()}  `,
            quantity: 3,
        });

        const res = await invoke(handlerFor(routes, 'DELETE', '/api/stores/:id'), {
            params: { id: store.id },
        });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain('Cannot delete store "Stocked Store"');
        expect(res.body.message).toContain('1 inventory record(s)');
        expect(res.body.suggestion).toContain('transfer or remove the inventory');

        // Nothing was removed.
        expect(await db.select().from(stores).where(eq(stores.id, store.id))).toHaveLength(1);
    });

    it('deletes a clean store together with its invoice counter', async () => {
        const store = await createStore({ name: 'Disposable' });
        await invoke(handlerFor(routes, 'POST', '/api/stores'), {
            body: { name: 'Unused Counter', location: 'Elsewhere', contactInfo: '0900', regionId },
        });

        const res = await invoke(handlerFor(routes, 'DELETE', '/api/stores/:id'), {
            params: { id: store.id },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('Store deleted successfully');

        expect(await db.select().from(stores).where(eq(stores.id, store.id))).toHaveLength(0);
        expect(
            await db
                .select()
                .from(invoiceCounters)
                .where(and(eq(invoiceCounters.storeId, store.id), eq(invoiceCounters.counterType, 'STORE'))),
        ).toHaveLength(0);
    });
});
