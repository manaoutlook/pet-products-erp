-- 0031: a delivery note records the location its units were taken off.
--
-- This is a snapshot of `sales_orders.store_id` copied when the note is issued, and it is also
-- the inventory row the note deducts when the goods leave. The order-level column alone is not
-- enough: an order may be moved to another warehouse after part of it has already shipped, and
-- the signed note must keep saying where *that* shipment came from.
--
-- Same convention as the order (and as `purchase_orders.destination_store_id`):
--
--   store_id IS NULL   the Distribution Centre (`inventory.store_id IS NULL`)
--   store_id = N       that store's own inventory row
--
-- Existing notes keep NULL, i.e. "shipped from the DC". Their stock was never deducted by the
-- sales flow (nothing moved inventory before this feature), so there is no movement to insert
-- here - back-filling would take stock off twice for anything the operator has since adjusted.
--
-- Reference only - `npm run db:push` is the mechanism that applies schema changes (see
-- migrations/README.md).

ALTER TABLE "delivery_notes"
  ADD COLUMN IF NOT EXISTS "store_id" INTEGER REFERENCES "stores" ("id");

CREATE INDEX IF NOT EXISTS "delivery_notes_store_idx" ON "delivery_notes" ("store_id");
