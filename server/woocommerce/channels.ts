import { asc, eq } from "drizzle-orm";
import { db } from "@db";
import { websiteChannels } from "@db/schema";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "../integration-secrets";
import { maskSecret, normaliseBaseUrl, type WebsiteStockScope } from "../../shared/woocommerce";
import { forgetWooUrlStyle } from "./client";

/**
 * The shops this ERP may push to.
 *
 * A "channel" is one WooCommerce site. It holds the address, the API key (encrypted at rest) and
 * the rules that shop is synced under. There are two rows today (`www` and `b2b`), and the screen
 * is the only place they are created - no credentials in code, no environment variable per shop.
 *
 * AI Agent Note - the API never returns the key:
 * `toPublicChannel` decrypts only to mask. If the encryption key has been rotated the row can no
 * longer be read, so the mask says so instead of failing the whole list - an operator must still
 * be able to see the channels and re-enter the key.
 *
 * AI Agent Note - the address is normalised on save:
 * `www.smartlife-vn.com/` and `https://www.smartlife-vn.com/wp-json` both become
 * `https://www.smartlife-vn.com`. Doing it once, at the boundary, keeps the client from building
 * `…/wp-json/wp-json/…`.
 */

export class WebsiteChannelError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly suggestion?: string,
  ) {
    super(message);
    this.name = "WebsiteChannelError";
  }
}

export interface WebsiteChannelInput {
  name?: string;
  baseUrl?: string;
  consumerKey?: string;
  consumerSecret?: string;
  isActive?: boolean;
  stockScope?: WebsiteStockScope;
  clampNegative?: boolean;
  allowBackorders?: boolean;
  forceManageStock?: boolean;
}

export interface PublicWebsiteChannel {
  id: number;
  name: string;
  baseUrl: string;
  isActive: boolean;
  stockScope: WebsiteStockScope;
  clampNegative: boolean;
  allowBackorders: boolean;
  forceManageStock: boolean;
  syncIntervalMinutes: number;
  /** `••••••••9f12` - recognisable, unusable. */
  consumerKeyMasked: string;
  consumerSecretMasked: string;
  hasCredentials: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type WebsiteChannelRow = typeof websiteChannels.$inferSelect;

function maskStored(value: string): string {
  try {
    return maskSecret(decryptSecret(value));
  } catch {
    // Rotated INTEGRATION_SECRET_KEY: the row is unusable until the key is re-entered.
    return "•••• (cannot decrypt - re-enter the key)";
  }
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toPublicChannel(row: WebsiteChannelRow): PublicWebsiteChannel {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    isActive: row.isActive,
    stockScope: (row.stockScope as WebsiteStockScope) ?? "ALL",
    clampNegative: row.clampNegative,
    allowBackorders: row.allowBackorders,
    forceManageStock: row.forceManageStock,
    syncIntervalMinutes: row.syncIntervalMinutes,
    consumerKeyMasked: maskStored(row.consumerKeyEnc),
    consumerSecretMasked: maskStored(row.consumerSecretEnc),
    hasCredentials: Boolean(row.consumerKeyEnc && row.consumerSecretEnc),
    lastSyncAt: toIso(row.lastSyncAt),
    lastSyncStatus: row.lastSyncStatus,
    lastSyncMessage: row.lastSyncMessage,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** The plain credentials, for one request. Never log or serialise the result. */
export function resolveChannelCredentials(row: WebsiteChannelRow): {
  consumerKey: string;
  consumerSecret: string;
} {
  try {
    return {
      consumerKey: decryptSecret(row.consumerKeyEnc),
      consumerSecret: decryptSecret(row.consumerSecretEnc),
    };
  } catch {
    throw new WebsiteChannelError(
      `The API key for ${row.name} could not be decrypted`,
      400,
      "Re-enter the WooCommerce key and secret on this channel, then test the connection again.",
    );
  }
}

export async function listChannels(): Promise<PublicWebsiteChannel[]> {
  const rows = await db.select().from(websiteChannels).orderBy(asc(websiteChannels.name));
  return rows.map(toPublicChannel);
}

export async function getChannelRecord(id: number): Promise<WebsiteChannelRow | null> {
  const [row] = await db.select().from(websiteChannels).where(eq(websiteChannels.id, id)).limit(1);
  return row ?? null;
}

/** The channel or a 404 - the routes would otherwise have to repeat this check. */
export async function requireChannel(id: number): Promise<WebsiteChannelRow> {
  const row = await getChannelRecord(id);
  if (!row) {
    throw new WebsiteChannelError(
      "That website no longer exists",
      404,
      "Reload the list - it may have been deleted in another tab.",
    );
  }
  return row;
}

function normaliseScope(
  scope: WebsiteStockScope | undefined,
  fallback: WebsiteStockScope,
): WebsiteStockScope {
  if (scope === "ALL" || scope === "DC" || scope === "STORES") return scope;
  return fallback;
}

export async function createChannel(input: WebsiteChannelInput): Promise<PublicWebsiteChannel> {
  const name = String(input.name ?? "").trim();
  if (!name) {
    throw new WebsiteChannelError(
      "A name is required",
      400,
      'Name the website, e.g. "SmartLife Retail".',
    );
  }

  const consumerKey = String(input.consumerKey ?? "").trim();
  const consumerSecret = String(input.consumerSecret ?? "").trim();
  if (!consumerKey || !consumerSecret) {
    throw new WebsiteChannelError(
      "The WooCommerce consumer key and secret are required",
      400,
      "WooCommerce > Settings > Advanced > REST API > Add key (Read/Write).",
    );
  }

  // Refuse before touching the database: a row with an unreadable key is worse than no row.
  if (!isEncryptionConfigured()) {
    throw new WebsiteChannelError(
      "Server encryption key is missing",
      500,
      "Set INTEGRATION_SECRET_KEY (16+ characters) in .env and restart the server.",
    );
  }

  const baseUrl = normaliseBaseUrl(String(input.baseUrl ?? ""));
  const [existing] = await db
    .select({ id: websiteChannels.id })
    .from(websiteChannels)
    .where(eq(websiteChannels.baseUrl, baseUrl))
    .limit(1);
  if (existing) {
    throw new WebsiteChannelError(
      `${baseUrl} is already set up`,
      409,
      "Edit the existing channel instead of adding a second one.",
    );
  }

  const [row] = await db
    .insert(websiteChannels)
    .values({
      name,
      baseUrl,
      consumerKeyEnc: encryptSecret(consumerKey),
      consumerSecretEnc: encryptSecret(consumerSecret),
      isActive: input.isActive ?? true,
      stockScope: normaliseScope(input.stockScope, "ALL"),
      clampNegative: input.clampNegative ?? true,
      allowBackorders: input.allowBackorders ?? false,
      forceManageStock: input.forceManageStock ?? false,
    })
    .returning();

  return toPublicChannel(row);
}

/**
 * Change a channel. The two credentials are only rewritten when a new value is sent, so saving the
 * form to flip "active" does not require re-typing the key.
 */
export async function updateChannel(
  id: number,
  input: WebsiteChannelInput,
): Promise<PublicWebsiteChannel> {
  const existing = await requireChannel(id);
  const patch: Partial<typeof websiteChannels.$inferInsert> = { updatedAt: new Date() };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) {
      throw new WebsiteChannelError("A name is required", 400, 'Name the website, e.g. "SmartLife B2B".');
    }
    patch.name = name;
  }

  if (input.baseUrl !== undefined) {
    const baseUrl = normaliseBaseUrl(input.baseUrl);
    if (baseUrl !== existing.baseUrl) {
      const [clash] = await db
        .select({ id: websiteChannels.id })
        .from(websiteChannels)
        .where(eq(websiteChannels.baseUrl, baseUrl))
        .limit(1);
      if (clash && clash.id !== id) {
        throw new WebsiteChannelError(
          `${baseUrl} is already set up`,
          409,
          "Two channels cannot point at the same shop.",
        );
      }
      // The client remembers which URL shape answered; a different address must probe again.
      forgetWooUrlStyle(existing.baseUrl);
    }
    patch.baseUrl = baseUrl;
  }

  const consumerKey = input.consumerKey?.trim();
  const consumerSecret = input.consumerSecret?.trim();
  if (consumerKey || consumerSecret) {
    if (!isEncryptionConfigured()) {
      throw new WebsiteChannelError(
        "Server encryption key is missing",
        500,
        "Set INTEGRATION_SECRET_KEY (16+ characters) in .env and restart the server.",
      );
    }
    // Both must be sent together: half a key pair is always a mistake.
    if (!consumerKey || !consumerSecret) {
      throw new WebsiteChannelError(
        "Send both the WooCommerce consumer key and secret",
        400,
        "Leave both fields blank to keep the stored key, or fill both to replace it.",
      );
    }
    patch.consumerKeyEnc = encryptSecret(consumerKey);
    patch.consumerSecretEnc = encryptSecret(consumerSecret);
  }

  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (input.stockScope !== undefined) patch.stockScope = normaliseScope(input.stockScope, existing.stockScope as WebsiteStockScope);
  if (input.clampNegative !== undefined) patch.clampNegative = input.clampNegative;
  if (input.allowBackorders !== undefined) patch.allowBackorders = input.allowBackorders;
  if (input.forceManageStock !== undefined) patch.forceManageStock = input.forceManageStock;

  const [row] = await db
    .update(websiteChannels)
    .set(patch)
    .where(eq(websiteChannels.id, id))
    .returning();

  return toPublicChannel(row);
}

/** Deleting a channel cascades to its links, state and run history. */
export async function deleteChannel(id: number): Promise<void> {
  const existing = await requireChannel(id);
  await db.delete(websiteChannels).where(eq(websiteChannels.id, id));
  forgetWooUrlStyle(existing.baseUrl);
}
