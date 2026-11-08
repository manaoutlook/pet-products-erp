import { db } from "@db";
import { brands, categories, inventory, products, suppliers } from "@db/schema";
import { eq } from "drizzle-orm";

/**
 * Bulk delete for the master data screens, used by
 * `POST /api/{categories,brands,suppliers}/bulk-delete`.
 *
 * Every entry is checked against exactly the same rules as the single delete
 * endpoints (a category that has sub categories or products, a brand that is
 * assigned to products, a supplier that has inventory or products). Failures are
 * collected instead of aborting the batch, so one protected entry does not stop
 * the rest of the selection from being removed.
 */

export interface BulkDeleteFailure {
  id: number;
  name: string | null;
  message: string;
}

export interface BulkDeleteResult {
  deleted: number[];
  failed: BulkDeleteFailure[];
}

/** `["A"]` => `"A"`, `["A","B"]` => `"A" and "B"`, long lists are truncated. */
function quoteNames(names: string[], maxNames = 3): string {
  const quoted = names.slice(0, maxNames).map((name) => `"${name}"`);
  const remaining = names.length - quoted.length;
  if (quoted.length === 0) return "";
  if (quoted.length === 1) return quoted[0];
  const list = `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
  return remaining > 0 ? `${list} and ${remaining} more` : list;
}

const plural = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? "" : "s"}`;

export async function bulkDeleteCategories(ids: number[]): Promise<BulkDeleteResult> {
  const deleted: number[] = [];
  const failed: BulkDeleteFailure[] = [];

  // De-duplicate so a repeated id cannot be counted (or deleted) twice.
  for (const id of Array.from(new Set(ids))) {
    try {
      const category = await db.query.categories.findFirst({
        where: eq(categories.id, id),
        columns: { id: true, name: true },
      });

      if (!category) {
        failed.push({ id, name: null, message: "Category not found" });
        continue;
      }

      const subCategories = await db.query.categories.findMany({
        where: eq(categories.parentId, id),
        columns: { name: true },
        orderBy: [categories.name],
      });

      if (subCategories.length > 0) {
        failed.push({
          id,
          name: category.name,
          message: `Has ${plural(subCategories.length, "sub category")} (${quoteNames(
            subCategories.map((sub) => sub.name)
          )}) - delete or move them first`,
        });
        continue;
      }

      const linkedProducts = await db.query.products.findMany({
        where: eq(products.categoryId, id),
        columns: { name: true },
        orderBy: [products.name],
      });

      if (linkedProducts.length > 0) {
        failed.push({
          id,
          name: category.name,
          message: `Assigned to ${plural(linkedProducts.length, "product")} (${quoteNames(
            linkedProducts.map((product) => product.name)
          )}) - remove the product association first`,
        });
        continue;
      }

      await db.delete(categories).where(eq(categories.id, id));
      deleted.push(id);
    } catch (error) {
      console.error(`Error deleting category ${id}:`, error);
      failed.push({ id, name: null, message: "Failed to delete category" });
    }
  }

  return { deleted, failed };
}

export async function bulkDeleteBrands(ids: number[]): Promise<BulkDeleteResult> {
  const deleted: number[] = [];
  const failed: BulkDeleteFailure[] = [];

  for (const id of Array.from(new Set(ids))) {
    try {
      const brand = await db.query.brands.findFirst({
        where: eq(brands.id, id),
        columns: { id: true, name: true },
      });

      if (!brand) {
        failed.push({ id, name: null, message: "Brand not found" });
        continue;
      }

      const linkedProducts = await db.query.products.findMany({
        where: eq(products.brandId, id),
        columns: { name: true },
        orderBy: [products.name],
      });

      if (linkedProducts.length > 0) {
        failed.push({
          id,
          name: brand.name,
          message: `Assigned to ${plural(linkedProducts.length, "product")} (${quoteNames(
            linkedProducts.map((product) => product.name)
          )}) - remove the product association first`,
        });
        continue;
      }

      await db.delete(brands).where(eq(brands.id, id));
      deleted.push(id);
    } catch (error) {
      console.error(`Error deleting brand ${id}:`, error);
      failed.push({ id, name: null, message: "Failed to delete brand" });
    }
  }

  return { deleted, failed };
}

export async function bulkDeleteSuppliers(ids: number[]): Promise<BulkDeleteResult> {
  const deleted: number[] = [];
  const failed: BulkDeleteFailure[] = [];

  for (const id of Array.from(new Set(ids))) {
    try {
      const supplier = await db.query.suppliers.findFirst({
        where: eq(suppliers.id, id),
        columns: { id: true, name: true },
      });

      if (!supplier) {
        failed.push({ id, name: null, message: "Supplier not found" });
        continue;
      }

      const inventoryRows = await db.query.inventory.findMany({
        where: eq(inventory.supplierId, id),
        columns: { id: true },
      });

      if (inventoryRows.length > 0) {
        failed.push({
          id,
          name: supplier.name,
          message: `Has ${plural(inventoryRows.length, "inventory record")} - remove the inventory first`,
        });
        continue;
      }

      // Products keep a (non cascading) reference to their supplier, so the
      // deletion would fail at the database level without this check.
      const linkedProducts = await db.query.products.findMany({
        where: eq(products.supplierId, id),
        columns: { name: true },
        orderBy: [products.name],
      });

      if (linkedProducts.length > 0) {
        failed.push({
          id,
          name: supplier.name,
          message: `Assigned to ${plural(linkedProducts.length, "product")} (${quoteNames(
            linkedProducts.map((product) => product.name)
          )}) - assign another supplier first`,
        });
        continue;
      }

      await db.delete(suppliers).where(eq(suppliers.id, id));
      deleted.push(id);
    } catch (error) {
      console.error(`Error deleting supplier ${id}:`, error);
      failed.push({ id, name: null, message: "Failed to delete supplier" });
    }
  }

  return { deleted, failed };
}
