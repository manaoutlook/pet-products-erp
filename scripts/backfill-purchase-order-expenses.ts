import "dotenv/config";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { financeEntries, purchaseOrders, roles, suppliers, users } from "../db/schema.js";
import { PURCHASE_ORDER_EXPENSE_CATEGORY } from "../shared/finance.js";
import { postPurchaseOrderExpense } from "../server/purchase-order-finance.js";
import { vietnamDayOf } from "../shared/vietnam-day.js";

/**
 * Post the missing "Supplier purchases" expense for purchase orders that were created before
 * purchase orders started posting to Finance themselves.
 *
 * Orders created by the current code already write their expense in the same transaction, so this
 * script only fills the gap for older rows - and it is safe to run more than once: an order that
 * already has a posted "Supplier purchases" entry is skipped.
 *
 *   npx tsx scripts/backfill-purchase-order-expenses.ts            dry run (prints only)
 *   npx tsx scripts/backfill-purchase-order-expenses.ts --apply    write the entries
 *   npx tsx scripts/backfill-purchase-order-expenses.ts --apply --user-id 3
 *
 * The entry is dated the Vietnamese day the order was raised, so it lands in the month the
 * purchase belongs to instead of today. Cancelled orders are skipped: cancelling voids the
 * expense, so they must not get a new one.
 */

const apply = process.argv.includes("--apply");
const userIdArg = process.argv.find((arg) => arg.startsWith("--user-id="));
const requestedUserId = userIdArg ? Number(userIdArg.split("=")[1]) : null;

function money(value: string | number): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  return `${Math.round(Number.isFinite(numeric) ? numeric : 0).toLocaleString("vi-VN")} ₫`;
}

async function resolveUserId(): Promise<number | null> {
  if (requestedUserId) return requestedUserId;

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(roles.isSystemAdmin, true))
    .limit(1);

  if (admin) return admin.id;

  const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
  return anyUser?.id ?? null;
}

async function main() {
  const userId = await resolveUserId();
  if (!userId) {
    console.error("No user exists to attribute the entries to - pass --user-id=<id>.");
    process.exit(1);
  }

  const orders = await db
    .select({
      id: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
      orderDate: purchaseOrders.orderDate,
      totalAmount: purchaseOrders.totalAmount,
      supplierName: suppliers.name,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(ne(purchaseOrders.status, "cancelled"))
    .orderBy(purchaseOrders.id);

  let created = 0;
  let skipped = 0;

  for (const order of orders) {
    const [existing] = await db
      .select({ id: financeEntries.id, entryNumber: financeEntries.entryNumber })
      .from(financeEntries)
      .where(
        and(
          eq(financeEntries.reference, order.orderNumber),
          eq(financeEntries.category, PURCHASE_ORDER_EXPENSE_CATEGORY),
          eq(financeEntries.status, "posted")
        )
      )
      .limit(1);

    if (existing) {
      skipped += 1;
      console.log(
        `skip    ${order.orderNumber}  already posted as ${existing.entryNumber}`
      );
      continue;
    }

    const entryDate = vietnamDayOf(order.orderDate);

    if (!apply) {
      console.log(
        `would post  ${order.orderNumber}  ${money(order.totalAmount)}  on ${entryDate}  (${order.supplierName})`
      );
      created += 1;
      continue;
    }

    const entry = await db.transaction((tx) =>
      postPurchaseOrderExpense(tx, {
        orderNumber: order.orderNumber,
        supplierName: order.supplierName,
        amount: order.totalAmount,
        entryDate,
        createdByUserId: userId,
      })
    );

    created += 1;
    console.log(
      `posted  ${order.orderNumber}  ${money(order.totalAmount)}  as ${entry.entryNumber}  on ${entryDate}`
    );
  }

  console.log(
    `\n${apply ? "Posted" : "Would post"} ${created} expense ${created === 1 ? "entry" : "entries"}; skipped ${skipped} order${
      skipped === 1 ? "" : "s"
    } that already had one.`
  );

  if (!apply && created > 0) {
    console.log("Re-run with --apply to write these entries.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  });
