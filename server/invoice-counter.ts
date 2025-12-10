import { db } from "@db";
import { invoiceCounters, stores } from "@db/schema";
import { eq, and, sql } from "drizzle-orm";

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
 */
export async function generateInvoiceNumber(
  storeId: number | null,
  transactionType: 'STORE_SALE' | 'DC_SALE'
): Promise<string> {
  const counterType = storeId ? 'STORE' : 'DC';

  // Use a database transaction to atomically increment the counter
  const result = await db.transaction(async (tx) => {
    // Get or create the counter record
    let counter = await tx.query.invoiceCounters.findFirst({
      where: storeId
        ? and(eq(invoiceCounters.storeId, storeId), eq(invoiceCounters.counterType, counterType))
        : eq(invoiceCounters.counterType, counterType)
    });

    if (!counter) {
      // Create counter if it doesn't exist
      const prefix = storeId ? generateStorePrefix(storeId) : generateDCPrefix();

      const [newCounter] = await tx
        .insert(invoiceCounters)
        .values({
          storeId,
          counterType,
          currentNumber: 0,
          prefix,
        })
        .returning();

      counter = newCounter;
    }

    // Increment the counter atomically
    const newNumber = counter.currentNumber + 1;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    // Update the counter
    await tx
      .update(invoiceCounters)
      .set({
        currentNumber: newNumber,
        lastUpdated: new Date(),
      })
      .where(eq(invoiceCounters.id, counter.id));

    // Generate the invoice number
    const invoiceNumber = `${counter.prefix}${dateStr}-${newNumber.toString().padStart(4, '0')}`;

    return invoiceNumber;
  });

  return result;
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
