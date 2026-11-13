import { db } from "@db";
import { invoiceCounters, vatCompanies } from "@db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { DbClient } from "./db-types";
import { VAT_INVOICE_PREFIXES } from "../shared/invoice";

export { VAT_INVOICE_PREFIXES };

/**
 * Invoice numbering.
 *
 * Three independent sequences exist, and each keeps its own counter row in
 * `invoice_counters`:
 *
 *   STORE        `STR001-YYYYMMDD-0001`  a shop sale, non-VAT     (per store)
 *   DC           `DC-YYYYMMDD-0001`      a DC sale, non-VAT       (one sequence)
 *   VAT_COMPANY  `CI-YYYYMMDD-0001`      a VAT invoice            (per VAT company)
 *
 * AI Agent Note - decision recorded 2026-11-09 and confirmed by the owner: the counter is
 * NOT reset per calendar day, even though the date is part of the number. Only the
 * trailing sequence is monotonic; the date is a readable stamp of the day of issue. The
 * owner knows a daily reset would make the number a legal numbering concern and has chosen
 * to leave it exactly as it is for now. Do not change it without asking.
 *
 * A VAT invoice is issued by the company, not by the shop, so its sequence is global to
 * that company (`vat_company_id`) instead of per store: CI and HI each count on their own
 * and can never collide, which is what the two companies' tax books require.
 */

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
 * Generate the prefix of a VAT company's sequence.
 * `CI` -> `CI-`, `HI` -> `HI-` (see shared/invoice.ts).
 */
export function generateVatCompanyPrefix(code: string): string {
  return `${code.toUpperCase()}-`;
}

/**
 * One atomic increment of a counter row, returning the formatted number.
 *
 * `createValues` is only used the first time (when the counter row does not exist yet).
 * The increment itself is done in SQL under the row lock: reading `currentNumber` and
 * writing `currentNumber + 1` in JS lets two concurrent sales compute the same number.
 */
async function nextSequence(
  tx: DbClient,
  whereClause: any,
  createValues: { storeId: number | null; counterType: string; prefix: string; vatCompanyId?: number | null }
): Promise<string> {
  let counter = await tx.query.invoiceCounters.findFirst({ where: whereClause });

  if (!counter) {
    const [created] = await tx
      .insert(invoiceCounters)
      .values({ ...createValues, currentNumber: 0 })
      .onConflictDoNothing()
      .returning();

    // A concurrent sale may have created it first - re-read in that case.
    counter = created ?? (await tx.query.invoiceCounters.findFirst({ where: whereClause }))!;
  }

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

    return nextSequence(tx, whereClause, {
      storeId,
      counterType,
      prefix: storeId ? generateStorePrefix(storeId) : generateDCPrefix(),
    });
  };

  // Callers that already hold a transaction must pass it, so the counter commits or
  // rolls back together with the sale.
  return executor ? run(executor) : db.transaction(run);
}

/**
 * Generate the next invoice number of a VAT company's own sequence.
 *
 * Format: `CI-YYYYMMDD-0001` / `HI-YYYYMMDD-0001`
 *
 * AI Agent Note: called from `createSale` inside the same transaction as the sale, for the
 * same reason as the store sequence - a failed sale must not burn a number out of the
 * company's tax book.
 */
export async function generateVatCompanyInvoiceNumber(
  vatCompanyId: number,
  code: string,
  executor?: DbClient
): Promise<string> {
  const run = async (tx: DbClient): Promise<string> => {
    const whereClause = and(
      eq(invoiceCounters.counterType, 'VAT_COMPANY'),
      eq(invoiceCounters.vatCompanyId, vatCompanyId)
    );

    return nextSequence(tx, whereClause, {
      storeId: null,
      counterType: 'VAT_COMPANY',
      prefix: generateVatCompanyPrefix(code),
      vatCompanyId,
    });
  };

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
 * Initialize the invoice sequence of a VAT company (CI / HI).
 *
 * Safe to call more than once - the unique index on (counter_type, vat_company_id) makes
 * the second insert a no-op.
 */
export async function initializeVatCompanyCounter(
  vatCompanyId: number,
  code: string
): Promise<void> {
  await db
    .insert(invoiceCounters)
    .values({
      storeId: null,
      counterType: 'VAT_COMPANY',
      vatCompanyId,
      currentNumber: 0,
      prefix: generateVatCompanyPrefix(code),
    })
    .onConflictDoNothing();
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
      vatCompany: true,
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

  // Regex for VAT company format: CI-YYYYMMDD-NNNN / HI-YYYYMMDD-NNNN
  // The sequence grows past 9999 without changing the meaning of the format.
  const vatRegex = /^(CI|HI)-\d{8}-\d{4,}$/;

  return storeRegex.test(invoiceNumber) || dcRegex.test(invoiceNumber) || vatRegex.test(invoiceNumber);
}

/** True when the number belongs to a VAT company's book (CI-/HI-). */
export function isVatInvoiceNumber(invoiceNumber: string): boolean {
  return /^(CI|HI)-\d{8}-\d{4,}$/.test(invoiceNumber);
}

/**
 * The VAT company that owns a sale, or `null` for a non-VAT retail sale.
 *
 * AI Agent Note: the company is resolved through `sales_transactions.vat_company_id`, which
 * was snapshotted when the invoice was issued - editing the company's letterhead later must
 * not silently rewrite the seller on an invoice that was already printed.
 */
export async function resolveVatCompany(
  vatCompanyId: number | null
): Promise<typeof vatCompanies.$inferSelect | null> {
  if (!vatCompanyId) return null;
  const company = await db.query.vatCompanies.findFirst({
    where: eq(vatCompanies.id, vatCompanyId),
  });
  return company ?? null;
}
