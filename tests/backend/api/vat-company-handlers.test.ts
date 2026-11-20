import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { db } from '../../../db';
import { and, eq } from 'drizzle-orm';
import { invoiceCounters, vatCompanies } from '../../../db/schema';
import { ensureVatCompanySeeds, registerVatCompanyRoutes } from '../../../server/routes/vat-companies';
import { cleanDatabase, resetSequences, resetTestDatabase } from '../../helpers/test-db';
import { handlerFor, invoke, recordRoutes, type RouteRegistration } from '../../helpers/route-harness';

/**
 * The VAT-company handlers.
 *
 * The schema tests next door pin what a body must look like; these pin what the endpoints do
 * with it - the parts the screen sees: the read shape the sales-order form renders, the 409
 * on a duplicate code (which the unique index would otherwise surface as a 500), the 404 on an
 * edit of a deleted company, and the counter a new company needs before it can issue anything.
 */

describe('VAT company handlers', () => {
    let routes: RouteRegistration[];

    beforeAll(async () => {
        await resetTestDatabase();
    });

    beforeEach(async () => {
        await cleanDatabase();
        await resetSequences();
        routes = recordRoutes(registerVatCompanyRoutes);
    });

    afterEach(async () => {
        await cleanDatabase();
    });

    it('lists companies in code order with their rate as a number', async () => {
        await db.insert(vatCompanies).values([
            { code: 'HI', name: 'HI Trading', vatRate: '0.0800' },
            { code: 'CI', name: 'CI Trading', vatRate: '0.1000' },
        ]);

        const res = await invoke(handlerFor(routes, 'GET', '/api/vat-companies'));

        expect(res.statusCode).toBe(200);
        expect(res.body.companies.map((company: { code: string }) => company.code)).toEqual(['CI', 'HI']);
        // DECIMAL comes back as a string from Postgres; the screen does arithmetic with it.
        expect(res.body.companies[0].vatRate).toBe(0.1);
        expect(typeof res.body.companies[0].vatRate).toBe('number');
    });

    it('reports what is still missing on a seeded company as data, not as an error', async () => {
        await ensureVatCompanySeeds();

        const res = await invoke(handlerFor(routes, 'GET', '/api/vat-companies'));

        expect(res.statusCode).toBe(200);
        expect(res.body.companies).toHaveLength(2);
        for (const company of res.body.companies) {
            expect(company.missingFields.length).toBeGreaterThan(0);
        }
    });

    it('creates a company and opens its own invoice sequence', async () => {
        const res = await invoke(handlerFor(routes, 'POST', '/api/vat-companies'), {
            body: { code: 'AB', name: 'ABC Trading Co., Ltd.', taxId: '0312345678', address: '1 Le Loi' },
        });

        expect(res.statusCode).toBe(201);
        expect(res.body.message).toBe('VAT company created');
        expect(res.body.company).toMatchObject({ code: 'AB', name: 'ABC Trading Co., Ltd.' });

        const [counter] = await db
            .select()
            .from(invoiceCounters)
            .where(
                and(
                    eq(invoiceCounters.vatCompanyId, res.body.company.id),
                    eq(invoiceCounters.counterType, 'VAT_COMPANY'),
                ),
            );

        expect(counter?.prefix).toBe('AB-');
    });

    it('falls back to the default VAT rate when the body omits one', async () => {
        const res = await invoke(handlerFor(routes, 'POST', '/api/vat-companies'), {
            body: { code: 'AB', name: 'ABC Trading Co., Ltd.' },
        });

        expect(res.body.company.vatRate).toBe(0.1);
    });

    it('answers 409 instead of crashing when the code is already used', async () => {
        await invoke(handlerFor(routes, 'POST', '/api/vat-companies'), {
            body: { code: 'AB', name: 'ABC Trading Co., Ltd.' },
        });

        const res = await invoke(handlerFor(routes, 'POST', '/api/vat-companies'), {
            body: { code: 'AB', name: 'Another Co., Ltd.' },
        });

        expect(res.statusCode).toBe(409);
        expect(res.body.suggestion).toBeTruthy();
    });

    it('reports 404 when editing a company that no longer exists', async () => {
        const res = await invoke(handlerFor(routes, 'PUT', '/api/vat-companies/:id'), {
            body: { name: 'Ghost Co.' },
            params: { id: 9999 },
        });

        expect(res.statusCode).toBe(404);
        expect(res.body.message).toBe('VAT company not found');
    });

    it('saves an edited company, keeping its code and its own rate', async () => {
        const [company] = await db
            .insert(vatCompanies)
            .values({ code: 'AB', name: 'ABC Trading', vatRate: '0.1000' })
            .returning();

        const res = await invoke(handlerFor(routes, 'PUT', '/api/vat-companies/:id'), {
            body: {
                name: 'ABC Trading Co., Ltd.',
                taxId: '0312345678',
                address: '12 Le Loi, District 1',
                phone: '028 1234 5678',
                vatRate: 0.085,
            },
            params: { id: company.id },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('VAT company saved');
        expect(res.body.company).toMatchObject({
            id: company.id,
            code: 'AB',
            name: 'ABC Trading Co., Ltd.',
            taxId: '0312345678',
            address: '12 Le Loi, District 1',
        });
        // The rate is stored as a fraction at the column's four-decimal scale.
        expect(res.body.company.vatRate).toBe(0.085);
        // The two fields that were missing are now filled in.
        expect(res.body.company.missingFields).toEqual([]);

        const [stored] = await db.select().from(vatCompanies).where(eq(vatCompanies.id, company.id));
        expect(stored.vatRate).toBe('0.0850');
    });

    it('leaves untouched fields alone and can deactivate a company', async () => {
        const [company] = await db
            .insert(vatCompanies)
            .values({
                code: 'AB',
                name: 'ABC Trading',
                taxId: '0312345678',
                address: '1 Le Loi',
                vatRate: '0.0800',
            })
            .returning();

        const res = await invoke(handlerFor(routes, 'PUT', '/api/vat-companies/:id'), {
            body: { isActive: false },
            params: { id: company.id },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.company).toMatchObject({
            isActive: false,
            name: 'ABC Trading',
            taxId: '0312345678',
            vatRate: 0.08,
        });
    });
});
