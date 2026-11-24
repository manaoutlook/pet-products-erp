/**
 * Which `inventory.inventoryType` belongs to a store.
 *
 * AI Agent Note - the two values are not free-form: the Inventory screen only offers
 * warehouses in the DC dropdown and only retail stores in the Store dropdown
 * (client/src/pages/InventoryPage.tsx), and goods receipts write `DC` rows against the
 * WAREHOUSE they were delivered to. So `DC` means "stock held by a warehouse" and `STORE`
 * means "stock held by a retail store" - the store's own `type` decides, never whether the
 * `store_id` happens to be null.
 *
 * Transfers used to hardcode `toStoreId === null ? 'DC' : 'STORE'`, so stock transferred into
 * Vinod House (a WAREHOUSE) was stored as `STORE` and the inventory export called it
 * "Retail Store" even though the Stores screen lists it as Warehouse / DC. Reads that filter
 * by `inventoryType = 'DC'` then disagreed with reads that filter by `store_id`.
 */
export type InventoryRowType = "DC" | "STORE";

export function inventoryTypeForStore(
  storeType: string | null | undefined
): InventoryRowType {
  // A null store is the central DC (that is how `/api/inventory` reads DC rows), so it is DC too.
  if (storeType === null || storeType === undefined) return "DC";
  return storeType === "WAREHOUSE" ? "DC" : "STORE";
}
