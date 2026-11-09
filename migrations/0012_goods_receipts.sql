-- Migration: Goods receipts (GRN) + landed cost per purchase order line
-- Description: Creates "goods_receipts", the record of a purchase order physically arriving,
--              and adds "purchase_order_items.landed_cost_per_unit".
--
--              The receipt carries the figures that are only knowable on arrival: the ACTUAL
--              delivery date plus the import costs (shipping, customs duty, customs tax,
--              brokerage, and a free-form additional fee). Those must not overwrite
--              purchase_orders.delivery_date, which stays the EXPECTED date so on-time
--              delivery can still be measured.
--
--              landed_cost_per_unit is the line's unit_price plus its pro-rata share of the
--              receipt's fees (allocated by line value), i.e. what one unit really cost.
--
-- Note: mirror of db/schema.ts "goodsReceipts" / "purchaseOrderItems.landedCostPerUnit".
-- Applied by `npm run db:push`; this file is the idempotent record of the change (same
-- convention as 0005-0011).

CREATE TABLE IF NOT EXISTS "goods_receipts" (
  "id" SERIAL PRIMARY KEY NOT NULL,
  "purchase_order_id" INTEGER NOT NULL REFERENCES "purchase_orders" ("id") ON DELETE CASCADE,
  "receipt_number" VARCHAR(50) NOT NULL UNIQUE,
  "actual_delivery_date" TIMESTAMP NOT NULL,
  "shipping_fee" NUMERIC(15, 2) NOT NULL DEFAULT '0',
  "customs_duty" NUMERIC(15, 2) NOT NULL DEFAULT '0',
  "customs_tax" NUMERIC(15, 2) NOT NULL DEFAULT '0',
  "brokerage_fee" NUMERIC(15, 2) NOT NULL DEFAULT '0',
  "additional_fee" NUMERIC(15, 2) NOT NULL DEFAULT '0',
  "additional_fee_note" TEXT,
  "total_additional_cost" NUMERIC(15, 2) NOT NULL DEFAULT '0',
  "notes" TEXT,
  "received_by_user_id" INTEGER NOT NULL REFERENCES "users" ("id"),
  "created_at" TIMESTAMP DEFAULT now(),
  "updated_at" TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "goods_receipts_purchase_order_idx"
  ON "goods_receipts" ("purchase_order_id");

ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "landed_cost_per_unit" NUMERIC(15, 2);
