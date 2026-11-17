import "dotenv/config";
import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

/**
 * Supplier reconciliation.
 *
 * A product has exactly one supplier (`products.supplier_id`) and that value is the
 * single source of truth. `inventory.supplier_id` is a denormalised copy used for
 * display only - it must never disagree with the product it belongs to.
 *
 *   npx tsx scripts/supplier-reconcile.ts              report only, exit 1 on drift
 *   npx tsx scripts/supplier-reconcile.ts --backfill   copy the product's supplier onto
 *                                                      every inventory row that differs
 *
 * The backfill is a single UPDATE inside a transaction, so a partial copy cannot be
 * left behind. Deleting an unreferenced placeholder supplier is a separate, deliberate
 * step - the report lists them so it is obvious which ones are safe to remove.
 */

interface MismatchRow {
  id: number;
  product_id: number;
  product_sku: string;
  store_id: number | null;
  supplier_id: number | null;
  supplier_name: string | null;
  product_supplier_id: number | null;
  product_supplier_name: string | null;
}

interface OrphanSupplierRow {
  id: number;
  name: string;
}

const backfill = process.argv.includes("--backfill");

async function reconcile() {
  const mismatches = (await db.execute(sql`
    SELECT
      i.id,
      i.product_id,
      p.sku AS product_sku,
      i.store_id,
      i.supplier_id,
      s.name AS supplier_name,
      p.supplier_id AS product_supplier_id,
      ps.name AS product_supplier_name
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    LEFT JOIN suppliers s ON s.id = i.supplier_id
    LEFT JOIN suppliers ps ON ps.id = p.supplier_id
    WHERE i.supplier_id IS DISTINCT FROM p.supplier_id
    ORDER BY i.id
  `)) as unknown as MismatchRow[];

  // A supplier nothing points at is either freshly created or leftover placeholder data.
  // Deleting one is safe only because this query proves no product, stock row or purchase
  // order references it.
  const orphans = (await db.execute(sql`
    SELECT s.id, s.name
    FROM suppliers s
    WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.supplier_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.supplier_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.supplier_id = s.id)
    ORDER BY s.id
  `)) as unknown as OrphanSupplierRow[];

  const [{ count: inventoryCount }] = (await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM inventory
  `)) as unknown as { count: number }[];

  console.log(`Checked ${inventoryCount} inventory row(s).`);

  if (mismatches.length > 0) {
    console.log(
      `\n❌ ${mismatches.length} inventory row(s) disagree with their product's supplier:`,
    );
    for (const row of mismatches.slice(0, 20)) {
      console.log(
        `  • inventory ${row.id} (${row.product_sku}, store ${row.store_id ?? "DC"}): ` +
          `${row.supplier_name ?? "none"} (${row.supplier_id ?? "null"}) → ` +
          `${row.product_supplier_name ?? "none"} (${row.product_supplier_id ?? "null"})`,
      );
    }
    if (mismatches.length > 20) {
      console.log(`  … and ${mismatches.length - 20} more`);
    }
  }

  if (backfill && mismatches.length > 0) {
    const updated = await db.transaction(async (tx) => {
      const result = (await tx.execute(sql`
        UPDATE inventory i
        SET supplier_id = p.supplier_id,
            updated_at = NOW()
        FROM products p
        WHERE p.id = i.product_id
          AND i.supplier_id IS DISTINCT FROM p.supplier_id
      `)) as unknown as { count: number };
      return result.count ?? mismatches.length;
    });
    console.log(`\n✅ Copied the product supplier onto ${updated} inventory row(s).`);
  } else if (mismatches.length > 0) {
    console.log("\n   Re-run with --backfill to copy the product supplier onto these rows.");
  }

  if (orphans.length > 0) {
    console.log(`\nℹ️  ${orphans.length} supplier(s) are not referenced anywhere:`);
    for (const supplier of orphans.slice(0, 20)) {
      console.log(`  • supplier ${supplier.id}: ${supplier.name}`);
    }
    if (orphans.length > 20) console.log(`  … and ${orphans.length - 20} more`);
    console.log("   Safe to delete if they were placeholder or duplicate records.");
  }

  if (mismatches.length === 0) {
    console.log("\n✅ Every inventory row uses its product's supplier.");
    process.exit(0);
  }

  if (backfill) {
    process.exit(0);
  }

  process.exit(1);
}

reconcile().catch((error) => {
  console.error("Supplier reconciliation failed:", error);
  process.exit(1);
});
