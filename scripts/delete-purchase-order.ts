import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/index.js";
import {
  attachments,
  financeEntries,
  goodsReceipts,
  purchaseOrderActions,
  purchaseOrderItems,
  purchaseOrders,
} from "../db/schema.js";

/**
 * Hard-delete ONE purchase order and every row that hangs off it.
 *
 * This is for the case the app has no button for: an order was created by mistake and has to
 * disappear completely, so it can be raised again cleanly. Cancelling is the normal way to undo
 * an order - it keeps the audit trail and voids the Finance expense - so this script is the
 * "the row must not exist" escape hatch, not a substitute for cancel.
 *
 *   npx tsx scripts/delete-purchase-order.ts --order=PO-20261125-8140            dry run
 *   npx tsx scripts/delete-purchase-order.ts --order=PO-20261125-8140 --apply    delete
 *
 * What it removes, in one transaction:
 *   - the Finance entries posted for the order (matched by `reference = order number`) and the
 *     attachments on those entries;
 *   - the order's action log, attachments (rows and the uploaded files) and line items;
 *   - the order row itself.
 *
 * It refuses to run if the order has goods receipts: a receipt has moved stock, so deleting it
 * would leave inventory and the stock ledger lying. Reverse the receipt first.
 */

const apply = process.argv.includes("--apply");
const orderArg = process.argv.find((arg) => arg.startsWith("--order="));
const orderNumber = orderArg?.split("=")[1]?.trim();

function money(value: string): string {
  const numeric = Number(value);
  return `${(Number.isFinite(numeric) ? numeric : 0).toLocaleString("vi-VN")} ₫`;
}

async function main() {
  if (!orderNumber) {
    console.error(
      "Usage: npx tsx scripts/delete-purchase-order.ts --order=PO-YYYYMMDD-0000 [--apply]"
    );
    process.exit(1);
  }

  const [order] = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.orderNumber, orderNumber))
    .limit(1);

  if (!order) {
    console.error(`Purchase order ${orderNumber} does not exist - nothing to delete.`);
    process.exit(1);
  }

  const items = await db
    .select({ id: purchaseOrderItems.id })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, order.id));

  const actions = await db
    .select({ id: purchaseOrderActions.id, actionType: purchaseOrderActions.actionType })
    .from(purchaseOrderActions)
    .where(eq(purchaseOrderActions.purchaseOrderId, order.id));

  const receipts = await db
    .select({ id: goodsReceipts.id, receiptNumber: goodsReceipts.receiptNumber })
    .from(goodsReceipts)
    .where(eq(goodsReceipts.purchaseOrderId, order.id));

  const entries = await db
    .select({
      id: financeEntries.id,
      entryNumber: financeEntries.entryNumber,
      category: financeEntries.category,
      amount: financeEntries.amount,
      status: financeEntries.status,
    })
    .from(financeEntries)
    .where(eq(financeEntries.reference, orderNumber));

  const entryIds = entries.map((entry) => entry.id);
  const receiptIds = receipts.map((receipt) => receipt.id);

  const files = [
    ...(await db
      .select({ id: attachments.id, url: attachments.url, fileName: attachments.fileName })
      .from(attachments)
      .where(and(eq(attachments.entityType, "purchase_order"), eq(attachments.entityId, order.id)))),
    ...(entryIds.length
      ? await db
          .select({ id: attachments.id, url: attachments.url, fileName: attachments.fileName })
          .from(attachments)
          .where(
            and(
              eq(attachments.entityType, "finance_entry"),
              inArray(attachments.entityId, entryIds)
            )
          )
      : []),
    ...(receiptIds.length
      ? await db
          .select({ id: attachments.id, url: attachments.url, fileName: attachments.fileName })
          .from(attachments)
          .where(
            and(
              eq(attachments.entityType, "goods_receipt"),
              inArray(attachments.entityId, receiptIds)
            )
          )
      : []),
  ];

  console.log(`Purchase order ${orderNumber} (id ${order.id})`);
  console.log(`  status      ${order.status}`);
  console.log(`  total       ${money(order.totalAmount)}`);
  console.log(`  line items  ${items.length}`);
  console.log(
    `  actions     ${actions.length}${
      actions.length ? ` (${actions.map((action) => action.actionType).join(", ")})` : ""
    }`
  );
  console.log(
    `  receipts    ${receipts.length}${
      receipts.length ? ` (${receipts.map((receipt) => receipt.receiptNumber).join(", ")})` : ""
    }`
  );
  console.log(
    `  attachments ${files.length}${files.length ? ` (${files.map((file) => file.fileName).join(", ")})` : ""}`
  );
  for (const entry of entries) {
    console.log(
      `  finance     ${entry.entryNumber}  ${entry.category}  ${money(entry.amount)}  (${entry.status})`
    );
  }

  if (receipts.length > 0) {
    console.error(
      "\nThis order has goods receipts, i.e. stock was booked in against it. Deleting it would\n" +
        "leave inventory and the stock ledger wrong, so this script refuses. Reverse the receipt\n" +
        "(Stock Adjustments) and run this again."
    );
    process.exit(1);
  }

  if (!apply) {
    console.log("\nDry run - nothing changed. Re-run with --apply to delete the order and its rows.");
    return;
  }

  await db.transaction(async (tx) => {
    if (entryIds.length) {
      await tx
        .delete(attachments)
        .where(
          and(eq(attachments.entityType, "finance_entry"), inArray(attachments.entityId, entryIds))
        );
      await tx.delete(financeEntries).where(inArray(financeEntries.id, entryIds));
    }

    await tx
      .delete(attachments)
      .where(and(eq(attachments.entityType, "purchase_order"), eq(attachments.entityId, order.id)));

    await tx.delete(purchaseOrderActions).where(eq(purchaseOrderActions.purchaseOrderId, order.id));
    await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, order.id));
    await tx.delete(purchaseOrders).where(eq(purchaseOrders.id, order.id));
  });

  // The rows are gone; the uploaded files would otherwise sit on disk as orphans.
  for (const file of files) {
    const relative = file.url.replace(/^\/+/, "");
    try {
      await unlink(path.join(process.cwd(), relative));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`  could not delete ${relative}: ${(error as Error).message}`);
      }
    }
  }

  console.log(
    `\nDeleted ${orderNumber}: ${items.length} line item(s), ${actions.length} action(s), ` +
      `${entries.length} finance entr${entries.length === 1 ? "y" : "ies"}, ${files.length} file(s).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Delete failed:", error);
    process.exit(1);
  });
