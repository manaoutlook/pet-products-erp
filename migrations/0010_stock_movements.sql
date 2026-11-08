-- Migration: Append-only stock movement ledger
-- Description: Creates "stock_movements", the audit trail for every change to
--              inventory.quantity. inventory.quantity stays the cached running total; the
--              ledger records why it changed (sale/refund/cancel/transfer/po receipt/
--              adjustment) so a wrong quantity can be reconstructed and audited.
--
-- Note: mirror of db/schema.ts "stockMovements". Applied by `npm run db:push`; this file
-- is the idempotent record of the change (same convention as 0005-0009).
--
-- Deliberately no foreign keys: this is history. Deleting an inventory row must not erase
-- the record that stock once moved, so product_id/store_id are denormalised and unconstrained.

CREATE TABLE IF NOT EXISTS "stock_movements" (
  "id" SERIAL PRIMARY KEY NOT NULL,
  "inventory_id" INTEGER NOT NULL,
  "product_id" INTEGER,
  "store_id" INTEGER,
  "delta" INTEGER NOT NULL,
  "quantity_after" INTEGER,
  "reason" VARCHAR(24) NOT NULL,
  "ref_type" VARCHAR(40),
  "ref_id" INTEGER,
  "user_id" INTEGER,
  "created_at" TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "stock_movements_inventory_idx"
  ON "stock_movements" ("inventory_id", "created_at");

CREATE INDEX IF NOT EXISTS "stock_movements_reason_idx"
  ON "stock_movements" ("reason");
