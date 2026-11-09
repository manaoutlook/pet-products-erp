-- Migration: Inventory transaction log
-- Description: Every change to inventory.quantity must leave an audit record that says why,
--              which document caused it, the quantity before/after and who did it.
--
--              1. stock_movements.transaction_type - the audited business reason
--                 (PURCHASE_ORDER, SALES_ORDER, PHYSICAL_COUNT, BULK_IMPORT,
--                  MANUAL_ADJUSTMENT, STOCK_TRANSFER, RETURN, DAMAGE_OR_WRITE_OFF).
--                 Existing rows were written before the vocabulary existed and are
--                 backfilled from the columns that already describe them.
--              2. stock_movements.quantity_before - the quantity right before the change,
--                 so a row reads "12 -> 10 (-2)" without replaying the whole ledger.
--              3. stock_movements.import_file_id - the retained upload behind a bulk import.
--              4. inventory_import_files - the original CSV/Excel bytes plus the per-row
--                 result, so an import can be re-checked later.
--
-- Note: mirror of db/schema.ts. Applied by `npm run db:push`; this file is the idempotent
-- record of the change (same convention as 0005-0020).

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "transaction_type" VARCHAR(32) NOT NULL DEFAULT 'MANUAL_ADJUSTMENT';

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "quantity_before" INTEGER;

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "import_file_id" INTEGER;

-- Backfill the audited reason for rows that predate the column. `reason` is the internal
-- vocabulary, `ref_type` distinguishes the two adjustment flavours.
UPDATE "stock_movements"
SET "transaction_type" = CASE
  WHEN "reason" = 'sale' THEN 'SALES_ORDER'
  WHEN "reason" IN ('refund', 'cancel') THEN 'RETURN'
  WHEN "reason" IN ('transfer_in', 'transfer_out') THEN 'STOCK_TRANSFER'
  WHEN "reason" = 'po_receipt' THEN 'PURCHASE_ORDER'
  WHEN "reason" = 'adjustment' AND "ref_type" = 'stock_take' THEN 'PHYSICAL_COUNT'
  WHEN "reason" = 'adjustment' AND "ref_type" = 'inventory_import' THEN 'BULK_IMPORT'
  WHEN "reason" = 'adjustment' AND "ref_type" = 'damage_or_write_off' THEN 'DAMAGE_OR_WRITE_OFF'
  ELSE 'MANUAL_ADJUSTMENT'
END
WHERE "transaction_type" = 'MANUAL_ADJUSTMENT';

-- quantity_before is derivable for every historical row that cached quantity_after.
UPDATE "stock_movements"
SET "quantity_before" = "quantity_after" - "delta"
WHERE "quantity_before" IS NULL AND "quantity_after" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "stock_movements_type_idx"
  ON "stock_movements" ("transaction_type", "created_at");

CREATE TABLE IF NOT EXISTS "inventory_import_files" (
  "id" SERIAL PRIMARY KEY,
  "original_file_name" TEXT NOT NULL,
  "stored_file_url" TEXT NOT NULL,
  "mime_type" VARCHAR(120),
  "file_size" INTEGER,
  "status" VARCHAR(20) NOT NULL DEFAULT 'processing',
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "created_rows" INTEGER NOT NULL DEFAULT 0,
  "updated_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_rows" INTEGER NOT NULL DEFAULT 0,
  "failed_rows" INTEGER NOT NULL DEFAULT 0,
  "result" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "uploaded_by_user_id" INTEGER,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "completed_at" TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "inventory_import_files_created_idx"
  ON "inventory_import_files" ("created_at");
