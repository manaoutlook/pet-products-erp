/**
 * Read model for the inventory transaction log.
 *
 * AI Agent Note: `stock_movements` is written by every stock path (POS, goods receipt,
 * transfer, stock take, import, manual edit). The screen must not re-implement that
 * knowledge, so the SQL join and the human wording both live here: the route stays thin and
 * the wording can be unit-tested without HTTP.
 */

import { db } from "@db";
import {
  inventory,
  inventoryImportFiles,
  products,
  stockMovements,
  stores,
  users,
  type InventoryTransactionType,
} from "@db/schema";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { scopeStoreFilter, type AccessScope } from "./scoping";
import type { DbClient } from "./db-types";

export interface InventoryTransactionFilters {
  productId?: number;
  storeId?: number;
  inventoryId?: number;
  transactionType?: InventoryTransactionType;
  /**
   * Several types at once, for screens that only care about a family of movements
   * (e.g. the stock-adjustment page shows MANUAL_ADJUSTMENT + DAMAGE_OR_WRITE_OFF +
   * PHYSICAL_COUNT). Ignored when `transactionType` is also given.
   */
  transactionTypes?: InventoryTransactionType[];
  importFileId?: number;
  limit?: number;
  offset?: number;
}

export interface InventoryTransactionRow {
  id: number;
  transactionType: InventoryTransactionType;
  /** Signed change: negative left the shelf, positive arrived on it. */
  quantityChange: number;
  quantityBefore: number | null;
  quantityAfter: number | null;
  productId: number | null;
  productName: string | null;
  sku: string | null;
  inventoryId: number;
  storeId: number | null;
  storeName: string | null;
  /** DC / STORE, when the inventory row still exists. */
  inventoryType: string | null;
  location: string | null;
  /** ('purchase_order', 7), ('sales_transaction', 42), ... - the document behind the change. */
  referenceDocumentType: string | null;
  referenceDocumentId: number | null;
  userId: number | null;
  userName: string | null;
  notes: string | null;
  importFileId: number | null;
  importFileName: string | null;
  importFileUrl: string | null;
  createdAt: string | null;
  /** Plain-English version of the type, ready for the screen. */
  reasonLabel: string;
}

/** Wording for a transaction type, in the direction the stock actually moved. */
export function describeInventoryTransaction(
  transactionType: InventoryTransactionType,
  options: { quantityChange?: number | null; referenceDocumentId?: number | null } = {},
): string {
  const reference = options.referenceDocumentId ? ` #${options.referenceDocumentId}` : '';
  const incoming = (options.quantityChange ?? 0) > 0;

  switch (transactionType) {
    case 'PURCHASE_ORDER':
      return `Stock received against purchase order${reference}`;
    case 'SALES_ORDER':
      return `Stock sold on sales order${reference}`;
    case 'PHYSICAL_COUNT':
      return 'Corrected after a physical stock count';
    case 'BULK_IMPORT':
      return 'Updated by a bulk CSV/Excel import';
    case 'MANUAL_ADJUSTMENT':
      return 'Adjusted manually';
    case 'STOCK_TRANSFER':
      return incoming ? 'Received from another store' : 'Sent to another store';
    case 'RETURN':
      return incoming ? 'Returned to stock' : 'Reversed return';
    case 'DAMAGE_OR_WRITE_OFF':
      return 'Written off (damage or loss)';
    default:
      return 'Stock changed';
  }
}

/** Every movement the caller is allowed to see, newest first. */
export async function listInventoryTransactions(
  scope: AccessScope,
  filters: InventoryTransactionFilters = {},
  executor: DbClient = db,
): Promise<InventoryTransactionRow[]> {
  const conditions = [];

  // DC rows (store_id NULL) are shared company stock and stay visible, same rule as the
  // stock list - otherwise a store user would see a pull from the DC with no counterpart.
  const storeFilter = scopeStoreFilter(scope, stockMovements.storeId);
  if (storeFilter) {
    conditions.push(or(storeFilter, isNull(stockMovements.storeId)));
  }

  if (filters.productId) {
    conditions.push(eq(stockMovements.productId, filters.productId));
  }
  if (filters.storeId) {
    conditions.push(eq(stockMovements.storeId, filters.storeId));
  }
  if (filters.inventoryId) {
    conditions.push(eq(stockMovements.inventoryId, filters.inventoryId));
  }
  if (filters.transactionType) {
    conditions.push(eq(stockMovements.transactionType, filters.transactionType));
  } else if (filters.transactionTypes && filters.transactionTypes.length > 0) {
    conditions.push(inArray(stockMovements.transactionType, filters.transactionTypes));
  }
  if (filters.importFileId) {
    conditions.push(eq(stockMovements.importFileId, filters.importFileId));
  }

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const rows = await executor
    .select({
      id: stockMovements.id,
      transactionType: stockMovements.transactionType,
      quantityChange: stockMovements.delta,
      quantityBefore: stockMovements.quantityBefore,
      quantityAfter: stockMovements.quantityAfter,
      productId: stockMovements.productId,
      productName: products.name,
      sku: products.sku,
      inventoryId: stockMovements.inventoryId,
      storeId: stockMovements.storeId,
      storeName: stores.name,
      inventoryType: inventory.inventoryType,
      location: inventory.location,
      referenceDocumentType: stockMovements.refType,
      referenceDocumentId: stockMovements.refId,
      userId: stockMovements.userId,
      userName: users.username,
      notes: stockMovements.note,
      importFileId: stockMovements.importFileId,
      importFileName: inventoryImportFiles.originalFileName,
      importFileUrl: inventoryImportFiles.storedFileUrl,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .leftJoin(products, eq(products.id, stockMovements.productId))
    .leftJoin(stores, eq(stores.id, stockMovements.storeId))
    .leftJoin(inventory, eq(inventory.id, stockMovements.inventoryId))
    .leftJoin(users, eq(users.id, stockMovements.userId))
    .leftJoin(inventoryImportFiles, eq(inventoryImportFiles.id, stockMovements.importFileId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(stockMovements.id))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    reasonLabel: describeInventoryTransaction(row.transactionType, {
      quantityChange: row.quantityChange,
      referenceDocumentId: row.referenceDocumentId,
    }),
  }));
}

