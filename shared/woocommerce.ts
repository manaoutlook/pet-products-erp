/**
 * Website stock sync - the WooCommerce contract, as one pure module.
 *
 * The ERP is the source of truth for stock; two WordPress/WooCommerce shops
 * (`www.smartlife-vn.com`, `b2b.smartlife-vn.com`) are downstream copies. This module owns every
 * decision that does not need a socket or a database:
 *
 *   - what "the stock" of a product is (one number, clamped at zero);
 *   - which WooCommerce fields that number turns into (`stock_quantity`, `stock_status`,
 *     `backorders`, plus `manage_stock` when the site is not tracking it);
 *   - which SKUs actually need sending (delta against the last successful push AND against what
 *     the site currently reports, so a website sale is corrected on the next run);
 *   - how the batch response is read back (WooCommerce answers 200 with per-item errors inside
 *     `update[]`, so a run that "succeeded" can still have failed lines).
 *
 * AI Agent Note - why `stock_status` is sent and not only `stock_quantity`:
 * WooCommerce keeps the status as its own field. Writing a quantity alone leaves a product that
 * was once out of stock still showing "Out of stock" until something recalculates it, so both
 * are written on every update.
 *
 * AI Agent Note - why `manage_stock` can be forced:
 * If "Track stock quantity for this product" is unchecked on the site, WooCommerce silently
 * ignores `stock_quantity` and the shop sells unlimited stock. `forceManageStock` sets the flag
 * in the same update; otherwise those products are reported as "not tracking stock" and are
 * never counted as synced.
 *
 * AI Agent Note - backorders:
 * The business decision is "no backorders": an item sells down to exactly 0 and then the shop
 * refuses the sale. `allowBackorders` exists only because a channel may later be configured
 * otherwise; the status and the backorders field are always written together.
 *
 * No database, no fetch: the route, the sync and the tests all call these functions.
 */

export const WOO_BATCH_LIMIT = 100;
export const WOO_PAGE_SIZE = 100;
export const WOO_API_NAMESPACE = "wc/v3";
export const DEFAULT_WOO_TIMEOUT_MS = 15_000;

/** Which stock rows feed the website. `ALL` is DC + every store, the business default. */
export type WebsiteStockScope = "ALL" | "DC" | "STORES";
export const WEBSITE_STOCK_SCOPES: WebsiteStockScope[] = ["ALL", "DC", "STORES"];

/** `simple` is a product; `variation` belongs to a variable parent and has its own endpoint. */
export type WooProductType = "simple" | "variation";

/** `changed` = delta (default); `all` = push every linked SKU whatever the last run said. */
export type StockSyncMode = "changed" | "all";
export const STOCK_SYNC_MODES: StockSyncMode[] = ["changed", "all"];

export type WooStockStatus = "instock" | "outofstock" | "onbackorder";
export type WooBackorders = "no" | "notify" | "yes";

/** One product's ERP stock: the SUM of its `inventory` rows. */
export interface StockQuantityRow {
  productId: number;
  sku: string;
  quantity: number;
}

/** One `website_product_links` row - what the site calls this product. */
export interface WebsiteLinkRow {
  productId: number;
  sku: string;
  wooId: number;
  wooType: string;
  wooParentId: number | null;
  syncEnabled: boolean;
  wooManageStock: boolean;
  wooStockQuantity: number | null;
}

export interface StockSyncOptions {
  /** Negative rows become 0 so the shop never shows "-3 in stock". */
  clampNegative?: boolean;
  /** Business default is `false` ("Do not allow"). */
  allowBackorders?: boolean;
  /** Set `manage_stock: true` on products that do not track stock. */
  forceManageStock?: boolean;
  mode?: StockSyncMode;
}

/** Why a SKU is being sent - shown in the preview so the operator can trust the count. */
export type StockSyncReason = "all" | "new" | "changed" | "site-differs";

export interface PlannedStockItem {
  productId: number;
  sku: string;
  wooId: number;
  wooType: WooProductType;
  wooParentId: number | null;
  /** What will be sent (already clamped). */
  quantity: number;
  /** What the site reported at the last catalogue refresh, for comparison. */
  siteQuantity: number | null;
  /** What the last successful push sent; `null` when this SKU was never pushed. */
  previousPushedQuantity: number | null;
  reason: StockSyncReason;
  /** True when the update must also switch `manage_stock` on. */
  needsManageStock: boolean;
}

export interface StockSyncPlan {
  /** Products to update, one entry per site product. */
  items: PlannedStockItem[];
  /** Linked products whose stock already matches both the site and the last push. */
  unchanged: number;
  /** Linked products whose site does not track stock, and force is off: cannot be synced. */
  notTracking: PlannedStockItem[];
  /** Deliberately unlinked by the operator (`sync_enabled = false`). */
  disabledLinks: number;
  /** Links whose ERP product no longer exists (a deleted product left the link behind). */
  missingProducts: number;
}
/** WooCommerce `stock_quantity` for a quantity, clamped at zero when asked. */
export function clampQuantity(value: number | string | null | undefined, clampNegative = true): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return 0;
  const whole = Math.trunc(numeric);
  return clampNegative ? Math.max(0, whole) : whole;
}

/**
 * The three fields WooCommerce needs together. Sending only the quantity leaves the status stale,
 * which is how an item stays "Out of stock" after a restock.
 */
export function resolveStockFields(
  quantity: number,
  options: { allowBackorders?: boolean } = {},
): { stock_quantity: number; stock_status: WooStockStatus; backorders: WooBackorders } {
  const stockQuantity = clampQuantity(quantity, true);
  const backorders: WooBackorders = options.allowBackorders ? "notify" : "no";

  if (stockQuantity > 0) {
    return { stock_quantity: stockQuantity, stock_status: "instock", backorders };
  }

  return { stock_quantity: 0, stock_status: "outofstock", backorders };
}

/**
 * Decide what one run sends.
 *
 * A SKU is sent when any of these is true (mode `changed`):
 *   - it has never been pushed (`new`);
 *   - the ERP quantity differs from the last successful push (`changed`);
 *   - the site reports a different quantity than the ERP (`site-differs`) - a website sale, a
 *     manual edit in wp-admin, or a run that crashed after writing.
 * Mode `all` sends every enabled link, which is the repair path.
 */
export function planStockSync(
  snapshot: StockQuantityRow[],
  links: WebsiteLinkRow[],
  state: ReadonlyMap<number, number>,
  options: StockSyncOptions = {},
): StockSyncPlan {
  const { clampNegative = true, forceManageStock = false, mode = "changed" } = options;

  const stockByProduct = new Map<number, number>();
  for (const row of snapshot) {
    stockByProduct.set(row.productId, Number(row.quantity));
  }

  const plan: StockSyncPlan = {
    items: [],
    unchanged: 0,
    notTracking: [],
    disabledLinks: 0,
    missingProducts: 0,
  };

  for (const link of links) {
    if (!link.syncEnabled) {
      plan.disabledLinks += 1;
      continue;
    }

    if (!stockByProduct.has(link.productId)) {
      plan.missingProducts += 1;
      continue;
    }

    const quantity = clampQuantity(stockByProduct.get(link.productId), clampNegative);
    const previousPushedQuantity = state.get(link.productId) ?? null;
    const siteQuantity = link.wooStockQuantity ?? null;
    const item: PlannedStockItem = {
      productId: link.productId,
      sku: link.sku,
      wooId: link.wooId,
      wooType: link.wooType === "variation" ? "variation" : "simple",
      wooParentId: link.wooParentId ?? null,
      quantity,
      siteQuantity,
      previousPushedQuantity,
      reason: "changed",
      needsManageStock: !link.wooManageStock && forceManageStock,
    };

    // A product the site does not track cannot accept a quantity. Report it instead of writing a
    // value WooCommerce will ignore and then calling the run a success.
    if (!link.wooManageStock && !forceManageStock) {
      plan.notTracking.push(item);
      continue;
    }

    if (mode === "all") {
      plan.items.push({ ...item, reason: "all" });
      continue;
    }

    if (previousPushedQuantity === null) {
      plan.items.push({ ...item, reason: "new" });
      continue;
    }

    if (previousPushedQuantity !== quantity) {
      plan.items.push({ ...item, reason: "changed" });
      continue;
    }

    if (siteQuantity !== null && siteQuantity !== quantity) {
      plan.items.push({ ...item, reason: "site-differs" });
      continue;
    }

    plan.unchanged += 1;
  }

  return plan;
}

/** One entry of a WooCommerce batch `update[]` array. */
export interface WooStockUpdate {
  id: number;
  manage_stock?: boolean;
  stock_quantity: number;
  stock_status: WooStockStatus;
  backorders: WooBackorders;
}

/** The body of `POST /wp-json/wc/v3/products/batch` (or a variations batch). */
export function buildStockUpdatePayload(
  item: PlannedStockItem,
  options: StockSyncOptions = {},
): WooStockUpdate {
  const fields = resolveStockFields(item.quantity, { allowBackorders: options.allowBackorders });
  return {
    id: item.wooId,
    ...(item.needsManageStock ? { manage_stock: true } : {}),
    ...fields,
  };
}

/** Split into pieces of at most 100 - WooCommerce rejects a larger batch. */
export function chunk<T>(items: T[], size = WOO_BATCH_LIMIT): T[][] {
  const safeSize = Math.max(1, Math.trunc(size));
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += safeSize) {
    batches.push(items.slice(index, index + safeSize));
  }
  return batches;
}

/** Variations are updated per parent; the parent id is the endpoint, not a field. */
export function groupVariationsByParent(
  items: PlannedStockItem[],
): Array<{ parentId: number; items: PlannedStockItem[] }> {
  const groups = new Map<number, PlannedStockItem[]>();
  for (const item of items) {
    if (item.wooType !== "variation" || !item.wooParentId) continue;
    const current = groups.get(item.wooParentId) ?? [];
    current.push(item);
    groups.set(item.wooParentId, current);
  }

  // forEach rather than spreading `groups.entries()`: the project compiles without a `target`,
  // which means ES5 down-leveling where a Map iterator cannot be spread.
  const result: Array<{ parentId: number; items: PlannedStockItem[] }> = [];
  groups.forEach((group, parentId) => result.push({ parentId, items: group }));
  return result;
}

export interface BatchItemResult {
  wooId: number;
  ok: boolean;
  /** The site's own message when it refused the line (`stock_quantity` invalid, parent trashed…). */
  message: string | null;
  httpStatus: number | null;
  /** What the site reports after the write, when it echoed the product back. */
  stockQuantity: number | null;
  stockStatus: string | null;
}

interface WooErrorShape {
  code?: string;
  message?: string;
  data?: { status?: number };
}

interface WooProductShape {
  id?: number;
  stock_quantity?: number | null;
  stock_status?: string | null;
  error?: WooErrorShape;
}

/**
 * Read a batch response back, aligned with the ids we sent.
 *
 * AI Agent Note: a batch answers **200** even when every line failed - the refusal lives in
 * `update[i].error`. Matching by index (with an id fallback) is deliberate: WooCommerce's error
 * objects carry no `id`, so matching by id alone would silently mark failures as successes.
 */
export function parseBatchResponse(payload: unknown, expectedIds: number[]): BatchItemResult[] {
  const body = (payload ?? {}) as { update?: unknown };
  const updates = Array.isArray(body.update) ? (body.update as WooProductShape[]) : [];
  const byId = new Map<number, WooProductShape>();
  for (const entry of updates) {
    if (typeof entry?.id === "number") byId.set(entry.id, entry);
  }

  return expectedIds.map((wooId, index) => {
    const positional = updates[index];
    const entry = positional?.id === undefined ? byId.get(wooId) ?? positional : positional;

    if (!entry) {
      return {
        wooId,
        ok: false,
        message: "WooCommerce did not return a result for this item",
        httpStatus: null,
        stockQuantity: null,
        stockStatus: null,
      };
    }

    if (entry.error) {
      return {
        wooId,
        ok: false,
        message: entry.error.message ?? entry.error.code ?? "WooCommerce refused the update",
        httpStatus: entry.error.data?.status ?? null,
        stockQuantity: null,
        stockStatus: null,
      };
    }

    return {
      wooId,
      ok: true,
      message: null,
      httpStatus: 200,
      stockQuantity: typeof entry.stock_quantity === "number" ? entry.stock_quantity : null,
      stockStatus: typeof entry.stock_status === "string" ? entry.stock_status : null,
    };
  });
}

/** Trim and strip the trailing slash so `/wp-json/...` is appended once. */
export function normaliseBaseUrl(input: string): string {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) throw new Error("A website address is required");

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`"${input}" is not a valid website address`);
  }

  // The API key travels in an Authorization header: plain HTTP would expose it on every request.
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !isLocal) {
    throw new Error("The website must use HTTPS - the API key is sent on every request");
  }

  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/**
 * How a shop exposes the REST API.
 *
 * `pretty` is the normal shape: `https://shop.example/wp-json/wc/v3/...`. A WordPress install with
 * *Settings > Permalinks* set to "Plain" serves no `/wp-json/` path at all, yet WooCommerce still
 * answers on `https://shop.example/?rest_route=/wc/v3/...` - the same routes, a different address
 * for them. That second shape is what saves a live shop from having its permalinks changed (which
 * rewrites every product URL) just to let the ERP in.
 */
export type WooUrlStyle = "pretty" | "rest_route";

/**
 * `https://shop.example` + `/products/batch` ->
 *   pretty:     `https://shop.example/wp-json/wc/v3/products/batch?per_page=1`
 *   rest_route: `https://shop.example/?rest_route=%2Fwc%2Fv3%2Fproducts%2Fbatch&per_page=1`
 */
export function wooApiUrl(
  baseUrl: string,
  path: string,
  options: {
    style?: WooUrlStyle;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const base = baseUrl.replace(/\/+$/, "");
  const route = `${WOO_API_NAMESPACE}${clean}`;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const query = params.toString();

  if (options.style === "rest_route") {
    // WordPress reads the route from `rest_route`, so it has to be one fully encoded parameter and
    // any real query parameters follow it with `&`, not `?`.
    return `${base}/?rest_route=${encodeURIComponent(`/${route}`)}${query ? `&${query}` : ""}`;
  }

  return `${base}/wp-json/${route}${query ? `?${query}` : ""}`;
}

/** `ck_abc…9f12` - enough to recognise the key, never enough to use it. */
export function maskSecret(value: string | null | undefined, visible = 4): string {
  const text = String(value ?? "");
  if (!text) return "";
  if (text.length <= visible) return "\u2022".repeat(text.length);
  return `${"\u2022".repeat(Math.min(12, text.length - visible))}${text.slice(-visible)}`;
}

/** SKUs are matched trimmed; WooCommerce trims them too, but imports sometimes carry spaces. */
export function normaliseSku(value: string | null | undefined): string {
  return String(value ?? "").trim();
}
