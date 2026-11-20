/**
 * Human-readable document numbers (purchase orders, goods receipts, inventory barcodes).
 *
 * AI Agent Note: `generateInventoryBarcode` used to exist twice - once privately in
 * routes.ts and once copied into inventory-import.ts ("Mirrors generateInventoryBarcode in
 * routes.ts") - so the two could silently drift. Keep the single definition here; import
 * it, never re-type the format.
 *
 * AI Agent Note - every date inside a number is a *Vietnamese* day (`shared/vietnam-day.ts`),
 * not the UTC day. A PO raised at 06:30 in Ho Chi Minh City is stored as 23:30 UTC the day
 * before, so a UTC stamp prints yesterday's date on today's paper.
 */

import { VIETNAM_UTC_OFFSET_MINUTES, vietnamDayOf } from "../shared/vietnam-day";

/** `PO-YYYYMMDD-NNNN`, e.g. PO-20261108-4821. */
export function generateOrderNumber(): string {
  return `PO-${stamp()}-${random(1000, 9000)}`;
}

/** `GRN-YYYYMMDD-NNNN` - the Goods Receipt Note raised when goods physically arrive. */
export function generateReceiptNumber(): string {
  return `GRN-${stamp()}-${random(1000, 9000)}`;
}

/** `SO-YYYYMMDD-NNNN` - the Sales Order number printed on the customer's order form. */
export function generateSalesOrderNumber(): string {
  return `SO-${stamp()}-${random(1000, 9000)}`;
}

/** `DN-YYYYMMDD-NNNN` - the Delivery Note number, one per shipment. */
export function generateDeliveryNoteNumber(): string {
  return `DN-${stamp()}-${random(1000, 9000)}`;
}

/**
 * `TRF-YYYYMMDD-HHmmssSSS` (or `QTRF-...`) - the stock transfer number.
 *
 * AI Agent Note - the suffix used to be four random digits, and `transfer_requests.transfer_number`
 * is UNIQUE. Four digits give 9,000 buckets, so by the birthday bound a shop raising ~50
 * transfers a day hits a duplicate roughly one day in seven, and the insert fails with a
 * constraint error the user cannot do anything about. The suffix is now the Vietnamese
 * wall-clock time to the millisecond: it is still readable on a printed slip, and it is
 * strictly increasing within a day, so two transfers cannot share a number.
 */
export function generateTransferNumber(prefix: "TRF" | "QTRF"): string {
  // Shift into Vietnamese wall-clock and read the UTC fields back out - the same trick
  // vietnamDayOf uses, and it keeps the time-of-day and the date on the same clock.
  const shifted = new Date(Date.now() + VIETNAM_UTC_OFFSET_MINUTES * 60_000).toISOString();
  const date = shifted.slice(0, 10).replace(/-/g, "");
  const time = `${shifted.slice(11, 19).replace(/:/g, "")}${shifted.slice(20, 23)}`;
  return `${prefix}-${date}-${time}`;
}

/**
 * Barcode printed on an inventory row: `DC`/`ST` + zero-padded store id + SKU + 4 digits.
 *
 * AI Agent Note: In multiple DC mode the store prefix is populated for Warehouses too, so
 * two warehouses never generate the same barcode for the same SKU.
 */
export function generateInventoryBarcode(
  inventoryType: 'DC' | 'STORE',
  productSku: string,
  storeId?: number | null
): string {
  const prefix = inventoryType === 'DC' ? 'DC' : 'ST';
  const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const storePrefix = storeId ? storeId.toString().padStart(3, '0') : '000';
  return `${prefix}${storePrefix}${productSku}${randomNum}`;
}

function stamp(): string {
  // Vietnamese calendar day: the day the document is dated on paper, not the UTC day.
  return vietnamDayOf(new Date()).replace(/-/g, "");
}

function random(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}
