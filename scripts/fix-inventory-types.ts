/**
 * One-off repair for `inventory.inventoryType` rows that disagree with their store's type.
 *
 * Run with no arguments to see what would change (dry run, the default):
 *
 *   npx tsx scripts/fix-inventory-types.ts
 *
 * Then apply:
 *
 *   npx tsx scripts/fix-inventory-types.ts --apply
 *
 * AI Agent Note - only the `inventoryType` column is touched. Barcodes keep their original
 * prefix (a corrected DC row may still start with `ST`); barcodes are printed, scanned and
 * referenced by documents, so rewriting them is not a safe side effect of a type fix.
 *
 * Why the rows are wrong: transfers into a WAREHOUSE used to be written as `STORE`, so the
 * Inventory screen and its export called a distribution centre a "Retail Store". New rows are
 * fixed at the source (server/inventory-type.ts); this repairs what is already in the table.
 */
import 'dotenv/config';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { inventory, stores } from '../db/schema';
import { inventoryTypeForStore } from '../server/inventory-type';

const apply = process.argv.includes('--apply');

const rows = await db
  .select({
    id: inventory.id,
    productId: inventory.productId,
    storeId: inventory.storeId,
    inventoryType: inventory.inventoryType,
    barcode: inventory.barcode,
    storeName: stores.name,
    storeType: stores.type,
  })
  .from(inventory)
  .leftJoin(stores, eq(inventory.storeId, stores.id));

const wrong = rows
  .map((row) => ({ ...row, expected: inventoryTypeForStore(row.storeType) }))
  .filter((row) => row.inventoryType !== row.expected);

console.log(`${rows.length} inventory rows, ${wrong.length} with the wrong type.`);

for (const row of wrong) {
  console.log(
    ` id=${row.id} product=${row.productId} store=${row.storeName ?? 'DC'} ` +
      `storeType=${row.storeType ?? 'DC'} ${row.inventoryType} -> ${row.expected} ` +
      `(barcode ${row.barcode ?? 'none'})`
  );
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write these changes.');
} else {
  await db.transaction(async (tx) => {
    for (const row of wrong) {
      await tx.update(inventory).set({ inventoryType: row.expected }).where(eq(inventory.id, row.id));
    }
  });
  console.log(`\nUpdated ${wrong.length} row(s).`);
}

await db.$client.end();
