import { and, desc, eq, inArray } from "drizzle-orm";
import { financeEntries } from "@db/schema";
import type { DbClient } from "./db-types";
import { insertPostedFinanceEntry } from "./finance";
import {
  PURCHASE_ORDER_EXPENSE_CATEGORY,
  purchaseOrderExpenseDescription,
} from "../shared/finance";
import { vietnamDayOf } from "../shared/vietnam-day";

/**
 * Purchase orders are money going out, so they post to the money book.
 *
 * Creating a purchase order writes one posted `expense` row (debit) for the order total under the
 * fixed "Supplier purchases" heading, with the PO number as its reference. It is written inside
 * the same transaction as the order and its lines, so an order can never exist without the expense
 * that pays for it - and a failed order insert never leaves an orphan expense behind.
 *
 * The row is matched back to its order by `reference = purchase_orders.order_number` plus the
 * heading, which is why both live here and not at the call site. Cancelling an order voids the
 * row (never deletes it) and re-opening one posts it again, so the money book follows the order.
 *
 * AI Agent Note: do not add the order totals to the Finance report's expenses a second time. The
 * report reads posted `finance_entries`, and the purchase order's expense row is already one of
 * them; the report's `purchases` block exists so the supplier and PO number can be shown, not so
 * the same money can be counted twice.
 */

export interface PostPurchaseOrderExpenseInput {
  orderNumber: string;
  supplierName: string;
  amount: number | string;
  createdByUserId: number;
  /** Defaults to today in Vietnam - the day the order was raised and the money committed. */
  entryDate?: string;
}

/**
 * Post a purchase order's expense. Idempotent: an order that already has a posted expense keeps
 * the one it has, so re-opening a cancelled order cannot post the same money twice.
 */
export async function postPurchaseOrderExpense(
  executor: DbClient,
  input: PostPurchaseOrderExpenseInput
) {
  const existing = await executor.query.financeEntries.findFirst({
    where: and(
      eq(financeEntries.reference, input.orderNumber),
      eq(financeEntries.category, PURCHASE_ORDER_EXPENSE_CATEGORY),
      eq(financeEntries.status, "posted")
    ),
    orderBy: [desc(financeEntries.id)],
  });

  if (existing) return existing;

  return insertPostedFinanceEntry(executor, {
    entryType: "expense",
    category: PURCHASE_ORDER_EXPENSE_CATEGORY,
    description: purchaseOrderExpenseDescription(input.orderNumber, input.supplierName),
    amount: input.amount,
    entryDate: input.entryDate ?? vietnamDayOf(new Date()),
    paymentMethod: "CASH",
    reference: input.orderNumber,
    notes: "Recorded automatically when the purchase order was created.",
    createdByUserId: input.createdByUserId,
  });
}

/**
 * Void the posted expense of a purchase order (the order was cancelled).
 *
 * Nothing is deleted: the row keeps who voided it, when and why, and every total drops it because
 * totals only read `status = 'posted'`. Returns the voided entry id, or null when the order had no
 * posted expense (e.g. it was created before purchase orders posted to Finance).
 */
export async function voidPurchaseOrderExpense(
  executor: DbClient,
  input: { orderNumber: string; voidedByUserId: number; reason: string }
) {
  const [entry] = await executor
    .select({ id: financeEntries.id })
    .from(financeEntries)
    .where(
      and(
        eq(financeEntries.reference, input.orderNumber),
        eq(financeEntries.category, PURCHASE_ORDER_EXPENSE_CATEGORY),
        eq(financeEntries.entryType, "expense"),
        eq(financeEntries.status, "posted")
      )
    )
    .orderBy(desc(financeEntries.id))
    .limit(1);

  if (!entry) return null;

  await executor
    .update(financeEntries)
    .set({
      status: "voided",
      voidedAt: new Date(),
      voidedByUserId: input.voidedByUserId,
      voidReason: input.reason,
      updatedAt: new Date(),
    })
    .where(eq(financeEntries.id, entry.id));

  return entry.id;
}

/**
 * Move a purchase order's expense to the day the order was actually raised.
 *
 * The order date is bookkeeping: an order entered three days after the phone call belongs to the
 * day it was placed, not the day it was typed in. The expense it posted has to move with it, or
 * the money would sit in the wrong month - the Finance report groups expenses by `entry_date`.
 * Both the posted and the voided rows are moved (`voided` keeps its date for the audit trail but
 * is dated consistently if the order is ever re-opened).
 *
 * AI Agent Note - the `entry_number` is NOT renumbered. `FIN-YYYYMMDD-0001` is an identifier that
 * the ledger and the paper trail already quote; changing it would break those references, so the
 * number keeps the day it was allocated while `entry_date` says which day the money belongs to.
 * Totals read `entry_date`, never the digits in the number.
 *
 * Returns how many entries moved (0 when the order has no finance row, e.g. it was created before
 * purchase orders posted to Finance).
 */
export async function movePurchaseOrderExpenseDate(
  executor: DbClient,
  input: { orderNumber: string; entryDate: string }
): Promise<number> {
  const entries = await executor
    .select({ id: financeEntries.id })
    .from(financeEntries)
    .where(
      and(
        eq(financeEntries.reference, input.orderNumber),
        eq(financeEntries.category, PURCHASE_ORDER_EXPENSE_CATEGORY),
        eq(financeEntries.entryType, "expense")
      )
    );

  if (entries.length === 0) return 0;

  await executor
    .update(financeEntries)
    .set({ entryDate: input.entryDate, updatedAt: new Date() })
    .where(inArray(financeEntries.id, entries.map((entry) => entry.id)));

  return entries.length;
}
