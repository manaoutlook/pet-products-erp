import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import {
  inventory,
  products,
  websiteChannels,
  websiteProductLinks,
  websiteStockState,
} from '../../../db/schema';
import { cleanDatabase, resetTestDatabase, seedTestData } from '../../helpers/test-db';
import { makeRes, recordRoutes } from '../../helpers/route-harness';
import {
  buildStockUpdatePayload,
  chunk,
  clampQuantity,
  groupVariationsByParent,
  maskSecret,
  normaliseBaseUrl,
  parseBatchResponse,
  planStockSync,
  resolveStockFields,
  wooApiUrl,
  type PlannedStockItem,
  type WebsiteLinkRow,
} from '../../../shared/woocommerce';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../../../server/integration-secrets';
import { WooCommerceClient } from '../../../server/woocommerce/client';
import { registerWebsiteSyncRoutes } from '../../../server/routes/website-sync';
import { createChannel, listChannels, updateChannel } from '../../../server/woocommerce/channels';
import { loadStockSnapshot } from '../../../server/woocommerce/stock-snapshot';
import { listSyncRuns, previewStockSync, runStockSync } from '../../../server/woocommerce/sync';

/**
 * Website stock sync.
 *
 * The push writes to two live shops, so the rules that decide *what* is written are pinned here
 * without a network first: the clamp, the three WooCommerce fields, the delta rules, and the fact
 * that a batch answers 200 even when a line inside it failed.
 *
 * The database half then checks the parts that must not drift: the SUM over every shelf, the
 * encrypted key, and a run with nothing to send (which completes the whole transaction, advisory
 * lock included, without touching a shop).
 */

const link = (overrides: Partial<WebsiteLinkRow> = {}): WebsiteLinkRow => ({
  productId: 1,
  sku: 'SKU-1',
  wooId: 100,
  wooType: 'simple',
  wooParentId: null,
  syncEnabled: true,
  wooManageStock: true,
  wooStockQuantity: 5,
  ...overrides,
});

const oneProduct = [{ productId: 1, sku: 'SKU-1', quantity: 7 }];

const plannedItem = (overrides: Partial<PlannedStockItem> = {}): PlannedStockItem => ({
  productId: 1,
  sku: 'SKU-1',
  wooId: 100,
  wooType: 'simple',
  wooParentId: null,
  quantity: 7,
  siteQuantity: 5,
  previousPushedQuantity: null,
  reason: 'new',
  needsManageStock: false,
  ...overrides,
});

describe('WooCommerce stock fields', () => {
  it('clamps a negative total to zero and keeps a positive one as an integer', () => {
    expect(clampQuantity(-3)).toBe(0);
    expect(clampQuantity('12')).toBe(12);
    expect(clampQuantity(4.9)).toBe(4);
    expect(clampQuantity(undefined)).toBe(0);
    // Not a business default - only the channel's own switch asks for it.
    expect(clampQuantity(-3, false)).toBe(-3);
  });

  it('never sends a negative quantity and always sends the status with it', () => {
    expect(resolveStockFields(9)).toEqual({
      stock_quantity: 9,
      stock_status: 'instock',
      backorders: 'no',
    });

    expect(resolveStockFields(0)).toEqual({
      stock_quantity: 0,
      stock_status: 'outofstock',
      backorders: 'no',
    });

    // A negative ERP total must reach the shop as 0, not as "-2 in stock".
    expect(resolveStockFields(-2).stock_quantity).toBe(0);
    expect(resolveStockFields(-2).stock_status).toBe('outofstock');
  });

  it('only allows backorders when the channel asks for them', () => {
    expect(resolveStockFields(5, { allowBackorders: true }).backorders).toBe('notify');
    expect(resolveStockFields(5, { allowBackorders: false }).backorders).toBe('no');
  });

  it('adds manage_stock only when the site is not tracking stock and the channel forces it', () => {
    expect(buildStockUpdatePayload(plannedItem())).toEqual({
      id: 100,
      stock_quantity: 7,
      stock_status: 'instock',
      backorders: 'no',
    });

    expect(
      buildStockUpdatePayload(plannedItem({ needsManageStock: true }), { forceManageStock: true }),
    ).toMatchObject({ id: 100, manage_stock: true, stock_quantity: 7 });
  });
});

describe('website stock planning', () => {
  it('sends a product that was never pushed', () => {
    const plan = planStockSync(oneProduct, [link()], new Map());

    expect(plan.items).toEqual([
      expect.objectContaining({ sku: 'SKU-1', quantity: 7, reason: 'new' }),
    ]);
    expect(plan.unchanged).toBe(0);
  });

  it('skips a product whose stock already matches both the last push and the site', () => {
    const plan = planStockSync(oneProduct, [link({ wooStockQuantity: 7 })], new Map([[1, 7]]));

    expect(plan.items).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('re-sends when the ERP quantity moved since the last push', () => {
    const plan = planStockSync(oneProduct, [link({ wooStockQuantity: 7 })], new Map([[1, 5]]));

    expect(plan.items).toEqual([expect.objectContaining({ quantity: 7, reason: 'changed' })]);
  });

  it('re-sends when the site drifted, so a website sale is corrected', () => {
    const plan = planStockSync(oneProduct, [link({ wooStockQuantity: 2 })], new Map([[1, 7]]));

    expect(plan.items).toEqual([expect.objectContaining({ reason: 'site-differs' })]);
  });

  it('reports - never writes - a product whose site does not track stock', () => {
    const plan = planStockSync(oneProduct, [link({ wooManageStock: false })], new Map());

    expect(plan.items).toEqual([]);
    expect(plan.notTracking).toEqual([expect.objectContaining({ sku: 'SKU-1' })]);
  });

  it('forces manage_stock when the channel opted in', () => {
    const plan = planStockSync(oneProduct, [link({ wooManageStock: false })], new Map(), {
      forceManageStock: true,
    });

    expect(plan.notTracking).toEqual([]);
    expect(plan.items[0]).toMatchObject({ sku: 'SKU-1', needsManageStock: true });
  });

  it('treats a parked link and a deleted product differently', () => {
    const plan = planStockSync(
      oneProduct,
      [link({ syncEnabled: false }), link({ productId: 99, sku: 'GONE', wooId: 101 })],
      new Map(),
    );

    expect(plan.items).toEqual([]);
    expect(plan.disabledLinks).toBe(1);
    expect(plan.missingProducts).toBe(1);
  });

  it('ignores the delta in "all" mode - the repair path rewrites everything', () => {
    const plan = planStockSync(oneProduct, [link({ wooStockQuantity: 7 })], new Map([[1, 7]]), {
      mode: 'all',
    });

    expect(plan.items).toEqual([expect.objectContaining({ reason: 'all' })]);
    expect(plan.unchanged).toBe(0);
  });

  it('sends 0/outofstock for an over-sold product', () => {
    const plan = planStockSync(
      [{ productId: 1, sku: 'SKU-1', quantity: -4 }],
      [link()],
      new Map(),
    );

    expect(plan.items[0].quantity).toBe(0);
    expect(buildStockUpdatePayload(plan.items[0]).stock_status).toBe('outofstock');
  });
});

describe('WooCommerce batches and addresses', () => {
  it('splits at 100 objects, the WooCommerce limit', () => {
    const batches = chunk(Array.from({ length: 250 }, (_, index) => index));

    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
  });

  it('groups variations by parent, because the parent is the endpoint', () => {
    const groups = groupVariationsByParent([
      plannedItem({ wooType: 'variation', wooId: 11, wooParentId: 1 }),
      plannedItem({ wooType: 'variation', wooId: 12, wooParentId: 1 }),
      plannedItem({ wooType: 'variation', wooId: 21, wooParentId: 2 }),
      plannedItem({ wooType: 'simple', wooId: 30 }),
    ]);

    expect(
      groups.map((group) => [group.parentId, group.items.length]),
    ).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  it('reads a per-item error out of a 200 batch response', () => {
    const results = parseBatchResponse(
      {
        update: [
          { id: 100, stock_quantity: 4, stock_status: 'instock' },
          { error: { message: 'Invalid stock quantity', data: { status: 400 } } },
        ],
      },
      [100, 101],
    );

    expect(results[0]).toMatchObject({ ok: true, stockQuantity: 4, stockStatus: 'instock' });
    expect(results[1]).toMatchObject({
      wooId: 101,
      ok: false,
      message: 'Invalid stock quantity',
      httpStatus: 400,
    });
  });

  it('fails a line the site did not answer for, instead of assuming success', () => {
    const [result] = parseBatchResponse({ update: [] }, [100]);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('did not return a result');
  });

  it('normalises the shop address once, so the API path is appended once', () => {
    expect(normaliseBaseUrl('www.smartlife-vn.com/')).toBe('https://www.smartlife-vn.com');
    expect(normaliseBaseUrl('https://b2b.smartlife-vn.com/wp-json')).toBe(
      'https://b2b.smartlife-vn.com/wp-json',
    );
    expect(() => normaliseBaseUrl('http://shop.example.com')).toThrow(/HTTPS/);
    expect(normaliseBaseUrl('http://localhost:8080')).toBe('http://localhost:8080');
    expect(wooApiUrl('https://shop.test/', '/products/batch')).toBe(
      'https://shop.test/wp-json/wc/v3/products/batch',
    );
    expect(wooApiUrl('https://shop.test', '/products', { query: { page: 2, per_page: 100 } })).toBe(
      'https://shop.test/wp-json/wc/v3/products?page=2&per_page=100',
    );
  });

  it('builds the ?rest_route= address a Plain-permalinks shop answers on', () => {
    expect(wooApiUrl('https://shop.test', '/products', { style: 'rest_route' })).toBe(
      'https://shop.test/?rest_route=%2Fwc%2Fv3%2Fproducts',
    );
    expect(
      wooApiUrl('https://shop.test', '/products', { style: 'rest_route', query: { per_page: 1 } })
    ).toBe('https://shop.test/?rest_route=%2Fwc%2Fv3%2Fproducts&per_page=1');
  });

  it('masks a key down to its last four characters', () => {
    expect(maskSecret('ck_live_123456789f12')).toMatch(/f12$/);
    expect(maskSecret('ck_live_123456789f12')).not.toContain('live');
    expect(maskSecret('')).toBe('');
  });
});

describe('woocommerce client', () => {
  const calls: Array<{ url: string; method: string; authorization: string | null }> = [];

  /** Records every request and answers with `handler(url)` - no network leaves the test. */
  function stubFetch(handler: (url: string) => Response): void {
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        authorization: new Headers(init?.headers).get('authorization'),
      });
      return handler(url);
    });
  }

  function clientFor(baseUrl: string) {
    return new WooCommerceClient({ baseUrl, consumerKey: 'ck_test', consumerSecret: 'cs_test' });
  }

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to ?rest_route= when the pretty path 404s, then remembers it', async () => {
    const baseUrl = 'https://plain-permalinks-shop.test';
    stubFetch((url) =>
      url.includes('/wp-json/')
        ? new Response('{"code":"rest_no_route"}', { status: 404 })
        : new Response(JSON.stringify([{ id: 7, sku: 'FALLBACK-1' }]), {
            status: 200,
            headers: { 'X-WP-Total': '7' },
          }),
    );

    const result = await clientFor(baseUrl).testConnection();

    expect(result.urlStyle).toBe('rest_route');
    expect(result.totalProducts).toBe(7);
    expect(calls.map((call) => call.url)).toEqual([
      `${baseUrl}/wp-json/wc/v3/products?per_page=1&status=any`,
      `${baseUrl}/?rest_route=%2Fwc%2Fv3%2Fproducts&per_page=1&status=any`,
    ]);
    // The key rides in the header on both attempts and never in the address.
    expect(calls[1].authorization).toBe(`Basic ${Buffer.from('ck_test:cs_test').toString('base64')}`);
    expect(calls[1].url).not.toContain('cs_test');

    // A second client for the same shop goes straight to the form that worked.
    calls.length = 0;
    await clientFor(baseUrl).testConnection();
    expect(calls.map((call) => call.url)).toEqual([
      `${baseUrl}/?rest_route=%2Fwc%2Fv3%2Fproducts&per_page=1&status=any`,
    ]);
  });

  it('reports the key, not the API, when only ?rest_route= answers', async () => {
    const baseUrl = 'https://plain-permalinks-refusal.test';
    stubFetch((url) =>
      url.includes('/wp-json/')
        ? new Response('{"code":"rest_no_route"}', { status: 404 })
        : new Response('{"code":"woocommerce_rest_cannot_view"}', { status: 401 }),
    );

    // 401 on the fallback is proof the route exists - a missing API would have 404'd twice.
    await expect(clientFor(baseUrl).testConnection()).rejects.toThrow(/refused the API key/);
    // pretty+header, rest_route+header, then rest_route+query: the last is the only one left.
    expect(calls.map((call) => call.url)).toEqual([
      `${baseUrl}/wp-json/wc/v3/products?per_page=1&status=any`,
      `${baseUrl}/?rest_route=%2Fwc%2Fv3%2Fproducts&per_page=1&status=any`,
      `${baseUrl}/?rest_route=%2Fwc%2Fv3%2Fproducts&per_page=1&status=any&consumer_key=ck_test&consumer_secret=cs_test`,
    ]);
  });

  it('reports a missing REST API only after both URL shapes 404', async () => {
    const baseUrl = 'https://no-rest-api.test';
    stubFetch(() => new Response('{"code":"rest_no_route"}', { status: 404 }));

    await expect(clientFor(baseUrl).testConnection()).rejects.toThrow(/rest_route=/);
    expect(calls).toHaveLength(2);
  });

  it('falls back to the query string when the host drops Authorization, then remembers it', async () => {
    // b2b.smartlife-vn.com: 404 on the pretty path (Plain permalinks), 401 with the header on
    // rest_route, 200 with the same key in the query string. The key was never wrong.
    const baseUrl = 'https://header-stripping-shop.test';
    stubFetch((url) => {
      if (url.includes('/wp-json/')) return new Response('<html>404</html>', { status: 404 });
      return url.includes('consumer_key=')
        ? new Response(JSON.stringify([{ id: 3070, sku: 'SPARKLE' }]), {
            status: 200,
            headers: { 'X-WP-Total': '412' },
          })
        : new Response('{"code":"woocommerce_rest_cannot_view"}', { status: 401 });
    });

    const result = await clientFor(baseUrl).testConnection();

    expect(result).toMatchObject({ urlStyle: 'rest_route', authMode: 'query', totalProducts: 412 });
    expect(calls).toHaveLength(3);
    expect(calls[2].authorization).toBeNull();
    expect(calls[2].url).toContain('consumer_key=ck_test');

    // Remembered per shop: the next client skips both probes and never sends the header.
    calls.length = 0;
    await clientFor(baseUrl).testConnection();
    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBeNull();
    expect(calls[0].url).toContain('consumer_secret=cs_test');
  });

  it('says the key fails both ways when the shop refuses the header and the query string', async () => {
    const baseUrl = 'https://read-only-key.test';
    stubFetch(() => new Response('{"code":"woocommerce_rest_cannot_view"}', { status: 401 }));

    await expect(clientFor(baseUrl).testConnection()).rejects.toThrow(
      /refused the API key \(401\), in both the Authorization header and the query string/,
    );
    // header, then query string - and no retries on a refusal.
    expect(calls).toHaveLength(2);
  });
});

describe('integration secrets', () => {
  beforeAll(() => {
    process.env.INTEGRATION_SECRET_KEY = 'unit-test-integration-secret';
  });

  it('round-trips a credential without storing it in plain text', () => {
    const ciphertext = encryptSecret('ck_live_secret_value');

    expect(isEncryptedSecret(ciphertext)).toBe(true);
    expect(ciphertext).not.toContain('ck_live_secret_value');
    expect(decryptSecret(ciphertext)).toBe('ck_live_secret_value');
  });

  it('passes a hand-inserted plain value through unchanged', () => {
    expect(isEncryptedSecret('ck_plain')).toBe(false);
    expect(decryptSecret('ck_plain')).toBe('ck_plain');
  });
});

describe('website sync routes', () => {
  it('registers every endpoint the screen calls', () => {
    const registrations = recordRoutes(registerWebsiteSyncRoutes);
    const keys = registrations.map((entry) => `${entry.method} ${entry.path}`).sort();

    expect(keys).toEqual([
      'DELETE /api/website-sync/channels/:id',
      'GET /api/website-sync/channels',
      'GET /api/website-sync/preview',
      'GET /api/website-sync/runs',
      'GET /api/website-sync/runs/:id',
      'POST /api/website-sync/channels',
      'POST /api/website-sync/channels/:id/refresh-catalogue',
      'POST /api/website-sync/channels/:id/test',
      'POST /api/website-sync/run',
      'PUT /api/website-sync/channels/:id',
    ]);

    // requirePermission + validateBody + the handler itself on the write that touches a live shop.
    const run = registrations.find((entry) => entry.method === 'POST' && entry.path === '/api/website-sync/run');
    expect(run?.handlers.length).toBeGreaterThanOrEqual(3);
  });

  type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

  /** The first handler express would run - the `requirePermission` middleware. */
  const permissionMiddleware = (method: Method, path: string) => {
    const entry = recordRoutes(registerWebsiteSyncRoutes).find(
      (candidate) => candidate.method === method && candidate.path === path,
    );
    if (!entry) throw new Error(`route not registered: ${method} ${path}`);
    return entry.handlers[0] as unknown as (
      req: unknown,
      res: unknown,
      next: (error?: unknown) => void,
    ) => Promise<unknown>;
  };

  const staffRequest = (permissions: Record<string, unknown>) =>
    ({
      isAuthenticated: () => true,
      user: {
        id: 1,
        username: 'cashier',
        role: { name: 'cashier', hierarchyLevel: 'staff', permissions },
      },
    }) as never;

  const inventoryOnly = { inventory: { create: true, read: true, update: true, delete: true } };

  it('refuses the list to a role that only has Inventory access', async () => {
    const res = makeRes();
    const next = vi.fn();

    await permissionMiddleware('GET', '/api/website-sync/channels')(
      staffRequest(inventoryOnly),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.body as { message: string }).message).toContain('websiteSync read');
  });

  it('opens the read endpoints to a role granted websiteSync.read', async () => {
    for (const path of [
      '/api/website-sync/channels',
      '/api/website-sync/preview',
      '/api/website-sync/runs',
    ]) {
      const res = makeRes();
      const next = vi.fn();

      await permissionMiddleware('GET', path)(staffRequest({ websiteSync: { read: true } }), res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    }
  });

  it('only lets websiteSync.update start a sync', async () => {
    const deniedRes = makeRes();
    const deniedNext = vi.fn();

    await permissionMiddleware('POST', '/api/website-sync/run')(
      staffRequest({ websiteSync: { read: true, update: false } }),
      deniedRes,
      deniedNext,
    );

    expect(deniedNext).not.toHaveBeenCalled();
    expect(deniedRes.statusCode).toBe(403);
    expect((deniedRes.body as { message: string }).message).toContain('websiteSync update');

    const allowedRes = makeRes();
    const allowedNext = vi.fn();

    await permissionMiddleware('POST', '/api/website-sync/run')(
      staffRequest({ websiteSync: { read: true, update: true } }),
      allowedRes,
      allowedNext,
    );

    expect(allowedNext).toHaveBeenCalledTimes(1);
    expect(allowedRes.statusCode).toBe(200);
  });
});

describe('website sync against the database', () => {
  let testData: Awaited<ReturnType<typeof seedTestData>>;

  beforeAll(async () => {
    // The channel stores its API key encrypted; the key itself lives in the environment.
    process.env.INTEGRATION_SECRET_KEY = 'unit-test-integration-secret';
    await resetTestDatabase();
  });

  beforeEach(async () => {
    await cleanDatabase();
    testData = await seedTestData();
  });

  afterEach(async () => {
    await cleanDatabase();
  });

  const productId = () => testData.products.product.id;

  /** One DC row for the seeded product; any inventory from a previous test is removed first. */
  async function stockTheProduct(quantity: number) {
    await db.delete(inventory);
    await db.insert(inventory).values({ productId: productId(), quantity, inventoryType: 'DC' });
  }

  function makeChannel(name = 'Retail') {
    return createChannel({
      name,
      baseUrl: 'https://retail.example.test',
      consumerKey: 'ck_live_key_value',
      consumerSecret: 'cs_live_secret_value',
    });
  }

  it('sums the distribution centre and every store, and keeps a zero-stock product', async () => {
    await stockTheProduct(10);
    await db.insert(inventory).values({
      productId: productId(),
      storeId: testData.stores.store1.id,
      quantity: 4,
      inventoryType: 'STORE',
    });

    // A product nobody ever counted must still appear, with 0 - otherwise the sync would leave it
    // at whatever quantity the website already had.
    const [neverStocked] = await db
      .insert(products)
      .values({
        name: 'Never stocked',
        sku: 'TEST-002',
        price: '1.00',
        categoryId: testData.categories.category.id,
      })
      .returning();

    const snapshot = await loadStockSnapshot({ scope: 'ALL' });
    expect(snapshot.find((row) => row.productId === productId())?.quantity).toBe(14);
    expect(snapshot.find((row) => row.productId === neverStocked.id)?.quantity).toBe(0);

    const dcOnly = await loadStockSnapshot({ scope: 'DC' });
    expect(dcOnly.find((row) => row.productId === productId())?.quantity).toBe(10);

    // "Store shelves only" means every store without the DC - never an empty set, which would
    // push 0 for every product.
    const storesOnly = await loadStockSnapshot({ scope: 'STORES' });
    expect(storesOnly.find((row) => row.productId === productId())?.quantity).toBe(4);
  });

  it('stores the API key encrypted and keeps it when the form is saved without one', async () => {
    const channel = await makeChannel();

    expect(channel.baseUrl).toBe('https://retail.example.test');
    expect(channel.consumerKeyMasked).not.toContain('live');
    expect(channel.consumerKeyMasked).toMatch(/alue$/);

    const [row] = await db
      .select()
      .from(websiteChannels)
      .where(eq(websiteChannels.id, channel.id));
    expect(row.consumerKeyEnc).not.toContain('ck_live_key_value');
    expect(decryptSecret(row.consumerKeyEnc)).toBe('ck_live_key_value');

    const updated = await updateChannel(channel.id, { name: 'Retail 2' });
    expect(updated.name).toBe('Retail 2');

    const [afterUpdate] = await db
      .select()
      .from(websiteChannels)
      .where(eq(websiteChannels.id, channel.id));
    // Sending no key must not wipe the stored one - the screen never sees it to send it back.
    expect(decryptSecret(afterUpdate.consumerKeyEnc)).toBe('ck_live_key_value');

    const channels = await listChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].consumerSecretMasked).not.toContain('secret');
  });

  it('previews the change, then nothing once the shop matches', async () => {
    await stockTheProduct(12);
    const channel = await makeChannel();

    await db.insert(websiteProductLinks).values({
      channelId: channel.id,
      productId: productId(),
      wooId: 501,
      wooType: 'simple',
      sku: 'TEST-001',
      wooManageStock: true,
      wooStockQuantity: 3,
    });

    const first = await previewStockSync(channel.id, 'changed');
    expect(first.totals).toMatchObject({ linkedProducts: 1, toSend: 1, notTracking: 0 });
    expect(first.items[0]).toMatchObject({
      sku: 'TEST-001',
      quantity: 12,
      siteQuantity: 3,
      reason: 'new',
      stockStatus: 'instock',
    });

    // Pretend the last run pushed 12 and the catalogue refresh saw 12 on the site.
    await db.insert(websiteStockState).values({
      channelId: channel.id,
      productId: productId(),
      lastSyncedQuantity: 12,
    });
    await db
      .update(websiteProductLinks)
      .set({ wooStockQuantity: 12 })
      .where(eq(websiteProductLinks.channelId, channel.id));

    const second = await previewStockSync(channel.id, 'changed');
    expect(second.totals.toSend).toBe(0);
    expect(second.totals.unchanged).toBe(1);

    // The repair mode ignores the delta on purpose.
    const all = await previewStockSync(channel.id, 'all');
    expect(all.totals.toSend).toBe(1);
  });

  it('reports a site that does not track stock instead of counting it as synced', async () => {
    await stockTheProduct(5);
    const channel = await makeChannel('B2B');

    await db.insert(websiteProductLinks).values({
      channelId: channel.id,
      productId: productId(),
      wooId: 601,
      wooType: 'simple',
      sku: 'TEST-001',
      wooManageStock: false,
      wooStockQuantity: 0,
    });

    const preview = await previewStockSync(channel.id, 'changed');
    expect(preview.totals.toSend).toBe(0);
    expect(preview.totals.notTracking).toBe(1);
    expect(preview.notTracking[0]).toMatchObject({ sku: 'TEST-001', wooId: 601 });
  });

  it('sends an over-sold product as out of stock, never as a negative number', async () => {
    await stockTheProduct(0);
    const channel = await makeChannel();

    await db.insert(websiteProductLinks).values({
      channelId: channel.id,
      productId: productId(),
      wooId: 701,
      wooType: 'simple',
      sku: 'TEST-001',
      wooManageStock: true,
      wooStockQuantity: 4,
    });

    const preview = await previewStockSync(channel.id, 'changed');
    expect(preview.items[0]).toMatchObject({ quantity: 0, stockStatus: 'outofstock' });
  });

  it('records a run that has nothing to send without calling a shop', async () => {
    const channel = await makeChannel();

    const result = await runStockSync({ channelId: channel.id });

    expect(result).toMatchObject({ channelId: channel.id, status: 'success', mode: 'changed' });
    expect(result.totals.planned).toBe(0);
    expect(result.message).toContain('Nothing to send');

    const runs = await listSyncRuns(channel.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'success', succeeded: 0, failed: 0 });

    const [stored] = await db
      .select()
      .from(websiteChannels)
      .where(eq(websiteChannels.id, channel.id));
    expect(stored.lastSyncStatus).toBe('success');
    expect(stored.lastSyncAt).not.toBeNull();
  });
});
