import { desc, eq, sql } from "drizzle-orm";
import { db } from "@db";
import {
  websiteChannels,
  websiteStockState,
  websiteStockSyncItems,
  websiteStockSyncRuns,
} from "@db/schema";
import {
  buildStockUpdatePayload,
  chunk,
  groupVariationsByParent,
  parseBatchResponse,
  planStockSync,
  resolveStockFields,
  type PlannedStockItem,
  type StockSyncMode,
  type WebsiteLinkRow,
} from "../../shared/woocommerce";
import type { DbClient } from "../db-types";
import { loadChannelLinks } from "./catalogue";
import {
  requireChannel,
  resolveChannelCredentials,
  toPublicChannel,
  WebsiteChannelError,
  type PublicWebsiteChannel,
} from "./channels";
import { WooCommerceClient, WooCommerceError } from "./client";
import { loadStockSnapshot } from "./stock-snapshot";

/**
 * One manual push of ERP stock to one WooCommerce shop.
 *
 * The flow is deliberately boring, because it writes to a live shop:
 *
 *   1. take the channel's advisory lock (a second click gets 409, not two interleaved runs);
 *   2. read the ERP snapshot, the channel's links and the last accepted quantities;
 *   3. `planStockSync` decides what changed (pure, unit-tested);
 *   4. send it in batches of 100 through `products/batch` (variations through their parent);
 *   5. record every line - success, refusal, or skip - and update the channel's last-run stamp.
 *
 * "Last accepted quantity" (`website_stock_state`) is written ONLY after a line succeeds. That is
 * what makes a delta run safe: a refused line keeps its old state, so the next run sends it again
 * instead of assuming it is up to date.
 *
 * AI Agent Note - why the whole run is one transaction:
 * `pg_try_advisory_xact_lock` releases itself when the transaction ends, so a crashed run can never
 * leave a stuck lock behind. The writes are inserts into sync tables plus one upserted state row
 * per product; they do not contend with the sale screens. The HTTP calls happen inside it, which
 * is the price of holding the lock for exactly the duration of the run.
 *
 * AI Agent Note - an unexpected error still leaves a record:
 * If the transaction throws, it rolls back (taking the half-written run with it), so the run is
 * re-inserted outside as `failed` with the message. An operator opening the screen the next morning
 * sees why nothing changed instead of an empty history.
 */

/** Per-channel advisory lock: two clicks on "Sync now" cannot interleave. */
export const WEBSITE_SYNC_LOCK_BASE = 918_273;

export class WebsiteSyncBusyError extends Error {
  readonly status = 409;

  constructor(readonly channelId: number) {
    super("A sync is already running for this website");
    this.name = "WebsiteSyncBusyError";
  }
}

export interface StockSyncPreviewItem {
  productId: number;
  sku: string;
  wooId: number;
  wooType: "simple" | "variation";
  wooParentId: number | null;
  /** What the ERP will send. */
  quantity: number;
  /** What the site reported at the last catalogue refresh. */
  siteQuantity: number | null;
  /** `all` | `new` | `changed` | `site-differs`. */
  reason: string;
  stockStatus: string;
}

export interface StockSyncPreview {
  channel: PublicWebsiteChannel;
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
  /** Products the site does not track: the push cannot change them. */
  notTracking: Array<{ sku: string; wooId: number; name: string | null }>;
  generatedAt: string;
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
  /** The first few refusals, with the site's own wording. */
  failures: Array<{ sku: string; message: string }>;
}

/** Last quantity each shop accepted, per ERP product. */
async function loadSyncState(
  channelId: number,
  executor: DbClient = db,
): Promise<Map<number, number>> {
  const rows = await executor
    .select({
      productId: websiteStockState.productId,
      quantity: websiteStockState.lastSyncedQuantity,
    })
    .from(websiteStockState)
    .where(eq(websiteStockState.channelId, channelId));

  return new Map(rows.map((row) => [row.productId, row.quantity]));
}

/**
 * What a run would send - the "Preview" the screen shows before anything is written.
 *
 * `mode` is part of the preview on purpose: `all` ignores the delta, and an operator about to push
 * 3,000 rows should see that number before clicking.
 */
export async function previewStockSync(
  channelId: number,
  mode: StockSyncMode = "changed",
): Promise<StockSyncPreview> {
  const channel = await requireChannel(channelId);

  const [snapshot, links, state] = await Promise.all([
    loadStockSnapshot({ scope: channel.stockScope as "ALL" | "DC" | "STORES" }),
    loadChannelLinks(channelId),
    loadSyncState(channelId),
  ]);

  const plan = planStockSync(snapshot, links as WebsiteLinkRow[], state, {
    clampNegative: channel.clampNegative,
    allowBackorders: channel.allowBackorders,
    forceManageStock: channel.forceManageStock,
    mode,
  });

  return {
    channel: toPublicChannel(channel),
    mode,
    totals: {
      snapshotProducts: snapshot.length,
      linkedProducts: links.length,
      toSend: plan.items.length,
      unchanged: plan.unchanged,
      notTracking: plan.notTracking.length,
      disabledLinks: plan.disabledLinks,
      missingProducts: plan.missingProducts,
    },
    items: plan.items.map((item) => ({
      productId: item.productId,
      sku: item.sku,
      wooId: item.wooId,
      wooType: item.wooType,
      wooParentId: item.wooParentId,
      quantity: item.quantity,
      siteQuantity: item.siteQuantity,
      reason: item.reason,
      stockStatus: resolveStockFields(item.quantity, {
        allowBackorders: channel.allowBackorders,
      }).stock_status,
    })),
    notTracking: plan.notTracking.map((item) => ({
      sku: item.sku,
      wooId: item.wooId,
      name: null,
    })),
    generatedAt: new Date().toISOString(),
  };
}

interface PushOutcome {
  item: PlannedStockItem;
  ok: boolean;
  message: string | null;
  httpStatus: number | null;
  /** What the shop echoed back, when it did. */
  siteQuantityAfter: number | null;
}

/**
 * Send one batch and fold the site's answer into `outcomes`.
 *
 * Returns the message when the failure makes every later batch pointless (bad key, wrong URL,
 * unreachable host) - the run then stops instead of hammering a shop that is answering "no".
 */
async function runBatch(
  send: () => Promise<unknown>,
  batch: PlannedStockItem[],
  outcomes: PushOutcome[],
): Promise<string | null> {
  try {
    const response = await send();
    const results = parseBatchResponse(
      response,
      batch.map((item) => item.wooId),
    );

    batch.forEach((item, index) => {
      const result = results[index];
      outcomes.push({
        item,
        ok: result.ok,
        message: result.message,
        httpStatus: result.httpStatus,
        siteQuantityAfter: result.stockQuantity,
      });
    });

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const httpStatus = error instanceof WooCommerceError ? error.status : null;

    for (const item of batch) {
      outcomes.push({ item, ok: false, message, httpStatus, siteQuantityAfter: null });
    }

    const fatal =
      error instanceof WooCommerceError &&
      (error.status === 401 || error.status === 403 || error.status === 404 || error.status === null);

    return fatal ? message : null;
  }
}

/**
 * Send every planned item: simple products through `/products/batch`, variations through their
 * parent's `/variations/batch`. A batch is at most 100 objects (WooCommerce's own limit).
 */
async function pushPlan(
  client: WooCommerceClient,
  items: PlannedStockItem[],
  options: { allowBackorders: boolean; forceManageStock: boolean },
): Promise<PushOutcome[]> {
  const outcomes: PushOutcome[] = [];
  const processed = new Set<number>();
  const asPayload = (item: PlannedStockItem) =>
    buildStockUpdatePayload(item, options) as unknown as Record<string, unknown>;

  const simple = items.filter((item) => item.wooType === "simple");
  const variations = items.filter((item) => item.wooType === "variation");

  let abortMessage: string | null = null;

  for (const batch of chunk(simple)) {
    const fatal = await runBatch(
      () => client.batchUpdateProducts(batch.map(asPayload)),
      batch,
      outcomes,
    );
    for (const item of batch) processed.add(item.wooId);
    if (fatal) {
      abortMessage = fatal;
      break;
    }
  }

  if (!abortMessage) {
    for (const group of groupVariationsByParent(variations)) {
      for (const batch of chunk(group.items)) {
        const fatal = await runBatch(
          () => client.batchUpdateVariations(group.parentId, batch.map(asPayload)),
          batch,
          outcomes,
        );
        for (const item of batch) processed.add(item.wooId);
        if (fatal) {
          abortMessage = fatal;
          break;
        }
      }
      if (abortMessage) break;
    }
  }

  if (abortMessage) {
    // Everything not yet attempted fails with the same reason - a complete record of the run.
    for (const item of items) {
      if (processed.has(item.wooId)) continue;
      outcomes.push({
        item,
        ok: false,
        message: abortMessage,
        httpStatus: null,
        siteQuantityAfter: null,
      });
    }
  }

  return outcomes;
}

/**
 * `pg_try_advisory_xact_lock` on a key derived from the channel id.
 *
 * The lock is transaction-scoped, so it is released by the commit, the rollback, or the connection
 * dying - there is no "stuck sync" to clear by hand.
 */
async function acquireChannelLock(tx: DbClient, channelId: number): Promise<boolean> {
  const result = await tx.execute(
    sql`SELECT pg_try_advisory_xact_lock(${WEBSITE_SYNC_LOCK_BASE + channelId}) AS locked`,
  );
  const row = (result as unknown as Array<{ locked: boolean }>)[0];
  return row?.locked === true;
}

/** A run that threw before it could be committed is still worth telling the operator about. */
async function recordFailedRun(
  channelId: number,
  mode: StockSyncMode,
  userId: number | null,
  message: string,
): Promise<void> {
  try {
    await db.insert(websiteStockSyncRuns).values({
      channelId,
      mode,
      status: "failed",
      message,
      finishedAt: new Date(),
      triggeredByUserId: userId,
    });
    await db
      .update(websiteChannels)
      .set({ lastSyncAt: new Date(), lastSyncStatus: "failed", lastSyncMessage: message })
      .where(eq(websiteChannels.id, channelId));
  } catch (error) {
    // The original error is what the caller must see; this is best-effort bookkeeping.
    console.error("Could not record the failed website sync run:", error);
  }
}

/**
 * Push the ERP stock to one shop and save the run.
 *
 * Throws `WebsiteChannelError` for a channel that cannot send (missing key, switched off),
 * `WebsiteSyncBusyError` when another run holds the lock, and the original error for anything
 * unexpected - after writing a `failed` run row so the screen can explain it.
 */
export async function runStockSync(options: {
  channelId: number;
  mode?: StockSyncMode;
  userId?: number | null;
}): Promise<StockSyncRunResult> {
  const { channelId, mode = "changed", userId = null } = options;
  const channel = await requireChannel(channelId);

  if (!channel.isActive) {
    throw new WebsiteChannelError(
      `${channel.name} is switched off`,
      400,
      "Turn the channel on before syncing - a disabled channel should not be written to.",
    );
  }

  // Resolved before the transaction: a rotated encryption key must not leave a "failed" run behind
  // for something the operator fixes by re-entering the key.
  const credentials = resolveChannelCredentials(channel);
  const client = new WooCommerceClient({ baseUrl: channel.baseUrl, ...credentials });
  const startedAt = Date.now();

  try {
    return await db.transaction(async (tx) => {
      if (!(await acquireChannelLock(tx, channelId))) {
        throw new WebsiteSyncBusyError(channelId);
      }

      const [run] = await tx
        .insert(websiteStockSyncRuns)
        .values({ channelId, mode, status: "running", triggeredByUserId: userId })
        .returning();

      const [snapshot, links] = await Promise.all([
        loadStockSnapshot({ scope: channel.stockScope as "ALL" | "DC" | "STORES" }),
        loadChannelLinks(channelId),
      ]);
      const state = await loadSyncState(channelId, tx);

      const plan = planStockSync(snapshot, links as WebsiteLinkRow[], state, {
        clampNegative: channel.clampNegative,
        allowBackorders: channel.allowBackorders,
        forceManageStock: channel.forceManageStock,
        mode,
      });

      const outcomes = await pushPlan(client, plan.items, {
        allowBackorders: channel.allowBackorders,
        forceManageStock: channel.forceManageStock,
      });

      const succeeded = outcomes.filter((outcome) => outcome.ok);
      const failed = outcomes.filter((outcome) => !outcome.ok);

      for (const batch of chunk(outcomes, 200)) {
        await tx.insert(websiteStockSyncItems).values(
          batch.map((outcome) => ({
            runId: run.id,
            productId: outcome.item.productId,
            sku: outcome.item.sku,
            wooId: outcome.item.wooId,
            wooType: outcome.item.wooType,
            quantitySent: outcome.item.quantity,
            wooQuantityBefore: outcome.item.siteQuantity,
            wooQuantityAfter: outcome.ok
              ? outcome.siteQuantityAfter ?? outcome.item.quantity
              : null,
            status: outcome.ok ? "success" : "failed",
            httpStatus: outcome.httpStatus,
            message: outcome.message,
          })),
        );
      }

      // State is written only for confirmed lines: a refusal keeps its old value and is retried.
      for (const batch of chunk(succeeded, 200)) {
        await tx
          .insert(websiteStockState)
          .values(
            batch.map((outcome) => ({
              channelId,
              productId: outcome.item.productId,
              lastSyncedQuantity: outcome.item.quantity,
              lastSyncedStockStatus: resolveStockFields(outcome.item.quantity, {
                allowBackorders: channel.allowBackorders,
              }).stock_status,
              lastSyncedAt: new Date(),
            })),
          )
          .onConflictDoUpdate({
            target: [websiteStockState.channelId, websiteStockState.productId],
            set: {
              lastSyncedQuantity: sql`excluded.last_synced_quantity`,
              lastSyncedStockStatus: sql`excluded.last_synced_stock_status`,
              lastSyncedAt: new Date(),
            },
          });
      }

      const skipped = plan.notTracking.length + plan.disabledLinks;
      const status: StockSyncRunResult["status"] =
        failed.length === 0 ? "success" : succeeded.length === 0 ? "failed" : "partial";
      // A run with nothing to send still needs to say why - "already matches" and "the shop does
      // not track stock" look identical in the history otherwise.
      const message =
        outcomes.length > 0
          ? `Sent ${succeeded.length} of ${outcomes.length} product(s)${failed.length > 0 ? `, ${failed.length} failed` : ""}.`
          : plan.notTracking.length > 0
            ? `Nothing to send - ${plan.notTracking.length} product(s) skipped because the shop does not track stock.`
            : "Nothing to send - every linked product already matches.";

      await tx
        .update(websiteStockSyncRuns)
        .set({
          status,
          totalItems: plan.items.length,
          changedItems: plan.items.length,
          succeeded: succeeded.length,
          failed: failed.length,
          skipped,
          message,
          finishedAt: new Date(),
        })
        .where(eq(websiteStockSyncRuns.id, run.id));

      await tx
        .update(websiteChannels)
        .set({ lastSyncAt: new Date(), lastSyncStatus: status, lastSyncMessage: message })
        .where(eq(websiteChannels.id, channelId));

      return {
        runId: run.id,
        channelId,
        channelName: channel.name,
        status,
        mode,
        totals: {
          planned: plan.items.length,
          succeeded: succeeded.length,
          failed: failed.length,
          skipped,
          unchanged: plan.unchanged,
          notTracking: plan.notTracking.length,
        },
        message,
        durationMs: Date.now() - startedAt,
        failures: failed.slice(0, 10).map((outcome) => ({
          sku: outcome.item.sku,
          message: outcome.message ?? "Unknown error",
        })),
      };
    });
  } catch (error) {
    // A busy channel is not a failed run - nothing was written.
    if (error instanceof WebsiteSyncBusyError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    await recordFailedRun(channelId, mode, userId, message);
    throw error;
  }
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

type StockSyncRunRow = typeof websiteStockSyncRuns.$inferSelect;

function toRunSummary(row: StockSyncRunRow, channelName: string | null): SyncRunSummary {
  return {
    id: row.id,
    channelId: row.channelId,
    channelName,
    trigger: row.trigger,
    mode: row.mode,
    status: row.status,
    totalItems: row.totalItems,
    changedItems: row.changedItems,
    succeeded: row.succeeded,
    failed: row.failed,
    skipped: row.skipped,
    message: row.message,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    triggeredByUserId: row.triggeredByUserId,
  };
}

/** The channel's recent runs, newest first - what the history table shows. */
export async function listSyncRuns(channelId: number, limit = 20): Promise<SyncRunSummary[]> {
  const rows = await db
    .select({ run: websiteStockSyncRuns, channelName: websiteChannels.name })
    .from(websiteStockSyncRuns)
    .innerJoin(websiteChannels, eq(websiteStockSyncRuns.channelId, websiteChannels.id))
    .where(eq(websiteStockSyncRuns.channelId, channelId))
    .orderBy(desc(websiteStockSyncRuns.startedAt))
    .limit(Math.min(200, Math.max(1, limit)));

  return rows.map((row) => toRunSummary(row.run, row.channelName));
}

/** One run with its per-product lines, capped so a 5,000-line run cannot hang the browser. */
export async function getSyncRun(runId: number): Promise<SyncRunDetail | null> {
  const [row] = await db
    .select({ run: websiteStockSyncRuns, channelName: websiteChannels.name })
    .from(websiteStockSyncRuns)
    .innerJoin(websiteChannels, eq(websiteStockSyncRuns.channelId, websiteChannels.id))
    .where(eq(websiteStockSyncRuns.id, runId))
    .limit(1);

  if (!row) return null;

  const items = await db
    .select()
    .from(websiteStockSyncItems)
    .where(eq(websiteStockSyncItems.runId, runId))
    .orderBy(websiteStockSyncItems.id)
    .limit(500);

  return {
    ...toRunSummary(row.run, row.channelName),
    items: items.map((item) => ({
      id: item.id,
      sku: item.sku,
      wooId: item.wooId,
      wooType: item.wooType,
      quantitySent: item.quantitySent,
      wooQuantityBefore: item.wooQuantityBefore,
      wooQuantityAfter: item.wooQuantityAfter,
      status: item.status,
      httpStatus: item.httpStatus,
      message: item.message,
    })),
  };
}
