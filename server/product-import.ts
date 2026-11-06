import { db } from "@db";
import { products, categories, brands, suppliers } from "@db/schema";
import { eq } from "drizzle-orm";

/**
 * Bulk product import used by `POST /api/products/import` (Products page).
 *
 * The client parses the CSV/Excel file and posts an array of row objects whose
 * keys are the canonical import fields (`name`, `sku`, `category`, `supplier`,
 * `brand`, `landingPrice`, `b2bPrice`, `b2cPrice`, `minStock`, `description`).
 * Everything is re-validated here, because the browser is not a trust boundary.
 */

export interface ImportOptions {
  /** Update products that already exist (matched by SKU). Default: true */
  updateExisting?: boolean;
  /** Create categories/brands/suppliers that are not in the database yet. Default: true */
  createMissing?: boolean;
}

export interface ImportRowError {
  /** 1-based row number in the uploaded file (header = row 1) */
  row: number;
  sku?: string;
  name?: string;
  message: string;
}

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportRowError[];
  createdCategories: number;
  createdBrands: number;
  createdSuppliers: number;
}

/** A row as posted by the client - values are whatever the spreadsheet cell held. */
export type ImportRow = Record<string, unknown>;

const isBlank = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "");

const toText = (value: unknown): string =>
  isBlank(value) ? "" : String(value).trim();

/**
 * Parses a money cell coming from a CSV/Excel file.
 *
 * Spreadsheets store prices either as real numbers or as locale formatted text
 * (`32.000 d`, `$20,00`, `1.234,56`, `0,37`), so the separators are resolved by
 * looking at the right-most one:
 *  - `32.000`   -> 32000     (dot followed by exactly 3 digits = thousands)
 *  - `0,37`     -> 0.37      (comma followed by 2 digits = decimals)
 *  - `1,234.56` -> 1234.56   (both present, right-most = decimal separator)
 *  - `$20,00`   -> 20
 *
 * Returns `null` for an empty cell and `"invalid"` when nothing numeric is left.
 */
export function parseImportPrice(value: unknown): number | null | "invalid" {
  if (isBlank(value)) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : "invalid";
  }

  // Keep digits, separators and a leading minus; drop currency symbols,
  // currency codes, spaces and any other decoration.
  const cleaned = String(value).replace(/[^\d.,-]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return "invalid";

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma > -1 && lastDot > -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandSeparator = decimalSeparator === "," ? "." : ",";
    normalized = cleaned.split(thousandSeparator).join("");
    if (decimalSeparator === ",") normalized = normalized.replace(",", ".");
  } else if (lastComma > -1) {
    const decimals = cleaned.length - lastComma - 1;
    normalized =
      decimals > 0 && decimals <= 2
        ? cleaned.replace(",", ".")
        : cleaned.split(",").join("");
  } else if (lastDot > -1) {
    const decimals = cleaned.length - lastDot - 1;
    normalized =
      decimals > 0 && decimals <= 2 ? cleaned : cleaned.split(".").join("");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : "invalid";
}

/** Parses an integer cell (minimum stock). Empty cells fall back to `fallback`. */
export function parseImportInteger(
  value: unknown,
  fallback: number
): number | "invalid" {
  if (isBlank(value)) return fallback;

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : "invalid";
  }

  const cleaned = String(value).replace(/[^\d-]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return "invalid";

  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : "invalid";
}

/** Decimal columns are stored as strings; null means "not set". */
const toDecimalOrNull = (value: number | null | undefined) =>
  value === undefined || value === null ? null : String(value);

const lower = (value: string) => value.trim().toLowerCase();

export async function importProducts(
  rows: ImportRow[],
  options: ImportOptions = {}
): Promise<ImportResult> {
  const updateExisting = options.updateExisting ?? true;
  const createMissing = options.createMissing ?? true;

  const result: ImportResult = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    createdCategories: 0,
    createdBrands: 0,
    createdSuppliers: 0,
  };

  // Pre-load the lookup tables so a 1000 row file does not fire 1000 queries.
  const categoryIds = new Map<string, number>();
  const brandIds = new Map<string, number>();
  const supplierIds = new Map<string, number>();
  const productIdsBySku = new Map<string, number>();

  for (const category of await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)) {
    categoryIds.set(lower(category.name), category.id);
  }
  for (const brand of await db.select({ id: brands.id, name: brands.name }).from(brands)) {
    brandIds.set(lower(brand.name), brand.id);
  }
  for (const supplier of await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)) {
    supplierIds.set(lower(supplier.name), supplier.id);
  }
  for (const product of await db.select({ id: products.id, sku: products.sku }).from(products)) {
    productIdsBySku.set(lower(product.sku), product.id);
  }

  // Categories / brands / suppliers referenced by the file but missing from the
  // database are created once, then cached for the following rows.
  const resolveCategory = async (name: string): Promise<number> => {
    const existing = categoryIds.get(lower(name));
    if (existing) return existing;

    const [created] = await db
      .insert(categories)
      .values({ name: name.trim() })
      .returning({ id: categories.id });

    categoryIds.set(lower(name), created.id);
    result.createdCategories += 1;
    return created.id;
  };

  const resolveBrand = async (name: string): Promise<number> => {
    const existing = brandIds.get(lower(name));
    if (existing) return existing;

    const [created] = await db
      .insert(brands)
      .values({ name: name.trim() })
      .returning({ id: brands.id });

    brandIds.set(lower(name), created.id);
    result.createdBrands += 1;
    return created.id;
  };

  const resolveSupplier = async (name: string): Promise<number> => {
    const existing = supplierIds.get(lower(name));
    if (existing) return existing;

    // `contact_info` / `address` are NOT NULL, so imported suppliers start empty.
    const [created] = await db
      .insert(suppliers)
      .values({ name: name.trim(), contactInfo: "", address: "" })
      .returning({ id: suppliers.id });

    supplierIds.set(lower(name), created.id);
    result.createdSuppliers += 1;
    return created.id;
  };

  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index] ?? {};
    const rowNumber = index + 2; // +1 for 0-based, +1 for the header row
    const name = toText(raw.name);
    const sku = toText(raw.sku);

    const fail = (message: string) => {
      result.errors.push({
        row: rowNumber,
        sku: sku || undefined,
        name: name || undefined,
        message,
      });
    };

    try {
      if (!name) {
        fail("Product name is required");
        continue;
      }
      if (!sku) {
        fail("SKU is required");
        continue;
      }

      // B2C (retail) price is mandatory - it is also the value the legacy
      // `price` column is derived from.
      const b2cPrice = parseImportPrice(raw.b2cPrice);
      if (b2cPrice === "invalid") {
        fail("B2C price is not a valid number");
        continue;
      }
      if (b2cPrice === null) {
        fail("B2C price is required");
        continue;
      }

      const landingPrice = parseImportPrice(raw.landingPrice);
      if (landingPrice === "invalid") {
        fail("Landing price is not a valid number");
        continue;
      }

      const b2bPrice = parseImportPrice(raw.b2bPrice);
      if (b2bPrice === "invalid") {
        fail("B2B price is not a valid number");
        continue;
      }

      const minStock = parseImportInteger(raw.minStock, 10);
      if (minStock === "invalid" || minStock < 0) {
        fail("Minimum stock must be a positive number");
        continue;
      }

      const categoryName = toText(raw.category);
      if (!categoryName) {
        fail("Category is required");
        continue;
      }
      if (!createMissing && !categoryIds.has(lower(categoryName))) {
        fail(`Category not found: ${categoryName}`);
        continue;
      }

      let categoryId: number;
      try {
        categoryId = await resolveCategory(categoryName);
      } catch {
        fail(`Could not resolve category: ${categoryName}`);
        continue;
      }

      const brandName = toText(raw.brand);
      let brandId: number | null = null;
      if (brandName) {
        if (!createMissing && !brandIds.has(lower(brandName))) {
          fail(`Brand not found: ${brandName}`);
          continue;
        }
        try {
          brandId = await resolveBrand(brandName);
        } catch {
          fail(`Could not resolve brand: ${brandName}`);
          continue;
        }
      }

      // Every product has to be traceable to a supplier - the create/edit form
      // enforces exactly the same rule, so a row without one is rejected here
      // instead of producing a product the UI can never save again.
      const supplierName = toText(raw.supplier);
      if (!supplierName) {
        fail("Supplier is required");
        continue;
      }
      if (!createMissing && !supplierIds.has(lower(supplierName))) {
        fail(`Supplier not found: ${supplierName}`);
        continue;
      }
      let supplierId: number;
      try {
        supplierId = await resolveSupplier(supplierName);
      } catch {
        fail(`Could not resolve supplier: ${supplierName}`);
        continue;
      }

      const description = toText(raw.description);
      // The legacy `price` column is NOT NULL and mirrors the retail price.
      const price = String(b2cPrice);

      const existingId = productIdsBySku.get(lower(sku));

      if (existingId) {
        if (!updateExisting) {
          result.skipped += 1;
          continue;
        }

        await db
          .update(products)
          .set({
            name,
            sku,
            description: description || null,
            price,
            landingPrice: toDecimalOrNull(landingPrice),
            b2bPrice: toDecimalOrNull(b2bPrice),
            b2cPrice: toDecimalOrNull(b2cPrice),
            categoryId,
            brandId,
            supplierId,
            minStock,
            updatedAt: new Date(),
          })
          .where(eq(products.id, existingId));

        result.updated += 1;
        continue;
      }

      const [created] = await db
        .insert(products)
        .values({
          name,
          sku,
          description: description || null,
          price,
          landingPrice: toDecimalOrNull(landingPrice),
          b2bPrice: toDecimalOrNull(b2bPrice),
          b2cPrice: toDecimalOrNull(b2cPrice),
          categoryId,
          brandId,
          supplierId,
          minStock,
        })
        .returning({ id: products.id });

      productIdsBySku.set(lower(sku), created.id);
      result.created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A duplicate SKU can only slip through when two rows of the same file
      // share it - report it instead of aborting the whole import.
      if (/duplicate key|unique constraint/i.test(message)) {
        fail(`SKU already exists: ${sku}`);
      } else {
        fail(message);
      }
    }
  }

  return result;
}
