import { db } from "@db";
import { brands, categories, suppliers } from "@db/schema";
import { eq } from "drizzle-orm";

/**
 * Bulk CSV/Excel import for the master data screens.
 *
 * Used by `POST /api/categories/import`, `POST /api/brands/import` and
 * `POST /api/suppliers/import` (the Categories / Brands / Suppliers pages).
 *
 * The client parses the spreadsheet and posts an array of row objects whose
 * keys are the canonical import fields:
 *  - categories: `name`, `description`, `parent` (parent category name)
 *  - brands:     `name`, `description`
 *  - suppliers:  `name`, `contactInfo`, `address`
 *
 * Everything is re-validated here, because the browser is not a trust boundary.
 * Entries are matched by name (case-insensitive); an empty cell never clears a
 * value that is already stored.
 */

export interface MasterDataImportOptions {
  /** Update entries that already exist (matched by name). Default: true */
  updateExisting?: boolean;
}

export interface MasterDataImportRowError {
  /** 1-based row number in the uploaded file (header = row 1) */
  row: number;
  name?: string;
  message: string;
}

export interface MasterDataImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: MasterDataImportRowError[];
  /**
   * Categories only: parent categories created on the fly because the
   * `Parent Category` cell referenced a category that did not exist yet. They are
   * reported separately so `created` always matches the number of rows imported.
   */
  createdParents: number;
}

/** A row as posted by the client - values are whatever the spreadsheet cell held. */
export type MasterDataImportRow = Record<string, unknown>;

const isBlank = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "");

const toText = (value: unknown): string => (isBlank(value) ? "" : String(value).trim());

// Names pasted from documents/PDFs can carry Unicode whitespace variants
// (U+00A0, U+202F narrow no-break space, ...). Collapse them into plain spaces
// so uniqueness checks and lookups behave predictably.
const normalizeWhitespace = (value: string): string =>
  value
    .replace(/[\s\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u3000]+/g, " ")
    .trim();

/** Lookup key: normalised, case-insensitive name. */
const keyOf = (value: string): string => normalizeWhitespace(value).toLowerCase();

const emptyResult = (total: number): MasterDataImportResult => ({
  total,
  created: 0,
  updated: 0,
  skipped: 0,
  errors: [],
  createdParents: 0,
});

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Error && /duplicate key|unique constraint/i.test(error.message);

/**
 * Imports categories. The optional `parent` cell is matched against the
 * category names; a missing parent is created as a root category (so a file
 * that lists sub categories before their parents still imports cleanly).
 */
export async function importCategories(
  rows: MasterDataImportRow[],
  options: MasterDataImportOptions = {}
): Promise<MasterDataImportResult> {
  const updateExisting = options.updateExisting !== false;
  const result = emptyResult(rows.length);

  // Snapshot of the current categories so parent lookups do not hit the
  // database for every row. Both maps are kept in sync with the rows below.
  const existing = await db.query.categories.findMany({
    columns: { id: true, name: true, parentId: true },
  });

  const idByKey = new Map<string, number>();
  const parentById = new Map<number, number | null>();
  for (const category of existing) {
    idByKey.set(keyOf(category.name), category.id);
    parentById.set(category.id, category.parentId ?? null);
  }

  // Walks the parent chain upwards to make sure assigning `parentId` to `id`
  // cannot turn the category tree into a loop.
  const createsLoop = (id: number, parentId: number): boolean => {
    const seen = new Set<number>();
    let cursor: number | null = parentId;
    while (cursor !== null && !seen.has(cursor)) {
      if (cursor === id) return true;
      seen.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
    return false;
  };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? {};
    const rowNumber = index + 2; // header row is row 1
    const name = normalizeWhitespace(toText(row.name));
    const fail = (message: string) =>
      result.errors.push({ row: rowNumber, name: name || undefined, message });

    try {
      if (!name) {
        fail("Category name is required");
        continue;
      }

      const description = toText(row.description);
      const parentName = normalizeWhitespace(toText(row.parent));
      const existingId = idByKey.get(keyOf(name));

      if (parentName && keyOf(parentName) === keyOf(name)) {
        fail("A category cannot be its own parent");
        continue;
      }

      // Resolves - and, when needed, creates - the parent category.
      let parentId: number | null = null;
      if (parentName) {
        const knownParentId = idByKey.get(keyOf(parentName));
        if (knownParentId === undefined) {
          const [createdParent] = await db
            .insert(categories)
            .values({ name: parentName })
            .returning({ id: categories.id });
          parentId = createdParent.id;
          idByKey.set(keyOf(parentName), createdParent.id);
          parentById.set(createdParent.id, null);
          result.createdParents += 1;
        } else {
          parentId = knownParentId;
        }
      }

      if (existingId) {
        if (!updateExisting) {
          result.skipped += 1;
          continue;
        }

        if (parentId !== null && createsLoop(existingId, parentId)) {
          fail("The parent category would create a loop - pick another parent");
          continue;
        }

        await db
          .update(categories)
          .set({
            name,
            // An empty description cell leaves the stored description alone.
            ...(description ? { description } : {}),
            ...(parentId !== null ? { parentId } : {}),
            updatedAt: new Date(),
          })
          .where(eq(categories.id, existingId));

        result.updated += 1;
        continue;
      }

      const [created] = await db
        .insert(categories)
        .values({
          name,
          description: description || null,
          parentId,
        })
        .returning({ id: categories.id });

      idByKey.set(keyOf(name), created.id);
      parentById.set(created.id, parentId);
      result.created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(isUniqueViolation(error) ? `Category already exists: ${name}` : message);
    }
  }

  return result;
}

/** Imports brands - matched by name, description can be updated. */
export async function importBrands(
  rows: MasterDataImportRow[],
  options: MasterDataImportOptions = {}
): Promise<MasterDataImportResult> {
  const updateExisting = options.updateExisting !== false;
  const result = emptyResult(rows.length);

  const existing = await db.query.brands.findMany({ columns: { id: true, name: true } });
  const idByKey = new Map<string, number>();
  for (const brand of existing) idByKey.set(keyOf(brand.name), brand.id);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? {};
    const rowNumber = index + 2;
    const name = normalizeWhitespace(toText(row.name));
    const fail = (message: string) =>
      result.errors.push({ row: rowNumber, name: name || undefined, message });

    try {
      if (!name) {
        fail("Brand name is required");
        continue;
      }

      const description = toText(row.description);
      const existingId = idByKey.get(keyOf(name));

      if (existingId) {
        if (!updateExisting) {
          result.skipped += 1;
          continue;
        }

        await db
          .update(brands)
          .set({
            name,
            ...(description ? { description } : {}),
            updatedAt: new Date(),
          })
          .where(eq(brands.id, existingId));

        result.updated += 1;
        continue;
      }

      const [created] = await db
        .insert(brands)
        .values({ name, description: description || null })
        .returning({ id: brands.id });

      idByKey.set(keyOf(name), created.id);
      result.created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(isUniqueViolation(error) ? `Brand already exists: ${name}` : message);
    }
  }

  return result;
}

/**
 * Imports suppliers. `name`, `Contact Information` and `Address` are mandatory
 * columns because the database and the create form both require them.
 */
export async function importSuppliers(
  rows: MasterDataImportRow[],
  options: MasterDataImportOptions = {}
): Promise<MasterDataImportResult> {
  const updateExisting = options.updateExisting !== false;
  const result = emptyResult(rows.length);

  const existing = await db.query.suppliers.findMany({ columns: { id: true, name: true } });
  const idByKey = new Map<string, number>();
  for (const supplier of existing) idByKey.set(keyOf(supplier.name), supplier.id);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? {};
    const rowNumber = index + 2;
    const name = normalizeWhitespace(toText(row.name));
    const fail = (message: string) =>
      result.errors.push({ row: rowNumber, name: name || undefined, message });

    try {
      if (!name) {
        fail("Supplier name is required");
        continue;
      }

      const contactInfo = toText(row.contactInfo);
      const address = toText(row.address);
      const existingId = idByKey.get(keyOf(name));

      if (existingId) {
        if (!updateExisting) {
          result.skipped += 1;
          continue;
        }

        await db
          .update(suppliers)
          .set({
            name,
            // Empty cells keep the stored contact details (columns are NOT NULL).
            ...(contactInfo ? { contactInfo } : {}),
            ...(address ? { address } : {}),
            updatedAt: new Date(),
          })
          .where(eq(suppliers.id, existingId));

        result.updated += 1;
        continue;
      }

      if (!contactInfo) {
        fail("Contact information is required");
        continue;
      }
      if (!address) {
        fail("Address is required");
        continue;
      }

      const [created] = await db
        .insert(suppliers)
        .values({ name, contactInfo, address })
        .returning({ id: suppliers.id });

      idByKey.set(keyOf(name), created.id);
      result.created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(message);
    }
  }

  return result;
}
