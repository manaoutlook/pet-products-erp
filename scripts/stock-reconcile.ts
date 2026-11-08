import "dotenv/config";
import { db } from "../db/index.js";
import { sql } from "drizzle-orm";
import { recordStockMovement } from "../server/stock-ledger.js";

/**
 * Stock ledger reconciliation.
 *
 * `inventory.quantity` is a cached running total; `stock_movements` is the append-only
 * history of how it got there. They agree unless something wrote a quantity without
 * recording a movement (a bug, a manual psql fix, or rows created before the ledger
 * existed). This script is the check that makes that detectable.
 *
 *   npx tsx scripts/stock-reconcile.ts              report only, exit 1 on drift
 *   npx tsx scripts/stock-reconcile.ts --backfill   also open a ledger row for
 *                                                   inventory that has no history yet
 *
 * Rows that already have history but disagree are NOT auto-corrected: the script cannot
 * know whether the cache or the ledger is right, so it reports them for a human.
 */

interface ReconcileRow {
  id: number;
  product_id: number | null;
  store_id: number | null;
  quantity: number;
  ledger_quantity: number;
  movement_count: number;
}

const backfill = process.argv.includes("--backfill");

async function reconcile() {
  const rows = (await db.execute(sql`
    SELECT
      i.id,
      i.product_id,
      i.store_id,
      i.quantity,
      COALESCE(SUM(m.delta), 0)::int AS ledger_quantity,
      COUNT(m.id)::int AS movement_count
    FROM inventory i
    LEFT JOIN stock_movements m ON m.inventory_id = i.id
    GROUP BY i.id, i.product_id, i.store_id, i.quantity
    ORDER BY i.id
  `)) as unknown as ReconcileRow[];

  const unledgered = rows.filter((row) => row.movement_count === 0);
  const drifted = rows.filter(
    (row) => row.movement_count > 0 && row.ledger_quantity !== row.quantity,
  );

  console.log(`Checked ${rows.length} inventory row(s).`);

  if (unledgered.length > 0) {
    console.log(`\n⚠️  ${unledgered.length} row(s) have no ledger history yet:`);
    for (const row of unledgered.slice(0, 20)) {
      console.log(
        `  • inventory ${row.id} (product ${row.product_id ?? "-"}, store ${row.store_id ?? "-"}): quantity ${row.quantity}`,
      );
    }
    if (unledgered.length > 20) console.log(`  … and ${unledgered.length - 20} more`);

    if (backfill) {
      // An opening balance is the only honest entry: we know the quantity the row holds
      // today, not how it got there.
      await db.transaction(async (tx) => {
        for (const row of unledgered) {
          await recordStockMovement(tx, {
            inventoryId: row.id,
            delta: row.quantity,
            reason: "adjustment",
            productId: row.product_id,
            storeId: row.store_id,
            quantityAfter: row.quantity,
            refType: "backfill",
            refId: null,
            userId: null,
          });
        }
      });
      console.log(`✅ Wrote opening balances for ${unledgered.length} row(s).`);
    } else {
      console.log("   Re-run with --backfill to open a ledger row for each of them.");
    }
  }

  if (drifted.length > 0) {
    console.log(`\n❌ ${drifted.length} row(s) disagree with the ledger:`);
    for (const row of drifted) {
      const difference = row.quantity - row.ledger_quantity;
      console.log(
        `  • inventory ${row.id}: quantity ${row.quantity}, ledger ${row.ledger_quantity} (off by ${difference > 0 ? "+" : ""}${difference})`,
      );
    }
    console.log(
      "\n   Investigate the movements for these rows before editing anything by hand:",
    );
    console.log(
      "   SELECT * FROM stock_movements WHERE inventory_id = <id> ORDER BY created_at;",
    );
  }

  if (drifted.length === 0 && (unledgered.length === 0 || backfill)) {
    console.log("\n✅ Ledger matches inventory.");
    process.exit(0);
  }

  process.exit(1);
}

reconcile().catch((error) => {
  console.error("Reconciliation failed:", error);
  process.exit(1);
});
