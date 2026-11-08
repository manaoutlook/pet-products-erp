import { db } from "@db";
import { inventory, products, stores, suppliers } from "@db/schema";
import { eq } from "drizzle-orm";
import { recordOpeningStock, recordStockMovement } from "./stock-ledger";

/**
 * Bulk inventory import used by `POST /api/inventory/import` (Inventory page).
 *
 * The client parses the CSV/Excel file and posts an array of row objects whose
 * keys are the canonical import fields (`productSku`, `productName`,
 * `inventoryType`, `store`, `supplier`, `quantity`, `location`, `purchaseDate`,
 * `expiryDate`). Everything is re-validated here, because the browser is not a
 * trust boundary.
 *
 * Rows are matched to existing inventory by product + store + type, so a row
 * updates an existing stock record (its quantity) instead of duplicating it.
 */

export interface InventoryImportOptions {
  /** Update inventory that already exists (product + store + type). Default: true */
  updateExisting?: boolean;
  /** Who ran the import - stamped on the stock ledger rows it produces. */
  userId?: number | null;
}

export interface InventoryImportRowError {
  /** 1-based row number in the uploaded file (header = row 1) */
  row: number;
  sku?: string;
  product?: string;
  message: string;
}

export interface InventoryImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: InventoryImportRowError[];
}

/** A row as posted by the client - values are whatever the spreadsheet cell held. */
export type InventoryImportRow = Record<string, unknown>;

const isBlank = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "");

const toText = (value: unknown): string => (isBlank(value) ? "" : String(value).trim());

const lower = (value: string) => value.trim().toLowerCase();

/** Parses an integer cell (quantity). Blank cells return "invalid". */
export function parseImportInteger(value: unknown): number | "invalid" {
  if (isBlank(value)) return "invalid";

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : "invalid";
  }

  const cleaned = String(value).replace(/[^\d-]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return "invalid";

  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : "invalid";
}

/**
 * Normalizes an inventory-type cell to the two values the schema stores.
 * Accepts the dropdown labels ("Distribution Center", "Retail Store") as well
 * as the raw codes and common synonyms.
 */
export function normalizeInventoryType(value: unknown): "DC" | "STORE" | null {
  const text = toText(value).toLowerCase().replace(/[^a-z]/g, "");
  if (!text) return null;

  const dcAliases = ["dc", "distributioncenter", "warehouse", "warehousedc", "dcwarehouse", "center", "depot"];
  const storeAliases = ["store", "retail", "retailstore", "shop", "outlet"];

  if (dcAliases.includes(text)) return "DC";
  if (storeAliases.includes(text)) return "STORE";
  return null;
}

/**
 * Parses a date cell into a `YYYY-MM-DD` string (the format the `date` columns
 * expect). Handles real date cells, Excel serial numbers and common
 * `yyyy-mm-dd` / `dd/mm/yyyy` text formats. Blank cells return null.
 */
export function parseImportDate(value: unknown): string | null | "invalid" {
  if (isBlank(value)) return null;

  const toIso = (date: Date): string | "invalid" =>
    Number.isNaN(date.getTime()) ? "invalid" : date.toISOString().slice(0, 10);

  if (value instanceof Date) return toIso(value);

  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date (days since 1899-12-30).
    const ms = Math.round((value - 25569) * 86400 * 1000);
    return toIso(new Date(ms));
  }

  const text = String(value).trim();

  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return toIso(new Date(Number(y), Number(m) - 1, Number(d)));
  }

  const dayFirst = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dayFirst) {
    const [, d, m, y] = dayFirst;
    return toIso(new Date(Number(y), Number(m) - 1, Number(d)));
  }

  const parsed = new Date(text);
  return toIso(parsed);
}

/** Mirrors `generateInventoryBarcode` in routes.ts so imports get real barcodes. */
function generateInventoryBarcode(
  inventoryType: "DC" | "STORE",
  productSku: string,
  storeId?: number | null
): string {
  const prefix = inventoryType === "DC" ? "DC" : "ST";
  const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  const storePrefix = storeId ? storeId.toString().padStart(3, "0") : "000";
  return `${prefix}${storePrefix}${productSku}${randomNum}`;
}

const inventoryKey = (productId: number | null, storeId: number | null, type: string) =>
  `${productId ?? "null"}:${storeId ?? "null"}:${type}`;

export async function importInventory(
  rows: InventoryImportRow[],
  options: InventoryImportOptions = {}
): Promise<InventoryImportResult> {
  const updateExisting = options.updateExisting ?? true;

  const result: InventoryImportResult = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  // Pre-load the lookup tables so a 1000 row file does not fire 1000 queries.
  const productIdsBySku = new Map<string, number>();
  const storeIdsByName = new Map<string, number>();
  const supplierIdsByName = new Map<string, number>();

  for (const product of await db
    .select({ id: products.id, sku: products.sku })
    .from(products)) {
    productIdsBySku.set(lower(product.sku), product.id);
  }
  for (const store of await db.select({ id: stores.id, name: stores.name }).from(stores)) {
    storeIdsByName.set(lower(store.name), store.id);
  }
  for (const supplier of await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)) {
    supplierIdsByName.set(lower(supplier.name), supplier.id);
  }

  // Existing inventory keyed by product + store + type so a repeated import
  // updates the stock record instead of creating a duplicate. The current quantity is
  // kept alongside the id because an import sets quantity outright and the ledger needs
  // the difference.
  const existingByKey = new Map<string, { id: number; quantity: number }>();
  for (const item of await db
    .select({
      id: inventory.id,
      productId: inventory.productId,
      storeId: inventory.storeId,
      inventoryType: inventory.inventoryType,
      quantity: inventory.quantity,
    })
    .from(inventory)) {
    const key = inventoryKey(item.productId, item.storeId, item.inventoryType as string);
    if (!existingByKey.has(key)) {
      existingByKey.set(key, { id: item.id, quantity: item.quantity });
    }
  }

  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index] ?? {};
    const rowNumber = index + 2; // +1 for 0-based, +1 for the header row
    const sku = toText(raw.productSku);
    const productName = toText(raw.productName);

    const fail = (message: string) => {
      result.errors.push({
        row: rowNumber,
        sku: sku || undefined,
        product: productName || undefined,
        message,
      });
    };

    try {
      if (!sku) {
        fail("Product SKU is required");
        continue;
      }
      const productId = productIdsBySku.get(lower(sku));
      if (!productId) {
        fail(`Product not found for SKU: ${sku}`);
        continue;
      }

      const inventoryType = normalizeInventoryType(raw.inventoryType);
      if (!inventoryType) {
        fail("Inventory type must be 'DC' or 'STORE'");
        continue;
      }

      if (isBlank(raw.quantity)) {
        fail("Quantity is required");
        continue;
      }
      const quantity = parseImportInteger(raw.quantity);
      if (quantity === "invalid" || quantity < 0) {
        fail("Quantity must be a whole number of 0 or more");
        continue;
      }

      const storeName = toText(raw.store);
      let storeId: number | null = null;
      if (storeName) {
        const resolved = storeIdsByName.get(lower(storeName));
        if (!resolved) {
          fail(`Store not found: ${storeName}`);
          continue;
        }
        storeId = resolved;
      } else if (inventoryType === "STORE") {
        fail("Store is required for STORE inventory");
        continue;
      }

      const supplierName = toText(raw.supplier);
      let supplierId: number | null = null;
      if (supplierName) {
        const resolved = supplierIdsByName.get(lower(supplierName));
        if (!resolved) {
          fail(`Supplier not found: ${supplierName}`);
          continue;
        }
        supplierId = resolved;
      }

      const location = toText(raw.location) || null;

      const purchaseDate = parseImportDate(raw.purchaseDate);
      if (purchaseDate === "invalid") {
        fail("Purchase date is not a valid date");
        continue;
      }
      const expiryDate = parseImportDate(raw.expiryDate);
      if (expiryDate === "invalid") {
        fail("Expiry date is not a valid date");
        continue;
      }

      const key = inventoryKey(productId, storeId, inventoryType);
      const existing = existingByKey.get(key);

      if (existing) {
        if (!updateExisting) {
          result.skipped += 1;
          continue;
        }

        // Only overwrite the optional columns when the file actually supplies a
        // value, so re-importing a quantity sheet never clears existing details.
        const values: Record<string, unknown> = { quantity };
        if (location !== null) values.location = location;
        if (supplierId !== null) values.supplierId = supplierId;
        if (purchaseDate !== null) values.purchaseDate = purchaseDate;
        if (expiryDate !== null) values.expiryDate = expiryDate;

        await db.update(inventory).set(values).where(eq(inventory.id, existing.id));

        // An import is a bulk correction, so it is recorded as an adjustment. The sheet
        // gives the new quantity, and the ledger needs the difference to be auditable.
        await recordStockMovement(db, {
          inventoryId: existing.id,
          delta: quantity - existing.quantity,
          reason: 'adjustment',
          productId,
          storeId,
          quantityAfter: quantity,
          refType: 'inventory_import',
          refId: null,
          userId: options.userId ?? null,
        });

        existing.quantity = quantity;
        result.updated += 1;
        continue;
      }

      const barcode = generateInventoryBarcode(inventoryType, sku, storeId);
      const [created] = await db
        .insert(inventory)
        .values({
          productId,
          storeId,
          supplierId,
          quantity,
          location,
          inventoryType,
          barcode,
          purchaseDate,
          expiryDate,
        })
        .returning({ id: inventory.id });

      await recordOpeningStock(db, {
        inventoryId: created.id,
        quantity,
        reason: 'adjustment',
        productId,
        storeId,
        refType: 'inventory_import',
        refId: null,
        userId: options.userId ?? null,
      });

      existingByKey.set(key, { id: created.id, quantity });
      result.created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A duplicate barcode can only slip through on a rare random collision -
      // report it instead of aborting the whole import.
      if (/duplicate key|unique constraint/i.test(message)) {
        fail("Could not save the row (duplicate barcode); please retry");
      } else {
        fail(message);
      }
    }
  }

  return result;
}