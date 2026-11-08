import type { db } from "@db";

/**
 * Either the root drizzle client or an active transaction.
 *
 * AI Agent Note: helpers such as generateInvoiceNumber and the sale services must
 * run inside the caller's transaction, otherwise they silently commit on their own
 * connection and the surrounding atomicity is a lie. This type lets them accept both.
 */
export type DbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
