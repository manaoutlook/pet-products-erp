import { useQuery } from "@tanstack/react-query";
import { readApiError } from "@/lib/apiError";

/**
 * The Website Stock Sync screen's data.
 *
 * The server owns every decision (which SKUs changed, what quantity is sent, what the shop
 * refused), so this hook only transports. Nothing here recomputes stock: the preview the operator
 * approves is the exact plan the run executes.
 *
 * AI Agent Note - the preview query is keyed by mode:
 * `changed` and `all` are different pushes, not different views of the same data. Switching the
 * mode must re-ask the server, otherwise the count shown would belong to the other mode.
 */

export type WebsiteStockScope = "ALL" | "DC" | "STORES";
export type StockSyncMode = "changed" | "all";

export interface WebsiteChannel {
  id: number;
  name: string;
  baseUrl: string;
  isActive: boolean;
  stockScope: WebsiteStockScope;
  clampNegative: boolean;
  allowBackorders: boolean;
  forceManageStock: boolean;
  syncIntervalMinutes: number;
  consumerKeyMasked: string;
  consumerSecretMasked: string;
  hasCredentials: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WebsiteChannelInput {
  name: string;
  baseUrl: string;
  /** Omit both to keep the stored key (edit); send both to replace it. */
  consumerKey?: string;
  consumerSecret?: string;
  isActive?: boolean;
  stockScope?: WebsiteStockScope;
  clampNegative?: boolean;
  allowBackorders?: boolean;
  forceManageStock?: boolean;
}

export interface StockSyncPreviewItem {
  productId: number;
  sku: string;
  wooId: number;
  wooType: "simple" | "variation";
  wooParentId: number | null;
  quantity: number;
  siteQuantity: number | null;
  reason: string;
  stockStatus: string;
}

export interface StockSyncPreview {
  channel: WebsiteChannel;
  mode: StockSyncMode;
  totals: {
    snapshotProducts: number;
    linkedProducts: number;
    toSend: number;
    unchanged: number;
    notTracking: number;
    disabledLinks: number;
    missingProducts: number;
  };
  items: StockSyncPreviewItem[];
  notTracking: Array<{ sku: string; wooId: number; name: string | null }>;
  generatedAt: string;
}

export interface WebsiteConnectionTest {
  baseUrl: string;
  sampleProducts: number;
  totalProducts: number | null;
  /** `rest_route` means the shop has Plain permalinks and the fallback address was used. */
  urlStyle: "pretty" | "rest_route";
  /** `query` means the shop's server stripped Authorization, so the key went in the address. */
  authMode: "header" | "query";
}

export interface CatalogueRefreshResult {
  channelId: number;
  channelName: string;
  siteEntries: number;
  linked: number;
  created: number;
  updated: number;
  dropped: number;
  unmapped: Array<{
    wooId: number;
    wooType: string;
    sku: string;
    name: string;
    reason: "missing-sku" | "no-erp-match" | "duplicate-sku";
  }>;
}

export interface StockSyncRunResult {
  runId: number;
  channelId: number;
  channelName: string;
  status: "success" | "partial" | "failed";
  mode: StockSyncMode;
  totals: {
    planned: number;
    succeeded: number;
    failed: number;
    skipped: number;
    unchanged: number;
    notTracking: number;
  };
  message: string;
  durationMs: number;
  failures: Array<{ sku: string; message: string }>;
}

export interface SyncRunSummary {
  id: number;
  channelId: number;
  channelName: string | null;
  trigger: string;
  mode: string;
  status: string;
  totalItems: number;
  changedItems: number;
  succeeded: number;
  failed: number;
  skipped: number;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  triggeredByUserId: number | null;
}

export interface SyncRunDetail extends SyncRunSummary {
  items: Array<{
    id: number;
    sku: string;
    wooId: number | null;
    wooType: string;
    quantitySent: number | null;
    wooQuantityBefore: number | null;
    wooQuantityAfter: number | null;
    status: string;
    httpStatus: number | null;
    message: string | null;
  }>;
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "include",
      ...init,
      headers: {
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    // The browser says "Failed to fetch" when nothing is listening - a stopped dev server, a
    // restarted one, or a dropped connection. That sentence is useless in a toast, so say what to
    // do instead of echoing the DOM exception.
    throw new Error(
      "The ERP server did not answer. Check that it is running (npm run dev), reload this tab, then try again.",
    );
  }

  if (!response.ok) {
    // The server answers { message, suggestion }; readApiError joins them for the toast.
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as T;
}

export const WEBSITE_CHANNELS_KEY = "/api/website-sync/channels";

export function useWebsiteChannels() {
  const query = useQuery<WebsiteChannel[]>({
    queryKey: [WEBSITE_CHANNELS_KEY],
    queryFn: async () => {
      const payload = await requestJson<{ channels: WebsiteChannel[] }>(WEBSITE_CHANNELS_KEY);
      return Array.isArray(payload.channels) ? payload.channels : [];
    },
  });

  return { ...query, channels: query.data ?? [] };
}

export function useWebsiteSyncPreview(
  channelId: number | null,
  mode: StockSyncMode,
  enabled = true,
) {
  const query = useQuery<StockSyncPreview>({
    queryKey: ["/api/website-sync/preview", channelId, mode],
    enabled: enabled && channelId !== null,
    // A preview is a snapshot of stock that moves all day; never serve it from a stale cache.
    staleTime: 0,
    queryFn: async () =>
      requestJson<StockSyncPreview>(
        `/api/website-sync/preview?channelId=${channelId}&mode=${mode}`,
      ),
  });

  return { ...query, preview: query.data ?? null };
}

export function useWebsiteSyncRuns(channelId: number | null) {
  const query = useQuery<SyncRunSummary[]>({
    queryKey: ["/api/website-sync/runs", channelId],
    enabled: channelId !== null,
    queryFn: async () => {
      const payload = await requestJson<{ runs: SyncRunSummary[] }>(
        `/api/website-sync/runs?channelId=${channelId}&limit=20`,
      );
      return Array.isArray(payload.runs) ? payload.runs : [];
    },
  });

  return { ...query, runs: query.data ?? [] };
}

export function useWebsiteSyncRun(runId: number | null) {
  const query = useQuery<SyncRunDetail>({
    queryKey: ["/api/website-sync/runs/detail", runId],
    enabled: runId !== null,
    queryFn: async () => {
      const payload = await requestJson<{ run: SyncRunDetail }>(`/api/website-sync/runs/${runId}`);
      return payload.run;
    },
  });

  return { ...query, run: query.data ?? null };
}

export async function saveWebsiteChannel(
  input: WebsiteChannelInput,
  id?: number,
): Promise<WebsiteChannel> {
  const payload = await requestJson<{ channel: WebsiteChannel }>(
    id === undefined ? WEBSITE_CHANNELS_KEY : `${WEBSITE_CHANNELS_KEY}/${id}`,
    {
      method: id === undefined ? "POST" : "PUT",
      body: JSON.stringify(input),
    },
  );

  return payload.channel;
}

export async function deleteWebsiteChannel(id: number): Promise<void> {
  await requestJson<{ message: string }>(`${WEBSITE_CHANNELS_KEY}/${id}`, { method: "DELETE" });
}

export async function testWebsiteChannel(id: number): Promise<WebsiteConnectionTest> {
  const payload = await requestJson<{ result: WebsiteConnectionTest }>(
    `${WEBSITE_CHANNELS_KEY}/${id}/test`,
    { method: "POST" },
  );
  return payload.result;
}

export async function refreshWebsiteCatalogue(id: number): Promise<CatalogueRefreshResult> {
  const payload = await requestJson<{ result: CatalogueRefreshResult }>(
    `${WEBSITE_CHANNELS_KEY}/${id}/refresh-catalogue`,
    { method: "POST" },
  );
  return payload.result;
}

export async function runWebsiteSync(
  channelId: number,
  mode: StockSyncMode,
): Promise<StockSyncRunResult> {
  const payload = await requestJson<{ result: StockSyncRunResult }>("/api/website-sync/run", {
    method: "POST",
    body: JSON.stringify({ channelId, mode }),
  });
  return payload.result;
}
