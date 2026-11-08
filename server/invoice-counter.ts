import { db } from "@db";
import { invoiceCounters, stores } from "@db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { DbClient } from "./db-types";

/**
 * Generate invoice number prefix for a store
 * Format: STR{storeId padded to 3 digits}-
 * Example: STR001-, STR042-
 */
export function generateStorePrefix(storeId: number): string {
  return `STR${storeId.toString().padStart(3, '0')}-`;
}

/**
 * Generate DC invoice prefix
 * Format: DC-
 */
export function generateDCPrefix(): string {
  return 'DC-';
}

/**
 * Generate invoice number using atomic counter increment
 * Format: {prefix}{YYYYMMDD}-{sequence number padded to 4 digits}
 * Example: STR001-20241210-0001
 *
 * AI Agent Note: pass `executor` when the caller already holds a transaction, so the
 * counter commits or rolls back with the sale. Without it the counter would increment
 * on a second pooled connection and burn a number even when the sale fails.
 */
export async function generateInvoiceNumber(
  storeId: number | null,
  transactionType: 'STORE_SALE' | 'DC_SALE',
  executor?: DbClient
): Promise<string> {
  const counterType = storeId ? 'STORE' : 'DC';

  const run = async (tx: DbClient): Promise<string> => {
    const whereClause = storeId
      ? and(eq(invoiceCounters.storeId, storeId), eq(invoiceCounters.counterType, counterType))
      : eq(invoiceCounters.counterType, counterType);

    let counter = await tx.query.invoiceCounters.findFirst({
      where: whereClause
    });

    if (!counter) {
      const prefix = storeId ? generateStorePrefix(storeId) : generateDCPrefix();

      const [created] = await tx
        .insert(invoiceCounters)
        .values({
          storeId,
          counterType,
          currentNumber: 0,
          prefix,
        })
        .onConflictDoNothing()
        .returning();

      // A concurrent sale may have created it first - re-read in that case.
      counter = created ?? (await tx.query.invoiceCounters.findFirst({ where: whereClause }))!;
    }

    // AI Agent Note: increment in SQL, not in JS. Reading currentNumber and writing
    // currentNumber + 1 lets two concurrent sales compute the same number; letting
    // Postgres add one to the stored value under the row lock cannot.
    const [updated] = await tx
      .update(invoiceCounters)
      .set({
        currentNumber: sql`${invoiceCounters.currentNumber} + 1`,
        lastUpdated: new Date(),
      })
      .where(eq(invoiceCounters.id, counter.id))
      .returning({
        currentNumber: invoiceCounters.currentNumber,
        prefix: invoiceCounters.prefix,
      });

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${updated.prefix}${dateStr}-${updated.currentNumber.toString().padStart(4, '0')}`;
  };

  // Callers that already hold a transaction must pass it, so the counter commits or
  // rolls back together with the sale.
  return executor ? run(executor) : db.transaction(run);
}

/**
 * Initialize invoice counter for a new store
 * Called when a store is created
 */
export async function initializeStoreCounter(storeId: number): Promise<void> {
  const prefix = generateStorePrefix(storeId);

  await db.insert(invoiceCounters).values({
    storeId,
    counterType: 'STORE',
    currentNumber: 0,
    prefix,
  });
}

/**
 * Get current counter value for a store/DC
 */
export async function getCurrentCounter(
  storeId: number | null,
  counterType: 'STORE' | 'DC'
): Promise<number> {
  const counter = await db.query.invoiceCounters.findFirst({
    where: storeId
      ? and(eq(invoiceCounters.storeId, storeId), eq(invoiceCounters.counterType, counterType))
      : eq(invoiceCounters.counterType, counterType)
  });

  return counter?.currentNumber ?? 0;
}

/**
 * Reset counter for a specific store/DC (admin function)
 * Use with caution - can cause duplicate invoice numbers
 */
export async function resetCounter(
  storeId: number | null,
  counterType: 'STORE' | 'DC',
  newValue: number = 0
): Promise<void> {
  const whereClause = storeId
    ? and(eq(invoiceCounters.storeId, storeId), eq(invoiceCounters.counterType, counterType))
    : eq(invoiceCounters.counterType, counterType);

  await db
    .update(invoiceCounters)
    .set({
      currentNumber: newValue,
      lastUpdated: new Date(),
    })
    .where(whereClause);
}

/**
 * Get all invoice counters (admin function)
 */
export async function getAllCounters() {
  return await db.query.invoiceCounters.findMany({
    with: {
      store: true,
    },
    orderBy: [invoiceCounters.counterType, invoiceCounters.storeId],
  });
}

/**
 * Validate invoice number format
 */
export function validateInvoiceNumber(invoiceNumber: string): boolean {
  // Regex for STORE format: STRXXX-YYYYMMDD-NNNN
  const storeRegex = /^STR\d{3}-\d{8}-\d{4}$/;

  // Regex for DC format: DC-YYYYMMDD-NNNN
  const dcRegex = /^DC-\d{8}-\d{4}$/;

  return storeRegex.test(invoiceNumber) || dcRegex.test(invoiceNumber);
}
