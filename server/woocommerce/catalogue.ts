import { eq } from "drizzle-orm";
import { db } from "@db";
import { products, websiteProductLinks } from "@db/schema";
import { chunk, normaliseSku, type WooProductType } from "../../shared/woocommerce";
import { requireChannel, resolveChannelCredentials } from "./channels";
import { WooCommerceClient, type WooProduct } from "./client";

/**
 * The SKU bridge: what the shop calls each product, per channel.
 *
 * A push writes to a WooCommerce product id, not to a SKU, so the ids have to be recorded first.
 * This module fetches the shop's catalogue, matches each entry to `products.sku`, and replaces the
 * channel's mapping in one transaction. Everything it could not match is returned - the screen
 * shows it as an "Unmapped" list, which is how a typo'd SKU gets noticed instead of silently
 * leaving a product at its last quantity forever.
 *
 * AI Agent Note - variations are matched, not only products:
 * On a variable product nobody sets `manage_stock` on the parent; the quantities live on the
 * variations. Matching the parent alone would report every variable product as "not tracking
 * stock". Each variation is therefore its own link row, addressed through `wooParentId`.
 *
 * AI Agent Note - the mapping is rebuilt, not merged:
 * Refreshing replaces the rows for the channel (preserving the operator's `syncEnabled` flag per
 * product). A merge would leave ids behind after a product is deleted and re-created on the site,
 * and the push would then write to an id that no longer exists.
 *
 * AI Agent Note - a duplicate SKU is a report, not a guess:
 * If two site entries carry the same SKU, only the first is linked and the second is listed as
 * `duplicate-sku`. Picking one at random would send stock to the wrong product.
 */

export interface CatalogueEntry {
  wooId: number;
  wooType: WooProductType;
  wooParentId: number | null;
  sku: string;
  name: string;
  manageStock: boolean;
  stockQuantity: number | null;
  stockStatus: string | null;
}

export type UnmappedReason = "missing-sku" | "no-erp-match" | "duplicate-sku";

export interface UnmappedSiteProduct {
  wooId: number;
  wooType: WooProductType;
  sku: string;
  name: string;
  reason: UnmappedReason;
}

export interface CatalogueRefreshResult {
  channelId: number;
  channelName: string;
  /** Products + variations read from the shop. */
  siteEntries: number;
  /** Entries that now point at an ERP product. */
  linked: number;
  created: number;
  updated: number;
  /** Existing links whose site product disappeared (deleted, or its SKU changed). */
  dropped: number;
  unmapped: UnmappedSiteProduct[];
}

function variationLabel(parent: WooProduct, optionNames: string[]): string {
  const suffix = optionNames.filter(Boolean).join(" / ");
  return suffix ? `${parent.name ?? `#${parent.id}`} - ${suffix}` : `${parent.name ?? `#${parent.id}`} (variation)`;
}

/** One entry per sellable object: simple products and each variation of a variable product. */
async function readCatalogue(client: WooCommerceClient): Promise<CatalogueEntry[]> {
  const siteProducts = await client.listProducts();
  const entries: CatalogueEntry[] = [];

  for (const product of siteProducts) {
    const type = (product.type ?? "simple").toLowerCase();

    if (type === "variable") {
      const variations = await client.listVariations(product.id);
      for (const variation of variations) {
        const optionNames = (variation.attributes ?? []).map((attribute) => attribute.option ?? "");
        entries.push({
          wooId: variation.id,
          wooType: "variation",
          wooParentId: product.id,
          sku: normaliseSku(variation.sku),
          name: variationLabel(product, optionNames),
          manageStock: variation.manage_stock === true,
          stockQuantity:
            typeof variation.stock_quantity === "number" ? variation.stock_quantity : null,
          stockStatus: variation.stock_status ?? null,
        });
      }
      continue;
    }

    // Grouped and external products have no stock of their own; they are not syncable.
    if (type !== "simple" && type !== "variation") continue;

    entries.push({
      wooId: product.id,
      wooType: "simple",
      wooParentId: null,
      sku: normaliseSku(product.sku),
      name: product.name ?? `#${product.id}`,
      manageStock: product.manage_stock === true,
      stockQuantity: typeof product.stock_quantity === "number" ? product.stock_quantity : null,
      stockStatus: product.stock_status ?? null,
    });
  }

  return entries;
}

/**
 * Read the shop's catalogue and rebuild this channel's SKU mapping.
 *
 * Nothing is written outside the single transaction that replaces the links, so a run that dies
 * halfway leaves the previous mapping intact and the next refresh simply tries again.
 */
export async function refreshChannelCatalogue(
  channelId: number,
): Promise<CatalogueRefreshResult> {
  const channel = await requireChannel(channelId);
  const client = new WooCommerceClient({
    baseUrl: channel.baseUrl,
    ...resolveChannelCredentials(channel),
  });

  const entries = await readCatalogue(client);

  // The ERP side of the match. SKUs are unique in `products`, so one row per key.
  const erpProducts = await db.select({ id: products.id, sku: products.sku }).from(products);
  const byExact = new Map<string, number>();
  const byLowerCase = new Map<string, number>();
  for (const product of erpProducts) {
    const sku = normaliseSku(product.sku);
    if (!sku) continue;
    byExact.set(sku, product.id);
    const lower = sku.toLowerCase();
    if (!byLowerCase.has(lower)) byLowerCase.set(lower, product.id);
  }

  const unmapped: UnmappedSiteProduct[] = [];
  const matched: Array<CatalogueEntry & { productId: number; matchedBy: string }> = [];
  const claimed = new Set<number>();

  for (const entry of entries) {
    if (!entry.sku) {
      unmapped.push({
        wooId: entry.wooId,
        wooType: entry.wooType,
        sku: "",
        name: entry.name,
        reason: "missing-sku",
      });
      continue;
    }

    // Exact first, then case-insensitive: a shop that was imported with lower-case SKUs should
    // still link, but an exact match must always win.
    let productId = byExact.get(entry.sku);
    let matchedBy = "sku";
    if (productId === undefined) {
      productId = byLowerCase.get(entry.sku.toLowerCase());
      matchedBy = "sku-case-insensitive";
    }

    if (productId === undefined) {
      unmapped.push({
        wooId: entry.wooId,
        wooType: entry.wooType,
        sku: entry.sku,
        name: entry.name,
        reason: "no-erp-match",
      });
      continue;
    }

    if (claimed.has(productId)) {
      unmapped.push({
        wooId: entry.wooId,
        wooType: entry.wooType,
        sku: entry.sku,
        name: entry.name,
        reason: "duplicate-sku",
      });
      continue;
    }

    claimed.add(productId);
    matched.push({ ...entry, productId, matchedBy });
  }

  const existing = await db
    .select()
    .from(websiteProductLinks)
    .where(eq(websiteProductLinks.channelId, channelId));
  const existingByProduct = new Map(existing.map((link) => [link.productId, link]));

  let created = 0;
  let updated = 0;
  for (const match of matched) {
    if (existingByProduct.has(match.productId)) updated += 1;
    else created += 1;
  }
  const dropped = existing.filter((link) => !claimed.has(link.productId)).length;

  await db.transaction(async (tx) => {
    await tx.delete(websiteProductLinks).where(eq(websiteProductLinks.channelId, channelId));

    // 200 rows per INSERT keeps the statement well under Postgres' parameter limit.
    for (const batch of chunk(matched, 200)) {
      await tx.insert(websiteProductLinks).values(
        batch.map((match) => ({
          channelId,
          productId: match.productId,
          wooId: match.wooId,
          wooType: match.wooType,
          wooParentId: match.wooParentId,
          sku: match.sku,
          // The operator's decision to park a product survives a refresh.
          syncEnabled: existingByProduct.get(match.productId)?.syncEnabled ?? true,
          wooManageStock: match.manageStock,
          wooStockQuantity: match.stockQuantity,
          wooStockStatus: match.stockStatus,
          matchedBy: match.matchedBy,
          lastSeenAt: new Date(),
        })),
      );
    }
  });

  return {
    channelId,
    channelName: channel.name,
    siteEntries: entries.length,
    linked: matched.length,
    created,
    updated,
    dropped,
    unmapped,
  };
}

/** The links of one channel, in the shape `planStockSync` expects. */
export async function loadChannelLinks(channelId: number) {
  return db
    .select({
      productId: websiteProductLinks.productId,
      sku: websiteProductLinks.sku,
      wooId: websiteProductLinks.wooId,
      wooType: websiteProductLinks.wooType,
      wooParentId: websiteProductLinks.wooParentId,
      syncEnabled: websiteProductLinks.syncEnabled,
      wooManageStock: websiteProductLinks.wooManageStock,
      wooStockQuantity: websiteProductLinks.wooStockQuantity,
    })
    .from(websiteProductLinks)
    .where(eq(websiteProductLinks.channelId, channelId));
}
