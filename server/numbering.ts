/**
 * Human-readable document numbers (purchase orders, goods receipts, inventory barcodes).
 *
 * AI Agent Note: `generateInventoryBarcode` used to exist twice - once privately in
 * routes.ts and once copied into inventory-import.ts ("Mirrors generateInventoryBarcode in
 * routes.ts") - so the two could silently drift. Keep the single definition here; import
 * it, never re-type the format.
 */

/** `PO-YYYYMMDD-NNNN`, e.g. PO-20261108-4821. */
export function generateOrderNumber(): string {
  return `PO-${stamp()}-${random(1000, 9000)}`;
}

/** `GRN-YYYYMMDD-NNNN` - the Goods Receipt Note raised when goods physically arrive. */
export function generateReceiptNumber(): string {
  return `GRN-${stamp()}-${random(1000, 9000)}`;
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
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function random(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}
