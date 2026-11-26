import type { Express, Response } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware";
import { idParamSchema, validateBody, validateParams, validateQuery } from "../validate";
import {
  createChannel,
  deleteChannel,
  listChannels,
  requireChannel,
  resolveChannelCredentials,
  updateChannel,
  WebsiteChannelError,
  type WebsiteChannelInput,
} from "../woocommerce/channels";
import { refreshChannelCatalogue } from "../woocommerce/catalogue";
import { WooCommerceClient, WooCommerceError } from "../woocommerce/client";
import {
  getSyncRun,
  listSyncRuns,
  previewStockSync,
  runStockSync,
  WebsiteSyncBusyError,
} from "../woocommerce/sync";

/**
 * Website stock sync endpoints.
 *
 *   GET    /api/website-sync/channels                        the shops, with masked keys
 *   POST   /api/website-sync/channels                        add a shop
 *   PUT    /api/website-sync/channels/:id                    edit it (key optional)
 *   DELETE /api/website-sync/channels/:id                    remove it and its history
 *   POST   /api/website-sync/channels/:id/test               prove the address + key
 *   POST   /api/website-sync/channels/:id/refresh-catalogue  match SKUs, rebuild the links
 *   GET    /api/website-sync/preview                         what a run would send (no writes)
 *   POST   /api/website-sync/run                             push it
 *   GET    /api/website-sync/runs                            recent runs for one shop
 *   GET    /api/website-sync/runs/:id                        one run with its lines
 *
 * Permission module: `websiteSync`. A run writes to a live shop, so it is granted separately from
 * Inventory: counting stock and changing what customers can buy are different powers.
 *
 * AI Agent Note - preview is a real endpoint, not a flag on `run`:
 * A dry run that shares the write path is one boolean away from writing. `previewStockSync` shares
 * the planner with `runStockSync` but touches nothing, so the number the operator approves is the
 * number the run computes.
 *
 * AI Agent Note - WooCommerce refusals answer 502:
 * The ERP did nothing wrong; the shop (or the network in between) refused. 502 tells the operator
 * where to look without pretending the request was invalid.
 */

const modeSchema = z.enum(["changed", "all"], {
  errorMap: () => ({ message: "Pick Changed only or All products" }),
});

const channelBaseSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.string().trim().min(1).max(300).optional(),
  consumerKey: z.string().trim().max(500).optional(),
  consumerSecret: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
  stockScope: z.enum(["ALL", "DC", "STORES"]).optional(),
  clampNegative: z.boolean().optional(),
  allowBackorders: z.boolean().optional(),
  forceManageStock: z.boolean().optional(),
});

/** On create the four essentials are required; edit reuses the shape with everything optional. */
const channelCreateSchema = channelBaseSchema.extend({
  name: z.string().trim().min(1, "A name is required").max(120),
  baseUrl: z.string().trim().min(1, "The website address is required").max(300),
  consumerKey: z.string().trim().min(1, "The consumer key is required").max(500),
  consumerSecret: z.string().trim().min(1, "The consumer secret is required").max(500),
});

const previewQuerySchema = z.object({
  channelId: z.coerce.number().int().positive("Pick a website"),
  mode: modeSchema.optional(),
});

const runBodySchema = z.object({
  channelId: z.coerce.number().int().positive("Pick a website"),
  mode: modeSchema.optional(),
});

const runsQuerySchema = z.object({
  channelId: z.coerce.number().int().positive("Pick a website"),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** One place that turns a service error into the `{ message, suggestion }` body the client reads. */
function respondWithError(res: Response, error: unknown, fallbackMessage: string) {
  if (error instanceof WebsiteChannelError) {
    return res.status(error.status).json({
      message: error.message,
      ...(error.suggestion ? { suggestion: error.suggestion } : {}),
    });
  }

  if (error instanceof WebsiteSyncBusyError) {
    return res.status(409).json({
      message: error.message,
      suggestion: "Wait for the running sync to finish, then try again.",
    });
  }

  if (error instanceof WooCommerceError) {
    return res.status(502).json({
      message: error.message,
      suggestion: "Check the shop is reachable and the API key still has Read/Write permission.",
    });
  }

  console.error(`${fallbackMessage}:`, error);
  return res.status(500).json({ message: fallbackMessage });
}

export function registerWebsiteSyncRoutes(app: Express) {
  app.get(
    "/api/website-sync/channels",
    requirePermission("websiteSync", "read"),
    async (_req, res) => {
      try {
        res.json({ channels: await listChannels() });
      } catch (error) {
        respondWithError(res, error, "Failed to load the websites");
      }
    },
  );

  app.post(
    "/api/website-sync/channels",
    requirePermission("websiteSync", "create"),
    validateBody(
      channelCreateSchema,
      "A name, the shop address and the WooCommerce key are required",
    ),
    async (req, res) => {
      try {
        const channel = await createChannel(req.body as WebsiteChannelInput);
        res.status(201).json({ channel });
      } catch (error) {
        respondWithError(res, error, "Failed to add the website");
      }
    },
  );

  app.put(
    "/api/website-sync/channels/:id",
    requirePermission("websiteSync", "update"),
    validateParams(idParamSchema),
    validateBody(channelBaseSchema, "Check the website details and try again"),
    async (req, res) => {
      try {
        const channel = await updateChannel(Number(req.params.id), req.body as WebsiteChannelInput);
        res.json({ channel });
      } catch (error) {
        respondWithError(res, error, "Failed to save the website");
      }
    },
  );

  app.delete(
    "/api/website-sync/channels/:id",
    requirePermission("websiteSync", "delete"),
    validateParams(idParamSchema),
    async (req, res) => {
      try {
        await deleteChannel(Number(req.params.id));
        res.json({ message: "Website removed" });
      } catch (error) {
        respondWithError(res, error, "Failed to remove the website");
      }
    },
  );

  /** Proves the address, the key and the REST route in one request ("Test connection"). */
  app.post(
    "/api/website-sync/channels/:id/test",
    requirePermission("websiteSync", "update"),
    validateParams(idParamSchema),
    async (req, res) => {
      try {
        const channel = await requireChannel(Number(req.params.id));
        const client = new WooCommerceClient({
          baseUrl: channel.baseUrl,
          ...resolveChannelCredentials(channel),
        });

        res.json({ result: await client.testConnection() });
      } catch (error) {
        respondWithError(res, error, "Failed to test the connection");
      }
    },
  );

  /**
   * Rebuild the SKU mapping from the live catalogue.
   *
   * This is the step that makes a push possible: without links nothing is syncable, and the
   * `unmapped` list is what tells an operator which SKUs do not exist on the site (or in the ERP).
   */
  app.post(
    "/api/website-sync/channels/:id/refresh-catalogue",
    requirePermission("websiteSync", "update"),
    validateParams(idParamSchema),
    async (req, res) => {
      try {
        res.json({ result: await refreshChannelCatalogue(Number(req.params.id)) });
      } catch (error) {
        respondWithError(res, error, "Failed to refresh the catalogue");
      }
    },
  );

  /** What the run would send. Nothing is written - this is the confirmation step. */
  app.get(
    "/api/website-sync/preview",
    requirePermission("websiteSync", "read"),
    validateQuery(previewQuerySchema, "Pick a website and a sync mode"),
    async (req, res) => {
      const query = req.query as unknown as { channelId: number; mode?: "changed" | "all" };
      try {
        res.json(await previewStockSync(query.channelId, query.mode ?? "changed"));
      } catch (error) {
        respondWithError(res, error, "Failed to build the preview");
      }
    },
  );

  app.post(
    "/api/website-sync/run",
    requirePermission("websiteSync", "update"),
    validateBody(runBodySchema, "Pick a website and a sync mode"),
    async (req, res) => {
      const body = req.body as { channelId: number; mode?: "changed" | "all" };
      try {
        const result = await runStockSync({
          channelId: body.channelId,
          mode: body.mode ?? "changed",
          userId: req.user?.id ?? null,
        });
        res.json({ result });
      } catch (error) {
        respondWithError(res, error, "The stock sync failed");
      }
    },
  );

  app.get(
    "/api/website-sync/runs",
    requirePermission("websiteSync", "read"),
    validateQuery(runsQuerySchema, "Pick a website"),
    async (req, res) => {
      const query = req.query as unknown as { channelId: number; limit?: number };
      try {
        res.json({ runs: await listSyncRuns(query.channelId, query.limit ?? 20) });
      } catch (error) {
        respondWithError(res, error, "Failed to load the sync history");
      }
    },
  );

  app.get(
    "/api/website-sync/runs/:id",
    requirePermission("websiteSync", "read"),
    validateParams(idParamSchema),
    async (req, res) => {
      try {
        const run = await getSyncRun(Number(req.params.id));
        if (!run) {
          return res.status(404).json({
            message: "That sync run no longer exists",
            suggestion: "Reload the history - old runs are kept with their website.",
          });
        }
        res.json({ run });
      } catch (error) {
        respondWithError(res, error, "Failed to load the sync run");
      }
    },
  );
}

export default registerWebsiteSyncRoutes;
