import { db } from "@db";
import { invoiceCounters } from "@db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DbClient } from "./db-types";

/**
 * Receipt numbering for the payments recorded against an invoice.
 *
 * Format: `RCPT-YYYYMMDD-0001`, one company-wide sequence.
 *
 * AI Agent Note - why a separate counter type:
 * A payment receipt is a document the customer keeps ("I paid 5,000,000 on 12 March"). It must
 * carry its own number, because one invoice can be settled by several receipts and each of them
 * has to be quotable. It shares `invoice_counters` with the sales/VAT sequences but never the
 * same row: `counter_type = 'RECEIPT'` keeps the two books apart, so a receipt can never consume
 * a tax invoice number (or the other way round).
 *
 * AI Agent Note - why NOT one sequence per store:
 * `invoice_payments.receipt_number` is UNIQUE across the whole table, and a receipt for a Sales
 * Order invoice has no store at all (`store_id IS NULL`, it is a company document). A per-store
 * counter hands `RCPT-20261117-0001` to both the till in store1 and the company sequence, and the
 * second payment dies on the unique index. So the row is always the `store_id IS NULL` one; which
 * store took the money is stored on the receipt itself and printed next to the number.
 *
 * The increment is a single SQL statement inside the caller's transaction (`SELECT` then
 * `UPDATE current_number + 1` under the row lock), so two tills taking money at the same moment
 * cannot be handed the same receipt number, and a rolled-back payment does not burn one.
 */
export function generateReceiptPrefix(): string {
  return 'RCPT-';
}

export async function generateReceiptNumber(executor?: DbClient): Promise<string> {
  const run = async (tx: DbClient): Promise<string> => {
    const whereClause = and(
      isNull(invoiceCounters.storeId),
      eq(invoiceCounters.counterType, 'RECEIPT')
    );

    let counter = await tx.query.invoiceCounters.findFirst({ where: whereClause });

    if (!counter) {
      const [created] = await tx
        .insert(invoiceCounters)
        .values({
          storeId: null,
          counterType: 'RECEIPT',
          currentNumber: 0,
          prefix: generateReceiptPrefix(),
        })
        .onConflictDoNothing()
        .returning();

      // A concurrent payment may have created it first - re-read in that case.
      counter = created ?? (await tx.query.invoiceCounters.findFirst({ where: whereClause }))!;
    }

    const [updated] = await tx
      .update(invoiceCounters)
      .set({
        currentNumber: sql`${invoiceCounters.currentNumber} + 1`,
        lastUpdated: new Date(),
      })
      .where(eq(invoiceCounters.id, counter.id))
      .returning({ currentNumber: invoiceCounters.currentNumber });

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${generateReceiptPrefix()}${dateStr}-${updated.currentNumber
      .toString()
      .padStart(4, '0')}`;
  };

  // Callers that already hold a transaction must pass it, so the number commits or rolls back
  // together with the payment it belongs to.
  return executor ? run(executor) : db.transaction(run);
}

/** True when the string is a payment receipt number (RCPT-YYYYMMDD-NNNN). */
export function isReceiptNumber(value: string): boolean {
  return /^RCPT-\d{8}-\d{4,}$/.test(value);
}
