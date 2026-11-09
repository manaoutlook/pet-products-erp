import { db } from "@db";
import { inventory, products, stores, suppliers } from "@db/schema";
import { eq } from "drizzle-orm";
import { applyStockChange, recordOpeningStock } from "./stock-ledger";

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
  /**
   * The retained upload (`inventory_import_files.id`) this import came from. Stamped on
   * every movement so the ledger can link back to the exact file that caused the change.
   */
  importFileId?: number | null;
  /** Original upload name, stored on the movement note for a readable audit trail. */
  fileName?: string | null;
}

export interface InventoryImportRowError {
  /** 1-based row number in the uploaded file (header = row 1) */
  row: number;
  sku?: string;
  product?: string;
  message: string;
}

export type InventoryImportRowStatus = 'created' | 'updated' | 'skipped' | 'failed';

export interface InventoryImportRowResult {
  row: number;
  sku?: string;
  product?: string;
  status: InventoryImportRowStatus;
  message?: string;
  inventoryId?: number;
  quantityBefore?: number;
  quantityAfter?: number;
  quantityChange?: number;
}

export interface InventoryImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: InventoryImportRowError[];
  /** 'failed' when validation rejected the file and nothing was written. */
  status: 'completed' | 'failed';
  /** Per-row outcome, persisted on `inventory_import_files.result`. */
  rowResults: InventoryImportRowResult[];
  /** The retained upload, when the caller supplied one. */
  importFileId: number | null;
}

/** A row as posted by the client - values are whatever the spreadsheet cell held. */
export type InventoryImportRow = Record<string, unknown>;

/** A validated row, ready to be applied inside the import transaction. */
interface PlannedImportRow {
  rowNumber: number;
  sku: string;
  productName: string;
  productId: number;
  storeId: number | null;
  inventoryType: 'DC' | 'STORE';
  quantity: number;
  location: string | null;
  supplierId: number | null;
  purchaseDate: string | null;
  expiryDate: string | null;
  /** Existing inventory row this line updates, or null when it creates a new one. */
  existingId: number | null;
  /** True when the row matched an existing record but the caller asked not to update. */
  skipExisting: boolean;
}


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
/**
 * Validate a whole file, then apply it - in that order.
 *
 * AI Agent Note: validation errors used to be discovered row by row while the earlier rows
 * had already been committed, so a file with one bad SKU left the inventory half-imported
 * with no way to tell which half. The file is now fully validated first: if any row is
 * invalid, nothing is written and every problem is reported at once. Applying is a single
 * DB transaction, so each quantity change and its ledger row commit together or not at all.
 */
export async function importInventory(
  rows: InventoryImportRow[],
  options: InventoryImportOptions = {}
): Promise<InventoryImportResult> {
  const updateExisting = options.updateExisting ?? true;
  const importFileId = options.importFileId ?? null;
  const importNote = options.fileName
    ? `Imported from ${options.fileName}`
    : 'Bulk inventory import';

  const result: InventoryImportResult = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    status: 'completed',
    rowResults: [],
    importFileId,
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
  // updates the stock record instead of creating a duplicate.
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



  // ---- Phase 1: validate every row, write nothing -------------------------------
  const planned: PlannedImportRow[] = [];
  const failedRows = new Map<number, InventoryImportRowError>();

  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index] ?? {};
    const rowNumber = index + 2; // +1 for 0-based, +1 for the header row
    const sku = toText(raw.productSku);
    const productName = toText(raw.productName);

    const fail = (message: string) => {
      failedRows.set(rowNumber, {
        row: rowNumber,
        sku: sku || undefined,
        product: productName || undefined,
        message,
      });
    };

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

    planned.push({
      rowNumber,
      sku,
      productName,
      productId,
      storeId,
      inventoryType,
      quantity,
      location: toText(raw.location) || null,
      supplierId,
      purchaseDate,
      expiryDate,
      existingId: existing?.id ?? null,
      skipExisting: Boolean(existing) && !updateExisting,
    });
  }

  if (failedRows.size > 0) {
    // The file is rejected as a whole: report every bad row, apply none of the good ones.
    result.status = 'failed';
    result.errors = Array.from(failedRows.values()).sort((a, b) => a.row - b.row);
    result.rowResults = planned.map((row) => ({
      row: row.rowNumber,
      sku: row.sku,
      product: row.productName,
      status: 'skipped' as const,
      message: 'Not applied - the file contains errors',
      inventoryId: row.existingId ?? undefined,
    }));
    for (const error of result.errors) {
      result.rowResults.push({ ...error, status: 'failed' });
    }
    result.rowResults.sort((a, b) => a.row - b.row);
    // `skipped` counts the valid rows that were held back, not the failures.
    result.skipped = planned.length;
    return result;
  }

  // ---- Phase 2: apply every row in one transaction ------------------------------
  const applied = await db.transaction(async (tx) => {
    // Inventory created earlier in this same file, so two rows for the same
    // product + store + type update one row instead of creating a duplicate.
    const createdIdByKey = new Map<string, number>();
    const rowResults: InventoryImportRowResult[] = [];
    const counts = { created: 0, updated: 0, skipped: 0 };

    for (const row of planned) {
      const key = inventoryKey(row.productId, row.storeId, row.inventoryType);
      const targetId = row.existingId ?? createdIdByKey.get(key) ?? null;

      if (targetId !== null) {
        if (row.skipExisting) {
          rowResults.push({
            row: row.rowNumber,
            sku: row.sku,
            product: row.productName,
            status: 'skipped',
            message: 'Inventory already exists and updateExisting was false',
            inventoryId: targetId,
          });
          counts.skipped += 1;
          continue;
        }

        const current = await tx.query.inventory.findFirst({
          where: eq(inventory.id, targetId),
          columns: { id: true, quantity: true },
        });

        if (!current) {
          throw new Error(
            `Row ${row.rowNumber}: inventory ${targetId} disappeared while importing`
          );
        }

        // Only overwrite the optional columns when the file actually supplies a value,
        // so re-importing a quantity sheet never clears existing details. `quantity` is
        // deliberately absent: it moves through the ledger, not through an UPDATE.
        const values: Record<string, unknown> = { updatedAt: new Date() };
        if (row.location !== null) values.location = row.location;
        if (row.supplierId !== null) values.supplierId = row.supplierId;
        if (row.purchaseDate !== null) values.purchaseDate = row.purchaseDate;
        if (row.expiryDate !== null) values.expiryDate = row.expiryDate;

        if (Object.keys(values).length > 1) {
          await tx.update(inventory).set(values).where(eq(inventory.id, current.id));
        }

        const delta = row.quantity - current.quantity;
        let quantityAfter = current.quantity;

        if (delta !== 0) {
          // An import states the new quantity; the ledger needs the difference. Writing
          // it as an increment keeps a concurrent sale from being overwritten.
          quantityAfter = await applyStockChange(tx, {
            inventoryId: current.id,
            delta,
            reason: 'adjustment',
            transactionType: 'BULK_IMPORT',
            productId: row.productId,
            storeId: row.storeId,
            refType: 'inventory_import',
            refId: importFileId,
            importFileId,
            userId: options.userId ?? null,
            note: importNote,
            requireSufficientStock: true,
          });
        }

        rowResults.push({
          row: row.rowNumber,
          sku: row.sku,
          product: row.productName,
          status: 'updated',
          inventoryId: current.id,
          quantityBefore: current.quantity,
          quantityAfter,
          quantityChange: delta,
        });
        counts.updated += 1;
        continue;
      }

      const barcode = generateInventoryBarcode(row.inventoryType, row.sku, row.storeId);
      const [created] = await tx
        .insert(inventory)
        .values({
          productId: row.productId,
          storeId: row.storeId,
          supplierId: row.supplierId,
          quantity: row.quantity,
          location: row.location,
          inventoryType: row.inventoryType,
          barcode,
          purchaseDate: row.purchaseDate,
          expiryDate: row.expiryDate,
        })
        .returning({ id: inventory.id, quantity: inventory.quantity });

      // A new row starts at its imported quantity; recording it as the opening balance
      // keeps sum(movements) equal to inventory.quantity.
      await recordOpeningStock(tx, {
        inventoryId: created.id,
        quantity: created.quantity,
        reason: 'adjustment',
        transactionType: 'BULK_IMPORT',
        productId: row.productId,
        storeId: row.storeId,
        refType: 'inventory_import',
        refId: importFileId,
        importFileId,
        userId: options.userId ?? null,
        note: importNote,
      });

      createdIdByKey.set(key, created.id);
      rowResults.push({
        row: row.rowNumber,
        sku: row.sku,
        product: row.productName,
        status: 'created',
        inventoryId: created.id,
        quantityBefore: 0,
        quantityAfter: created.quantity,
        quantityChange: created.quantity,
      });
      counts.created += 1;
    }

    return { counts, rowResults };
  });

  result.created = applied.counts.created;
  result.updated = applied.counts.updated;
  result.skipped = applied.counts.skipped;
  result.rowResults = applied.rowResults.sort((a, b) => a.row - b.row);

  return result;
}

