-- 0025_sales_order_vat_company.sql
--
-- The VAT company is now chosen when the SALES ORDER is raised, not at the till.
--
-- A sales order, its delivery notes and its invoice are one set of papers issued in the name
-- of one licensed company (CI / HI). The order therefore records which company it belongs to,
-- and the delivery note copies that choice when it is issued. Both documents keep their own
-- copy of the company's name, tax code and address (a snapshot), for the same reason the
-- customer block is snapshotted: a later correction to the company record must not rewrite a
-- document that was already signed or printed.
--
-- The order also carries the VAT invoice issued for it (`vat_invoice_number`), so the number
-- is written once and every reprint opens the same document. `customer_tax_id` is the buyer
-- block's tax code, snapshotted from the customer profile when the order is raised.
--
-- Reference only - `npm run db:push` is the mechanism that applies schema changes (see
-- migrations/README.md).

ALTER TABLE "sales_orders"
  ADD COLUMN IF NOT EXISTS "customer_tax_id" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "vat_company_id" INTEGER REFERENCES "vat_companies" ("id"),
  ADD COLUMN IF NOT EXISTS "vat_company_code" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "vat_company_name" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "vat_company_tax_id" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "vat_company_address" TEXT,
  ADD COLUMN IF NOT EXISTS "vat_invoice_number" VARCHAR(50) UNIQUE,
  ADD COLUMN IF NOT EXISTS "vat_invoice_issued_at" TIMESTAMP;

ALTER TABLE "delivery_notes"
  ADD COLUMN IF NOT EXISTS "vat_company_id" INTEGER REFERENCES "vat_companies" ("id"),
  ADD COLUMN IF NOT EXISTS "vat_company_code" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "vat_company_name" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "vat_company_tax_id" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "vat_company_address" TEXT;

CREATE INDEX IF NOT EXISTS "sales_orders_vat_company_idx"
  ON "sales_orders" ("vat_company_id");

CREATE INDEX IF NOT EXISTS "delivery_notes_vat_company_idx"
  ON "delivery_notes" ("vat_company_id");
