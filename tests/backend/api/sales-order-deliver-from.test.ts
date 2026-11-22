import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { db } from '../../../db';
import { inventory, salesOrders, userStoreAssignments } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import {
    registerSalesOrderRoutes,
    registerSalesOrderWriteRoutes,
} from '../../../server/routes/sales-orders';
import { cleanDatabase, resetSequences, resetTestDatabase, seedTestData } from '../../helpers/test-db';
import { handlerFor, invoke, recordRoutes, type RouteRegistration } from '../../helpers/route-harness';

/**
 * "Deliver from" is an administrator's choice.
 *
 * The sales-order dialog lets an admin pick the location the goods leave from; everybody else
 * ships from the store they are assigned to (or the Distribution Centre when they have no
 * assignment). The UI only hides the control - the rule that matters is applied here, when the
 * order is saved, so a hand-made request cannot move an order onto another shop's stock.
 *
 * The handlers are invoked through the route harness with a fake `req.user`, and the location
 * the order actually landed on is read back out of the database - which is exactly what the
 * delivery note and the stock deduction use.
 */
describe('sales order "Deliver from" is admin-only', () => {
    let testData: Awaited<ReturnType<typeof seedTestData>>;
    let routes: RouteRegistration[];

    beforeAll(async () => {
        await resetTestDatabase();
    });

    beforeEach(async () => {
        await cleanDatabase();
        await resetSequences();
        testData = await seedTestData();

        routes = [
            ...recordRoutes(registerSalesOrderRoutes),
            ...recordRoutes(registerSalesOrderWriteRoutes),
        ];

        // Both locations can cover a one-unit order, so a failure below is always the rule and
        // never a stock shortage.
        await db.insert(inventory).values([
            { productId: testData.products.product.id, storeId: null, quantity: 500, inventoryType: 'DC' },
            {
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                quantity: 500,
                inventoryType: 'RETAIL',
            },
            {
                productId: testData.products.product.id,
                storeId: testData.stores.warehouse.id,
                quantity: 500,
                inventoryType: 'WAREHOUSE',
            },
        ]);
    });

    afterEach(async () => {
        await cleanDatabase();
    });

    /** The `req.user` shape `requireAuth` puts on the request. */
    const asUser = (user: { id: number; username: string }, role: typeof testData.roles.admin) => ({
        id: user.id,
        username: user.username,
        role,
    });

    const orderBody = (storeId?: number | null) => ({
        customerName: 'Nguyen Van A',
        companyName: 'Pet Shop A',
        items: [{ productId: testData.products.product.id, quantity: 1 }],
        ...(storeId === undefined ? {} : { storeId }),
    });

    const createOrder = (user: ReturnType<typeof asUser>, storeId?: number | null) =>
        invoke(handlerFor(routes, 'POST', '/api/sales-orders'), {
            user,
            body: orderBody(storeId),
        });

    const storeOf = async (orderId: number) => {
        const [row] = await db
            .select({ storeId: salesOrders.storeId })
            .from(salesOrders)
            .where(eq(salesOrders.id, orderId));
        return row?.storeId ?? null;
    };

    it('lets an administrator save the location they picked', async () => {
        const res = await createOrder(
            asUser(testData.users.admin, testData.roles.admin),
            testData.stores.store1.id,
        );

        expect(res.statusCode).toBe(201);
        expect(await storeOf(res.body.id)).toBe(testData.stores.store1.id);
    });

    it('pins a non-admin order to their assigned store, whatever the body says', async () => {
        await db
            .insert(userStoreAssignments)
            .values({ userId: testData.users.manager.id, storeId: testData.stores.store1.id });

        // The manager asks for the warehouse; the order still ships from their own shop.
        const res = await createOrder(
            asUser(testData.users.manager, testData.roles.manager),
            testData.stores.warehouse.id,
        );

        expect(res.statusCode).toBe(201);
        expect(await storeOf(res.body.id)).toBe(testData.stores.store1.id);
    });

    it('ships an unassigned user from the Distribution Centre, ignoring the body', async () => {
        const res = await createOrder(
            asUser(testData.users.manager, testData.roles.manager),
            testData.stores.store1.id,
        );

        expect(res.statusCode).toBe(201);
        // Null is the Distribution Centre - the only location an unassigned user may use.
        expect(await storeOf(res.body.id)).toBeNull();
    });

    it('keeps a non-admin from moving an existing order to another location', async () => {
        await db
            .insert(userStoreAssignments)
            .values({ userId: testData.users.manager.id, storeId: testData.stores.store1.id });

        const created = await createOrder(
            asUser(testData.users.admin, testData.roles.admin),
            testData.stores.store1.id,
        );
        const orderId = created.body.id;

        const res = await invoke(handlerFor(routes, 'PUT', '/api/sales-orders/:id'), {
            user: asUser(testData.users.manager, testData.roles.manager),
            params: { id: orderId },
            body: orderBody(testData.stores.warehouse.id),
        });

        expect(res.statusCode).toBe(200);
        expect(await storeOf(orderId)).toBe(testData.stores.store1.id);
    });

    it('still lets an administrator move an existing order', async () => {
        const created = await createOrder(
            asUser(testData.users.admin, testData.roles.admin),
            testData.stores.store1.id,
        );
        const orderId = created.body.id;

        const res = await invoke(handlerFor(routes, 'PUT', '/api/sales-orders/:id'), {
            user: asUser(testData.users.admin, testData.roles.admin),
            params: { id: orderId },
            body: orderBody(testData.stores.warehouse.id),
        });

        expect(res.statusCode).toBe(200);
        expect(await storeOf(orderId)).toBe(testData.stores.warehouse.id);
    });
});

