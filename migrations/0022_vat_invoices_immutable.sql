-- Migration: VAT invoices, immutable line snapshots and archived invoice documents
-- Description:
--
--  1. `vat_companies` - the legal entities that may issue a VAT invoice.
--     `HỘ KINH DOANH TIỆN ÍCH GIA ĐÌNH` is a household business and is not allowed to issue
--     one, so a VAT sale prints the name / tax code / address of the selected company. Two
--     rows are seeded: CI (Conqueror International) and HI (Hasim International).
--
--  2. `invoice_counters.vat_company_id` - a VAT company keeps its OWN invoice sequence
--     (`CI-YYYYMMDD-0001`, `HI-YYYYMMDD-0001`) instead of sharing the store's retail
--     sequence. The unique index on (counter_type, vat_company_id) makes a second counter row
--     for the same company impossible; Postgres treats NULLs as distinct, so the existing
--     STORE/DC rows are unaffected.
--
--  3. `sales_transactions.subtotal` / `vat_rate` / `vat_amount` - the money is stored, not
--     re-derived. Catalogue prices are VAT-EXCLUSIVE, so:
--         subtotal = sum(line totals), vat_amount = round(subtotal * vat_rate),
--         total_amount = subtotal + vat_amount.
--     Existing rows are backfilled with subtotal = total_amount and vat = 0: that is what
--     those sales actually charged, and it stops the old reprint path (`total / 1.1`) from
--     inventing a 90,909.09 + 9,090.91 split for a 100,000 sale.
--
--  4. `sales_transactions.vat_company_id` / `printed_with_vat` - which company issued the
--     invoice, and whether it was a VAT invoice at all. NULL / false = plain retail sale.
--
--  5. `sales_transactions.archived_document_url` / `archived_at` - the PDF that was issued,
--     stored under `uploads/invoices/<invoice number>.pdf` and re-served on every reprint.
--
--  6. `sales_transaction_items.product_code` / `description` - snapshots of the SKU and name
--     at sale time, so renaming a product tomorrow does not change an invoice issued today.
--     Existing rows are backfilled from the current product catalogue.
--
-- Note: mirror of db/schema.ts. Applied by `npm run db:push`; this file is the idempotent
-- record of the change (same convention as 0005-0021).

-- 1. VAT companies -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "vat_companies" (
  "id" SERIAL PRIMARY KEY,
  "code" VARCHAR(10) NOT NULL UNIQUE,
  "name" VARCHAR(200) NOT NULL,
  "tax_id" VARCHAR(50) NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "phone" VARCHAR(50),
  "email" VARCHAR(200),
  "bank_account" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

-- Tax code and address are intentionally blank: the operator fills them in on the
-- VAT Companies screen. A VAT invoice refuses to print while they are blank, rather than
-- printing an invoice that is invalid on its face.
INSERT INTO "vat_companies" ("code", "name")
VALUES ('CI', 'Conqueror International'), ('HI', 'Hasim International')
ON CONFLICT ("code") DO NOTHING;

-- 2. Invoice counters ---------------------------------------------------------------------
-- The existing column is VARCHAR(10) ('STORE' / 'DC'), which cannot hold 'VAT_COMPANY' (11).
-- Without this the counter insert below fails with "value too long for character varying(10)".
ALTER TABLE "invoice_counters" ALTER COLUMN "counter_type" TYPE VARCHAR(20);

ALTER TABLE "invoice_counters" ADD COLUMN IF NOT EXISTS "vat_company_id" INTEGER
  REFERENCES "vat_companies"("id");

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_counters_vat_company_unique"
  ON "invoice_counters" ("counter_type", "vat_company_id");

-- One sequence per VAT company, starting at zero.
INSERT INTO "invoice_counters" ("store_id", "counter_type", "vat_company_id", "current_number", "prefix")
SELECT NULL, 'VAT_COMPANY', vc."id", 0, vc."code" || '-'
FROM "vat_companies" vc
WHERE NOT EXISTS (
  SELECT 1 FROM "invoice_counters" ic
  WHERE ic."counter_type" = 'VAT_COMPANY' AND ic."vat_company_id" = vc."id"
);

-- 3./4./5. Sales transaction money, VAT issuer and archived document ----------------------
ALTER TABLE "sales_transactions" ADD COLUMN IF NOT EXISTS "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "sales_transactions" ADD COLUMN IF NOT EXISTS "vat_rate" DECIMAL(5,4) NOT NULL DEFAULT 0;
ALTER TABLE "sales_transactions" ADD COLUMN IF NOT EXISTS "vat_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "sales_transactions" ADD COLUMN IF NOT EXISTS "printed_with_vat" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "sales_transactions" ADD COLUMN IF NOT EXISTS "vat_company_id" INTEGER
  REFERENCES "vat_companies"("id");
ALTER TABLE "sales_transactions" ADD COLUMN IF NOT EXISTS "archived_document_url" TEXT;
ALTER TABLE "sales_transactions" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP;

-- Buyer block, snapshotted onto the sale. Backfilled from the customer profile the sale points
-- at, so invoices issued before this migration can still show their buyer.
ALTER TABLE "sales_transactions" ADD COLUMN IF NOT EXISTS "buyer_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "sales_transactions" ADD COLUMN IF NOT EXISTS "buyer_company_name" VARCHAR(200);
ALTER TABLE "sales_transactions" ADD COLUMN IF NOT EXISTS "buyer_tax_id" VARCHAR(50);
ALTER TABLE "sales_transactions" ADD COLUMN IF NOT EXISTS "buyer_address" TEXT;
ALTER TABLE "sales_transactions" ADD COLUMN IF NOT EXISTS "buyer_phone" VARCHAR(50);
ALTER TABLE "sales_transactions" ADD COLUMN IF NOT EXISTS "buyer_email" VARCHAR(200);

UPDATE "sales_transactions" st
SET "buyer_name" = COALESCE(NULLIF(cp."contact_person", ''), NULLIF(cp."company_name", ''), cp."mobile_number", ''),
    "buyer_company_name" = cp."company_name",
    "buyer_address" = cp."address",
    "buyer_phone" = cp."mobile_number",
    "buyer_email" = cp."email"
FROM "customer_profiles" cp
WHERE st."customer_profile_id" = cp."id"
  AND st."buyer_name" = '';

-- Rows written before this migration carried no tax at all (total_amount was the
-- VAT-exclusive subtotal). Preserve exactly what was charged: subtotal = total, VAT = 0.
UPDATE "sales_transactions"
SET "subtotal" = "total_amount", "vat_rate" = 0, "vat_amount" = 0
WHERE "subtotal" = 0 AND "total_amount" <> 0;

-- 6. Line snapshots -----------------------------------------------------------------------
ALTER TABLE "sales_transaction_items" ADD COLUMN IF NOT EXISTS "product_code" VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE "sales_transaction_items" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '';

UPDATE "sales_transaction_items" sti
SET "product_code" = COALESCE(p."sku", ''),
    "description" = COALESCE(p."name", '')
FROM "products" p
WHERE sti."product_id" = p."id"
  AND sti."description" = '';

CREATE INDEX IF NOT EXISTS "sales_transactions_vat_company_idx"
  ON "sales_transactions" ("vat_company_id");
