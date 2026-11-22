-- 0030: a sales order now says which location its goods leave from.
--
-- Until this column existed a sales order carried a customer and a delivery address but no
-- warehouse, so nothing could tell the stock ledger which inventory row to take the units off -
-- raising an order (and even shipping it) never moved inventory at all.
--
-- The column mirrors `purchase_orders.destination_store_id`:
--
--   store_id IS NULL   the Distribution Centre (`inventory.store_id IS NULL`,
--                      `inventory_type = 'DC'`)
--   store_id = N       that store's own inventory row
--
-- Orders raised before this migration keep NULL, i.e. "shipped from the DC", which is what the
-- goods receipt flow already assumes.
--
-- The units themselves leave the ledger when a delivery note is issued for this order
-- (`delivery_notes.store_id`, migration 0031), not when the order is saved: the note is the
-- document that records what actually left the warehouse, including partial shipments. Saving
-- an order only checks that the location can cover it, so a cancelled or edited order never has
-- stock to put back.
--
-- Reference only - `npm run db:push` is the mechanism that applies schema changes (see
-- migrations/README.md).

ALTER TABLE "sales_orders"
  ADD COLUMN IF NOT EXISTS "store_id" INTEGER REFERENCES "stores" ("id");

CREATE INDEX IF NOT EXISTS "sales_orders_store_idx" ON "sales_orders" ("store_id");
