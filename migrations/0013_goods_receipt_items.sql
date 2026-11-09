-- Migration: Goods receipt lines (partial deliveries)
-- Description: Creates "goods_receipt_items", one row per purchase order line on a receipt.
--
--              A delivery can be short, or arrive in several shipments, so a receipt must record
--              WHICH line it covered and HOW MANY units. purchase_order_items.delivered_quantity
--              is the running total across receipts; the order is only marked delivered once
--              every line is complete.
--
--              Each row keeps its own money (unit price, its share of that shipment's fees and the
--              resulting landed cost per unit), because the fees of a later shipment are different
--              from the first one.
--
-- Note: mirror of db/schema.ts "goodsReceiptItems". Applied by `npm run db:push`; this file is
-- the idempotent record of the change (same convention as 0005-0012).

CREATE TABLE IF NOT EXISTS "goods_receipt_items" (
  "id" SERIAL PRIMARY KEY NOT NULL,
  "goods_receipt_id" INTEGER NOT NULL REFERENCES "goods_receipts" ("id") ON DELETE CASCADE,
  "purchase_order_item_id" INTEGER NOT NULL REFERENCES "purchase_order_items" ("id") ON DELETE CASCADE,
  "quantity" INTEGER NOT NULL,
  "unit_price" NUMERIC(15, 2) NOT NULL,
  "allocated_cost" NUMERIC(15, 2) NOT NULL DEFAULT '0',
  "landed_cost_per_unit" NUMERIC(15, 2) NOT NULL,
  "created_at" TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "goods_receipt_items_receipt_idx"
  ON "goods_receipt_items" ("goods_receipt_id");

CREATE INDEX IF NOT EXISTS "goods_receipt_items_po_item_idx"
  ON "goods_receipt_items" ("purchase_order_item_id");
