import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { db } from '../../../db';
import { company } from '../../../db/schema';
import { registerCompanyRoutes } from '../../../server/routes/company';
import { COMPANY_FIELDS, COMPANY_SINGLETON_ID } from '../../../shared/company';
import { cleanDatabase, resetSequences, resetTestDatabase } from '../../helpers/test-db';
import { handlerFor, invoke, recordRoutes, type RouteRegistration } from '../../helpers/route-harness';

/**
 * The `/api/company` handlers.
 *
 * The service tests next door pin what a letterhead means; these pin the two responses the
 * screen actually receives: an empty database answering with data (`valid: false` plus the
 * missing labels) instead of throwing, and a save that returns the reloaded row so the header
 * band updates without a second request.
 */

const COMPLETE = {
    companyName: 'Pet Products Trading Co., Ltd.',
    registeredAddress: '12 Le Loi, District 1, HCMC',
    deliveryAddress: '99 Nguyen Trai, District 5, HCMC',
    taxId: '0312345678',
};

const ALL_LABELS = COMPANY_FIELDS.map((field) => field.label);

describe('company handlers', () => {
    let routes: RouteRegistration[];

    beforeAll(async () => {
        await resetTestDatabase();
    });

    beforeEach(async () => {
        await cleanDatabase();
        await resetSequences();
        routes = recordRoutes(registerCompanyRoutes);
    });

    afterEach(async () => {
        await cleanDatabase();
    });

    it('answers an empty database with every missing label and a reason, not an error', async () => {
        const res = await invoke(handlerFor(routes, 'GET', '/api/company'));

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ company: null, header: null, valid: false });
        expect(res.body.missingFields).toEqual(ALL_LABELS);
        expect(res.body.message).toBeTruthy();
    });

    it('saves the letterhead and returns the reloaded company', async () => {
        const res = await invoke(handlerFor(routes, 'PUT', '/api/company'), { body: COMPLETE });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('Company information saved');
        expect(res.body.company).toMatchObject(COMPLETE);
        expect(res.body.valid).toBe(true);
        expect(res.body.missingFields).toEqual([]);
        expect(res.body.header?.companyName).toBe(COMPLETE.companyName);

        // Still exactly one row - PUT is an upsert on the singleton id.
        const rows = await db.select().from(company);
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(COMPANY_SINGLETON_ID);
    });

    it('edits the existing row instead of adding a second one', async () => {
        await invoke(handlerFor(routes, 'PUT', '/api/company'), { body: COMPLETE });

        const res = await invoke(handlerFor(routes, 'PUT', '/api/company'), {
            body: { ...COMPLETE, companyName: 'Renamed Co., Ltd.' },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.company.companyName).toBe('Renamed Co., Ltd.');
        expect(await db.select().from(company)).toHaveLength(1);

        const read = await invoke(handlerFor(routes, 'GET', '/api/company'));
        expect(read.body.company.companyName).toBe('Renamed Co., Ltd.');
    });
});
