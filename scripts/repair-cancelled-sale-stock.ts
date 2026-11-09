import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { salesTransactions, stockMovements } from "../db/schema.js";
import { applyStockChange } from "../server/stock-ledger.js";

/**
 * Repair stock that a cancelled receipt never gave back.
 *
 * Before commit 30a8ff52 ("make POS sale, refund and cancel atomic") the cancel handler
 * only flipped `sales_transactions.status` to 'cancelled' and logged an action row - it
 * never touched `inventory.quantity`. Any receipt cancelled with that code is therefore
 * permanently short by its item quantities, and because the ledger backfill later recorded
 * the (already wrong) quantity as an opening balance, `npm run stock:reconcile` reports
 * "balanced" and cannot catch it.
 *
 * This script finds those receipts - status 'cancelled' with no `cancel` movement pointing
 * at them - and puts the units back through `applyStockChange`, so the correction lands in
 * `stock_movements` as a normal cancel entry instead of being a silent psql edit.
 *
 *   npx tsx scripts/repair-cancelled-sale-stock.ts                 dry run, all cancelled receipts
 *   npx tsx scripts/repair-cancelled-sale-stock.ts --transaction 4 dry run, one receipt
 *   npx tsx scripts/repair-cancelled-sale-stock.ts --apply         write the movements
 *
 * Idempotent: a receipt that already has a `cancel` movement is skipped, so running it
 * twice is safe.
 */

const args = process.argv.slice(2);
const apply = args.includes("--apply");

const transactionFlag = args.indexOf("--transaction");
const onlyTransactionId = transactionFlag >= 0 ? Number(args[transactionFlag + 1]) : null;

if (transactionFlag >= 0 && !Number.isInteger(onlyTransactionId)) {
  console.error("--transaction needs a numeric receipt id, e.g. --transaction 4");
  process.exit(1);
}

interface RestoreLine {
  inventoryId: number;
  productId: number | null;
  quantity: number;
}

interface ReceiptToRepair {
  transactionId: number;
  invoiceNumber: string;
  transactionDate: Date | null;
  storeId: number | null;
  lines: RestoreLine[];
}

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 19).replace("T", " ") : "-";
}

async function findReceiptsMissingCancelMovements(): Promise<{
  repaired: ReceiptToRepair[];
  alreadyDone: number;
}> {
  const cancelled = await db.query.salesTransactions.findMany({
    where: onlyTransactionId
      ? and(
          eq(salesTransactions.status, "cancelled"),
          eq(salesTransactions.id, onlyTransactionId),
        )
      : eq(salesTransactions.status, "cancelled"),
    with: { items: true },
    orderBy: [salesTransactions.id],
  });

  const repaired: ReceiptToRepair[] = [];
  let alreadyDone = 0;

  for (const transaction of cancelled) {
    // A `cancel` movement pointing at this receipt is the proof the units came back.
    // Refunds count too: a receipt cancelled and refunded already returned stock through
    // the refund reason, so it must not be credited twice.
    const existing = await db
      .select({ id: stockMovements.id, reason: stockMovements.reason })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.refType, "sales_transaction"),
          eq(stockMovements.refId, transaction.id),
        ),
      );

    const alreadyReturned = existing.some(
      (row) => row.reason === "cancel" || row.reason === "refund",
    );
    if (alreadyReturned) {
      alreadyDone += 1;
      continue;
    }

    // One line per inventory row: the same product can appear twice on a receipt.
    const lines = new Map<number, RestoreLine>();
    for (const item of transaction.items) {
      const current = lines.get(item.inventoryId);
      lines.set(item.inventoryId, {
        inventoryId: item.inventoryId,
        productId: current?.productId ?? item.productId ?? null,
        quantity: (current?.quantity ?? 0) + item.quantity,
      });
    }

    if (lines.size === 0) continue;

    repaired.push({
      transactionId: transaction.id,
      invoiceNumber: transaction.invoiceNumber,
      transactionDate: transaction.transactionDate ?? null,
      storeId: transaction.storeId ?? null,
      lines: Array.from(lines.values()),
    });
  }

  return { repaired, alreadyDone };
}

async function repair() {
  const { repaired, alreadyDone } = await findReceiptsMissingCancelMovements();

  console.log("Cancelled receipts with no 'cancel' stock movement");
  console.log(`Already returned to stock: ${alreadyDone} receipt(s).`);

  if (repaired.length === 0) {
    console.log("\n✅ Nothing to repair - every cancelled receipt returned its stock.");
    process.exit(0);
  }

  const totalUnits = repaired.reduce(
    (sum, receipt) => sum + receipt.lines.reduce((lineSum, line) => lineSum + line.quantity, 0),
    0,
  );

  console.log(`\n⚠️  ${repaired.length} receipt(s) short by ${totalUnits} unit(s):`);
  for (const receipt of repaired) {
    console.log(
      `\n  • ${receipt.invoiceNumber} (id ${receipt.transactionId}, ` +
        `${formatDate(receipt.transactionDate)}, store ${receipt.storeId ?? "DC"})`,
    );
    for (const line of receipt.lines) {
      console.log(
        `      inventory ${line.inventoryId} (product ${line.productId ?? "-"}): +${line.quantity}`,
      );
    }
  }

  if (!apply) {
    console.log("\nDry run - nothing written. Re-run with --apply to put these units back.");
    process.exit(1);
  }

  for (const receipt of repaired) {
    // One transaction per receipt: a partial repair would leave a receipt that looks
    // returned while some of its lines are still missing.
    await db.transaction(async (tx) => {
      for (const line of receipt.lines) {
        await applyStockChange(tx, {
          inventoryId: line.inventoryId,
          delta: line.quantity,
          reason: "cancel",
          productId: line.productId,
          storeId: receipt.storeId,
          refType: "sales_transaction",
          refId: receipt.transactionId,
          userId: null,
          note:
            `Repair: receipt ${receipt.invoiceNumber} was cancelled before the ` +
            `cancel-restores-stock fix (30a8ff52), so its units were never returned`,
        });
      }
    });
    console.log(`  ✅ ${receipt.invoiceNumber}: ${receipt.lines.length} inventory row(s) restored.`);
  }

  console.log(
    `\n✅ Repaired ${repaired.length} receipt(s). Run "npm run stock:reconcile" to confirm the ledger.`,
  );
  process.exit(0);
}

repair().catch((error) => {
  console.error("Repair failed:", error);
  process.exit(1);
});
