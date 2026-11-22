import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { Express } from 'express';
import { db } from '../../../db';
import { company } from '../../../db/schema';
import {
    CompanyError,
    findCompanyRecord,
    getCompanyHeader,
    getCompanyInfo,
    saveCompany,
} from '../../../server/company';
import { registerCompanyRoutes } from '../../../server/routes/company';
import { COMPANY_FIELDS, COMPANY_SINGLETON_ID } from '../../../shared/company';
import { cleanDatabase, resetSequences, resetTestDatabase } from '../../helpers/test-db';
import { makeRes, recordRoutes as harnessRecordRoutes } from '../../helpers/route-harness';

/**
 * The company letterhead.
 *
 * Every printed document and the band at the top of every screen depend on this one row,
 * so the things pinned here are the ones a future change could quietly break: that there is
 * only ever one row, that a blank field is a *refusal* rather than a document with holes, and
 * that the four labels come from the same list the client renders.
 */

const COMPLETE = {
    companyName: 'Pet Products Trading Co., Ltd.',
    registeredAddress: '12 Le Loi, District 1, HCMC',
    deliveryAddress: '99 Nguyen Trai, District 5, HCMC',
    taxId: '0312345678',
};

const ALL_LABELS = COMPANY_FIELDS.map((field) => field.label);

describe('company letterhead', () => {
    beforeAll(async () => {
        await resetTestDatabase();
    });

    beforeEach(async () => {
        await cleanDatabase();
        await resetSequences();
    });

    afterEach(async () => {
        await cleanDatabase();
    });

    it('reports every field as missing on a database that has never been set up', async () => {
        const info = await getCompanyInfo();

        expect(info.record).toBeNull();
        expect(info.header).toBeNull();
        expect(info.valid).toBe(false);
        expect(info.missingFields).toEqual(ALL_LABELS);
    });

    it('creates the singleton row and edits it in place on the next save', async () => {
        await saveCompany(COMPLETE);
        await saveCompany({ ...COMPLETE, companyName: 'Renamed Co.' });

        const rows = await db.select().from(company);
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(COMPANY_SINGLETON_ID);
        expect(rows[0].companyName).toBe('Renamed Co.');
    });

    it('refuses a second company row at the database level', async () => {
        await saveCompany(COMPLETE);

        await expect(db.insert(company).values({ id: 2, ...COMPLETE })).rejects.toThrow();
    });

    it('throws a CompanyError naming the blank field instead of printing', async () => {
        await db.insert(company).values({ id: COMPANY_SINGLETON_ID, ...COMPLETE, taxId: '   ' });

        const error = await getCompanyHeader().catch((err: unknown) => err);

        expect(error).toBeInstanceOf(CompanyError);
        expect((error as CompanyError).missingFields).toEqual(['Tax ID']);
        expect((error as CompanyError).message).toContain('Tax ID');
        expect((error as CompanyError).status).toBe(422);
    });

    it('refuses to save a letterhead with a blank field', async () => {
        await expect(
            saveCompany({ ...COMPLETE, deliveryAddress: '  ' })
        ).rejects.toBeInstanceOf(CompanyError);

        expect(await findCompanyRecord()).toBeNull();
    });

    it('trims the stored values, so a stray space is not a company name', async () => {
        await saveCompany({
            companyName: '  Pet Products Trading Co., Ltd.  ',
            registeredAddress: ' 12 Le Loi, District 1, HCMC ',
            deliveryAddress: '99 Nguyen Trai, District 5, HCMC ',
            taxId: ' 0312345678 ',
        });

        const record = await findCompanyRecord();
        expect(record?.companyName).toBe('Pet Products Trading Co., Ltd.');
        expect(record?.taxId).toBe('0312345678');

        expect(await getCompanyHeader()).toEqual(COMPLETE);
    });
});

describe('company routes', () => {
    type Registration = { method: string; path: string; handlers: unknown[] };

    function recordCompanyRoutes(): Registration[] {
        const registrations: Registration[] = [];

        const app = {
            get: (path: string, ...handlers: unknown[]) =>
                registrations.push({ method: 'GET', path, handlers }),
            put: (path: string, ...handlers: unknown[]) =>
                registrations.push({ method: 'PUT', path, handlers }),
        } as unknown as Express;

        registerCompanyRoutes(app);
        return registrations;
    }

    const registrations = recordCompanyRoutes();

    it('registers the read and the write endpoint exactly once each', () => {
        const keys = registrations.map((r) => `${r.method} ${r.path}`);

        expect(keys.sort()).toEqual(['GET /api/company', 'PUT /api/company']);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('lets an authenticated user read the letterhead', () => {
        const get = registrations.find((r) => r.method === 'GET');

        // [requireAuth, handler]
        expect(get?.handlers).toHaveLength(2);
    });

    it('gates the write behind a permission check and a validator', () => {
        const put = registrations.find((r) => r.method === 'PUT');

        // [requirePermission(companyProfile, update), validateBody, handler]
        expect(put?.handlers.length).toBeGreaterThanOrEqual(3);
        expect(typeof put?.handlers[put.handlers.length - 1]).toBe('function');
    });
});

describe('company letterhead permissions', () => {
    /** The first handler express would run - the permission middleware. */
    const permissionMiddleware = () => {
        const entry = harnessRecordRoutes(registerCompanyRoutes).find(
            (candidate) => candidate.method === 'PUT' && candidate.path === '/api/company',
        );
        if (!entry) throw new Error('route not registered: PUT /api/company');
        return entry.handlers[0] as unknown as (
            req: unknown,
            res: unknown,
            next: (error?: unknown) => void,
        ) => Promise<unknown>;
    };

    /** A signed-in staff user; staff roles get exactly what their permission JSON grants. */
    const staffRequest = (permissions: Record<string, unknown>) =>
        ({
            isAuthenticated: () => true,
            user: {
                id: 1,
                username: 'cashier',
                role: { name: 'cashier', hierarchyLevel: 'staff', permissions },
            },
        }) as never;

    it('keeps the letterhead readable on every screen without the Company Profile module', async () => {
        // The band renders on the POS and the receipts screen too; gating the read would blank
        // the letterhead on screens a cashier opens all day.
        const get = harnessRecordRoutes(registerCompanyRoutes).find(
            (candidate) => candidate.method === 'GET' && candidate.path === '/api/company',
        );

        // [requireAuth, handler] - no permission middleware.
        expect(get?.handlers).toHaveLength(2);
    });

    it('gates editing the letterhead on companyProfile.update, not masterData.update', async () => {
        const deniedRes = makeRes();
        const deniedNext = vi.fn();

        await permissionMiddleware()(
            staffRequest({ masterData: { create: true, read: true, update: true, delete: true } }),
            deniedRes,
            deniedNext,
        );

        expect(deniedNext).not.toHaveBeenCalled();
        expect(deniedRes.statusCode).toBe(403);
        expect((deniedRes.body as { message: string }).message).toContain('companyProfile update');

        const allowedRes = makeRes();
        const allowedNext = vi.fn();

        await permissionMiddleware()(
            staffRequest({ companyProfile: { read: true, update: true } }),
            allowedRes,
            allowedNext,
        );

        expect(allowedNext).toHaveBeenCalledTimes(1);
    });

    it('refuses a read-only Company Profile grant', async () => {
        const res = makeRes();
        const next = vi.fn();

        await permissionMiddleware()(
            staffRequest({ companyProfile: { read: true, update: false } }),
            res,
            next,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });
});
