import {
  DEFAULT_WOO_TIMEOUT_MS,
  WOO_PAGE_SIZE,
  wooApiUrl,
  type WooUrlStyle,
} from "../../shared/woocommerce";

/**
 * A thin WooCommerce REST v3 client - just the calls the stock sync needs.
 *
 * Only three things exist here on purpose: list the catalogue (so SKUs can be linked), read the
 * variations of a variable product, and POST a batch update. Everything else follows from those.
 *
 * AI Agent Note - the API key never appears in a URL or an error message:
 * Authentication is HTTP Basic (`Authorization: Basic base64(key:secret)`), which WooCommerce
 * accepts over HTTPS. Putting `?consumer_key=…` in the query would leak the key into every access
 * log along the way, so the URL deliberately carries no credentials.
 *
 * AI Agent Note - retries are only for transport failures and 429/5xx:
 * A 400 from the batch endpoint means the payload is wrong; retrying repeats the mistake. A 5xx
 * may be a proxy hiccup, so it is retried twice with a short backoff before the run gives up.
 *
 * AI Agent Note - a 404 is probed once against `?rest_route=`, then reported:
 * The most common WooCommerce mistake is permalinks set to "Plain", which removes `/wp-json/wc/v3`
 * from the site - but WordPress still answers the identical route as `/?rest_route=/wc/v3/…`, so a
 * shop can be perfectly usable and still 404 on the pretty path. Rather than ask an operator to
 * change permalinks on a live shop (which rewrites every product URL), a 404 on the pretty path is
 * retried in the `rest_route` shape and, if that works, remembered for the process. Only when both
 * shapes 404 is the shop reported as having no REST API.
 *
 * AI Agent Note - a 401 is also retried once, with the key in the query string:
 * A real shop (b2b.smartlife-vn.com) answers 401 `woocommerce_rest_cannot_view` to a *valid* key
 * because its nginx/php setup drops the `Authorization` header before WordPress sees it; the same
 * key in `?consumer_key=&consumer_secret=` returns 200 from the identical URL. So on a 401/403 the
 * request is repeated once in that form and, if it succeeds, remembered for the process. This is a
 * fallback, never the default: the query string lands in the shop's own access logs, so the header
 * stays first choice and the UI tells the operator which one was used. Only an answer that *fails*
 * both ways is reported as a bad key - which is the point, because "check the key" would be wrong
 * advice for a header-dropping host.
 */

/** Shops found to need the `?rest_route=` shape. Two entries at most, so it is a Set, not a DB. */
const restRouteShops = new Set<string>();

/** Shops whose server drops `Authorization`, so the key must ride in the query string. */
const queryAuthShops = new Set<string>();

/** How the key is presented to the shop. `query` only for hosts that strip the header. */
export type WooAuthMode = "header" | "query";

/** Forget what was learned about a shop - used when its address is edited, or on restart. */
export function forgetWooUrlStyle(baseUrl: string): void {
  const key = baseUrl.replace(/\/+$/, "");
  restRouteShops.delete(key);
  queryAuthShops.delete(key);
}

function urlStyleFor(baseUrl: string): WooUrlStyle {
  return restRouteShops.has(baseUrl) ? "rest_route" : "pretty";
}

function authModeFor(baseUrl: string): WooAuthMode {
  return queryAuthShops.has(baseUrl) ? "query" : "header";
}

export interface WooCommerceClientConfig {
  /** Origin of the shop, e.g. `https://www.smartlife-vn.com` (no `/wp-json`). */
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class WooCommerceError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null = null,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "WooCommerceError";
  }
}

/** The fields of a WooCommerce product the catalogue refresh reads. */
export interface WooProduct {
  id: number;
  name?: string;
  sku?: string;
  type?: string;
  status?: string;
  parent_id?: number;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  stock_status?: string | null;
  attributes?: Array<{ name?: string; option?: string }>;
}

/** A variation answers the same fields as a product plus `parent_id`. */
export type WooVariation = WooProduct;

export interface WooConnectionTest {
  baseUrl: string;
  /** How many products the sample request returned (0 is a valid, empty shop). */
  sampleProducts: number;
  /** `X-WP-Total` when the shop sends it - the catalogue size, useful before a refresh. */
  totalProducts: number | null;
  /** `rest_route` means the shop has "Plain" permalinks and the fallback form was needed. */
  urlStyle: WooUrlStyle;
  /** `query` means the shop's server stripped `Authorization` and the key had to go in the URL. */
  authMode: WooAuthMode;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export class WooCommerceClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly consumerKey: string;
  private readonly consumerSecret: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: WooCommerceClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;
    this.authHeader = `Basic ${Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64")}`;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_WOO_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? 2;
  }

  /**
   * One `fetch`, with the key in the header and no credential anywhere in the URL.
   *
   * `auth: "query"` is the fallback for hosts that drop the header - see `queryAuthShops`.
   */
  private async send(
    method: "GET" | "POST",
    url: string,
    body: unknown,
    auth: WooAuthMode,
  ): Promise<Response> {
    return fetch(url, {
      method,
      headers: {
        // Sending both would be worse, not better: WordPress picks one and ignores the other, so
        // the form actually used is the only one sent.
        ...(auth === "header" ? { Authorization: this.authHeader } : {}),
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private buildUrl(
    style: WooUrlStyle,
    path: string,
    query: Record<string, string | number | boolean | undefined> | undefined,
    auth: WooAuthMode,
  ): string {
    const url = wooApiUrl(this.baseUrl, path, { style, query });
    if (auth === "header") return url;

    // The URL now carries the secret. It is never logged and never appears in an error message
    // (every message in this file names `baseUrl` only), and it only travels over HTTPS.
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}consumer_key=${encodeURIComponent(
      this.consumerKey,
    )}&consumer_secret=${encodeURIComponent(this.consumerSecret)}`;
  }

  /** GET/POST one endpoint and parse the JSON body, turning refusals into WooCommerceError. */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: {
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
    } = {},
  ): Promise<{ data: T; headers: Headers; urlStyle: WooUrlStyle; authMode: WooAuthMode }> {
    let style = urlStyleFor(this.baseUrl);
    let auth = authModeFor(this.baseUrl);
    let lastTransportError: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await this.send(
          method,
          this.buildUrl(style, path, options.query, auth),
          options.body,
          auth,
        );
      } catch (error) {
        lastTransportError = error;
        if (attempt < this.maxRetries) {
          await delay(300 * (attempt + 1));
          continue;
        }
        const reason = error instanceof Error ? error.message : String(error);
        throw new WooCommerceError(
          `Could not reach ${this.baseUrl}: ${reason}`,
          null,
          "transport_error",
        );
      }

      // A shop on "Plain" permalinks 404s the pretty path while serving the same routes under
      // `?rest_route=`. Probe that once; if it answers at all - even with a refusal - the route
      // exists, and every later call goes straight there. Only a 404 keeps the original answer.
      if (response.status === 404 && style === "pretty") {
        const restRouteUrl = this.buildUrl("rest_route", path, options.query, auth);
        const fallback = await this.send(method, restRouteUrl, options.body, auth).catch(
          () => null,
        );
        if (fallback && fallback.status !== 404) {
          restRouteShops.add(this.baseUrl);
          style = "rest_route";
          response = fallback;
        }
      }

      // Some hosts (nginx without `fastcgi_param HTTP_AUTHORIZATION`, Apache CGI, a security
      // plugin) hand WordPress an anonymous request, so a good key looks like a bad one. The same
      // key in the query string is tried once; only that answer decides.
      if ((response.status === 401 || response.status === 403) && auth === "header") {
        const queryUrl = this.buildUrl(style, path, options.query, "query");
        const withQuery = await this.send(method, queryUrl, options.body, "query").catch(
          () => null,
        );
        if (withQuery && withQuery.ok) {
          queryAuthShops.add(this.baseUrl);
          auth = "query";
          response = withQuery;
        }
      }

      if (RETRY_STATUSES.has(response.status) && attempt < this.maxRetries) {
        await delay(300 * (attempt + 1));
        continue;
      }

      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }

      if (!response.ok) {
        throw this.toError(response, parsed);
      }

      return { data: parsed as T, headers: response.headers, urlStyle: style, authMode: auth };
    }

    // Unreachable in practice: the loop either returns or throws.
    const reason =
      lastTransportError instanceof Error ? lastTransportError.message : "unknown error";
    throw new WooCommerceError(
      `Could not reach ${this.baseUrl}: ${reason}`,
      null,
      "transport_error",
    );
  }

  private toError(response: Response, parsed: unknown): WooCommerceError {
    const body = (parsed ?? {}) as { code?: string; message?: string; data?: unknown };

    if (response.status === 401 || response.status === 403) {
      // Both forms were tried by the time this is reached (header, then query string), so the key
      // really is refused - not merely hidden from us by the host.
      const detail = body.message ? ` The shop said: ${body.message}` : "";
      return new WooCommerceError(
        `${this.baseUrl} refused the API key (${response.status}), in both the Authorization header and the query string.${detail} Check the key was generated on this shop, has Read/Write permission, and belongs to a user with the shop_manager or administrator role.`,
        response.status,
        body.code ?? "unauthorized",
        body,
      );
    }

    if (response.status === 404) {
      return new WooCommerceError(
        `${this.baseUrl} has no WooCommerce REST API: both /wp-json/wc/v3 and ?rest_route=/wc/v3 returned 404. Check that WooCommerce is active, that the shop answers over HTTPS, and that the key still has Read/Write permission.`,
        404,
        body.code ?? "rest_no_route",
        body,
      );
    }

    return new WooCommerceError(
      body.message ?? `WooCommerce request failed (${response.status} ${response.statusText})`,
      response.status,
      body.code ?? null,
      body,
    );
  }

  /** `GET /products?per_page=1` - proves the address, the key and the API path in one call. */
  async testConnection(): Promise<WooConnectionTest> {
    const { data, headers, urlStyle, authMode } = await this.request<WooProduct[]>(
      "GET",
      "/products",
      {
        query: { per_page: 1, status: "any" },
      },
    );

    return {
      baseUrl: this.baseUrl,
      sampleProducts: Array.isArray(data) ? data.length : 0,
      totalProducts: asNumber(headers.get("x-wp-total")),
      urlStyle,
      authMode,
    };
  }

  /**
   * Every page of a collection, following `per_page` until a short page arrives.
   *
   * `maxPages` is a guard, not a setting: a shop with more than 100 pages of products is beyond
   * what this sync was written for, and stopping is better than looping forever.
   */
  async listAll<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
    maxPages = 50,
  ): Promise<T[]> {
    const perPage = WOO_PAGE_SIZE;
    const all: T[] = [];

    for (let page = 1; page <= maxPages; page += 1) {
      const { data } = await this.request<T[]>("GET", path, {
        query: { ...query, per_page: perPage, page },
      });

      if (!Array.isArray(data) || data.length === 0) break;
      all.push(...data);
      if (data.length < perPage) break;
    }

    return all;
  }

  listProducts(): Promise<WooProduct[]> {
    return this.listAll<WooProduct>("/products", { status: "any", orderby: "id", order: "asc" });
  }

  listVariations(parentId: number): Promise<WooVariation[]> {
    return this.listAll<WooVariation>(`/products/${parentId}/variations`, {
      orderby: "id",
      order: "asc",
    });
  }

  /** `POST /products/batch` - at most 100 objects per call (see `chunk`). */
  async batchUpdateProducts(update: Array<Record<string, unknown>>): Promise<unknown> {
    const { data } = await this.request<unknown>("POST", "/products/batch", {
      body: { update },
    });
    return data;
  }

  /** `POST /products/{parent}/variations/batch` - the same 100-object limit. */
  async batchUpdateVariations(
    parentId: number,
    update: Array<Record<string, unknown>>,
  ): Promise<unknown> {
    const { data } = await this.request<unknown>("POST", `/products/${parentId}/variations/batch`, {
      body: { update },
    });
    return data;
  }
}
