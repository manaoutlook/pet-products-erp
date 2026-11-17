import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import type { Express } from 'express';
import { db } from '../../../db';
import { invoiceCounters, vatCompanies } from '../../../db/schema';
import { and, eq } from 'drizzle-orm';
import {
  ensureVatCompanySeeds,
  registerVatCompanyRoutes,
  vatCompanyBodySchema,
} from '../../../server/routes/vat-companies';
import { initializeVatCompanyCounter } from '../../../server/invoice-counter';
import { VAT_COMPANY_SEEDS } from '../../../shared/invoice';
import { cleanDatabase, resetSequences, resetTestDatabase } from '../../helpers/test-db';

/**
 * VAT companies - the two legal entities a VAT invoice may be issued under.
 *
 * The bugs pinned here are the ones that stopped the screen from saving:
 *
 *   - typing a template (`CI-YYYY-MM-DD-NNNNN`) instead of the 2-10 character prefix, which the
 *     server rejected with a toast the operator could not act on;
 *   - `invoice_counters.counter_type` being VARCHAR(10) in databases created before the VAT
 *     feature, so `'VAT_COMPANY'` (11 characters) could never be written - the counter insert
 *     failed and the company could not be given an invoice sequence;
 *   - a database built by `npm run db:push` having the table but none of the seeded rows, while
 *     the API refuses to create the reserved codes CI/HI.
 */

describe('VAT company form validation', () => {
  const validCompany = { code: 'AB', name: 'ABC Trading Co., Ltd.' };

  it('accepts a plain 2-10 character prefix', () => {
    expect(vatCompanyBodySchema.safeParse(validCompany).success).toBe(true);
    expect(vatCompanyBodySchema.safeParse({ ...validCompany, code: 'VAT2026' }).success).toBe(true);
  });

  it('normalises lower case, so a cashier may type "ab"', () => {
    const parsed = vatCompanyBodySchema.parse({ ...validCompany, code: 'ab' });
    expect(parsed.code).toBe('AB');
  });

  it('rejects a template or anything with dashes', () => {
    const result = vatCompanyBodySchema.safeParse({
      ...validCompany,
      code: 'CI-YYYY-MM-DD-NNNNN',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('2-10 letters or digits');
    }
  });

  it('tells the operator to edit CI/HI instead of adding a second one', () => {
    const result = vatCompanyBodySchema.safeParse({ ...validCompany, code: 'CI' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('edit CI or HI');
    }
  });

  it('requires a company name', () => {
    expect(vatCompanyBodySchema.safeParse({ code: 'AB', name: '   ' }).success).toBe(false);
  });

  it('accepts the VAT rate as a fraction and rounds it to the column scale', () => {
    const parsed = vatCompanyBodySchema.parse({ ...validCompany, vatRate: 0.085 });

    // DECIMAL(5,4): 0.0850 = 8.5%. The screen sends a fraction, never "8.5".
    expect(parsed.vatRate).toBeCloseTo(0.085, 4);
  });

  it('leaves the rate out when none is sent, so the 10% column default applies', () => {
    expect(vatCompanyBodySchema.parse(validCompany).vatRate).toBeUndefined();
  });

  it('rejects a percentage sent where a fraction belongs', () => {
    // 8 means 800%. Catching this here is what stops a company from invoicing 8x the tax.
    const result = vatCompanyBodySchema.safeParse({ ...validCompany, vatRate: 8 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('between 0 and 100');
    }
  });

  it('rejects a negative rate', () => {
    expect(vatCompanyBodySchema.safeParse({ ...validCompany, vatRate: -0.1 }).success).toBe(false);
  });
});


describe('VAT company counters and seeds', () => {
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

  it('stores a counter with the VAT_COMPANY type and the company prefix', async () => {
    const [company] = await db
      .insert(vatCompanies)
      .values({ code: 'AB', name: 'ABC Trading Co., Ltd.' })
      .returning();

    // A company created without a rate charges the 10% standard rate.
    expect(Number(company.vatRate)).toBeCloseTo(0.1, 4);

    // 'VAT_COMPANY' is 11 characters - writing it used to fail with
    // "value too long for type character varying(10)".
    await initializeVatCompanyCounter(company.id, company.code);

    const counter = await db.query.invoiceCounters.findFirst({
      where: and(
        eq(invoiceCounters.counterType, 'VAT_COMPANY'),
        eq(invoiceCounters.vatCompanyId, company.id)
      ),
    });

    expect(counter).toBeTruthy();
    expect(counter?.prefix).toBe('AB-');
    expect(counter?.storeId).toBeNull();
    expect(counter?.currentNumber).toBe(0);
  });

  it('creates CI and HI with a counter each, however the table was created', async () => {
    // A push-created database has the table but no rows - the app must not depend on the
    // migration having been applied for the two licensed companies to exist.
    expect(await db.query.vatCompanies.findMany()).toHaveLength(0);

    await ensureVatCompanySeeds();

    const companies = await db.query.vatCompanies.findMany();
    expect(companies.map((company) => company.code).sort()).toEqual(
      VAT_COMPANY_SEEDS.map((seed) => seed.code).sort()
    );

    const counters = await db.query.invoiceCounters.findMany();
    expect(counters).toHaveLength(2);
    expect(counters.every((counter) => counter.counterType === 'VAT_COMPANY')).toBe(true);
  });

  it('is safe to run on every boot and never duplicates a company', async () => {
    await ensureVatCompanySeeds();
    await ensureVatCompanySeeds();

    expect(await db.query.vatCompanies.findMany()).toHaveLength(2);
    expect(await db.query.invoiceCounters.findMany()).toHaveLength(2);
  });
});


describe('VAT company routes', () => {
  type Registration = { method: string; path: string; handlers: unknown[] };

  function recordRoutes(): Registration[] {
    const registrations: Registration[] = [];

    const app = {
      get: (path: string, ...handlers: unknown[]) =>
        registrations.push({ method: 'GET', path, handlers }),
      post: (path: string, ...handlers: unknown[]) =>
        registrations.push({ method: 'POST', path, handlers }),
      put: (path: string, ...handlers: unknown[]) =>
        registrations.push({ method: 'PUT', path, handlers }),
    } as unknown as Express;

    registerVatCompanyRoutes(app);
    return registrations;
  }

  const registrations = recordRoutes();

  it('registers each endpoint exactly once', () => {
    const keys = registrations.map((registration) => `${registration.method} ${registration.path}`);

    expect(keys.sort()).toEqual([
      'GET /api/vat-companies',
      'POST /api/vat-companies',
      'PUT /api/vat-companies/:id',
    ]);
  });

  it('gates the writes behind a permission check and a validator', () => {
    for (const method of ['POST', 'PUT']) {
      const registration = registrations.find((entry) => entry.method === method);

      expect(registration?.handlers.length).toBeGreaterThanOrEqual(3);
      expect(typeof registration?.handlers[registration.handlers.length - 1]).toBe('function');
    }
  });
});
