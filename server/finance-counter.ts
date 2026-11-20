import { db } from "@db";
import { invoiceCounters } from "@db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { vietnamDayOf } from "../shared/vietnam-day";
import type { DbClient } from "./db-types";

/**
 * Entry numbering for the manual money book.
 *
 * Format: `FIN-YYYYMMDD-0001`, one company-wide sequence.
 *
 * AI Agent Note - why its own counter type:
 * `finance_entries.entry_number` is unique across the table and a finance entry belongs to the
 * company, not to a store, so it shares the `store_id IS NULL` row of `invoice_counters` but
 * never the row of a receipt or a tax invoice. `counter_type = 'FINANCE'` keeps the sequences
 * apart: recording an expense can never consume `RCPT-…` or `CI-…` numbers.
 *
 * AI Agent Note - the advisory lock:
 * The existing unique index is on `(counter_type, vat_company_id)`, and Postgres treats NULL
 * `vat_company_id` values as distinct. Two simultaneous *first* entries could therefore each
 * insert their own FINANCE counter row and hand out the same number to both entries. A
 * transaction-scoped advisory lock serialises only the number allocation (never the whole book),
 * so this cannot happen; the lock is released automatically when the insert commits or rolls
 * back.
 */
const FINANCE_NUMBER_LOCK = 913472;

export function generateFinancePrefix(): string {
  return "FIN-";
}

export async function generateFinanceEntryNumber(executor?: DbClient): Promise<string> {
  const run = async (tx: DbClient): Promise<string> => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${FINANCE_NUMBER_LOCK})`);

    const whereClause = and(
      isNull(invoiceCounters.storeId),
      eq(invoiceCounters.counterType, "FINANCE")
    );

    let counter = await tx.query.invoiceCounters.findFirst({ where: whereClause });

    if (!counter) {
      const [created] = await tx
        .insert(invoiceCounters)
        .values({
          storeId: null,
          counterType: "FINANCE",
          currentNumber: 0,
          prefix: generateFinancePrefix(),
        })
        .returning();

      counter = created;
    }

    const [updated] = await tx
      .update(invoiceCounters)
      .set({
        currentNumber: sql`${invoiceCounters.currentNumber} + 1`,
        lastUpdated: new Date(),
      })
      .where(eq(invoiceCounters.id, counter.id))
      .returning({ currentNumber: invoiceCounters.currentNumber });

    // Vietnamese day, so the date inside the document number matches the date printed on it.
    const dateStr = vietnamDayOf(new Date()).replace(/-/g, "");
    return `${generateFinancePrefix()}${dateStr}-${updated.currentNumber
      .toString()
      .padStart(4, "0")}`;
  };

  // Callers that already hold a transaction must pass it, so the number commits or rolls back
  // together with the entry it belongs to.
  return executor ? run(executor) : db.transaction(run);
}

/** True when the string is a finance entry number (FIN-YYYYMMDD-NNNN). */
export function isFinanceEntryNumber(value: string): boolean {
  return /^FIN-\d{8}-\d{4,}$/.test(value);
}
