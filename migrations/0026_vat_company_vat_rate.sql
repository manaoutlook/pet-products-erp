-- 0026_vat_company_vat_rate.sql
--
-- Each licensed company now charges its own VAT percentage.
--
-- Until now the rate was one constant (`VAT_RATE = 0.1` in shared/tax.ts), so CI and HI always
-- invoiced at 10%. A company's rate is a fact about the company - it is printed on the invoice
-- and it is what the tax authority reconciles - so it belongs on `vat_companies`, next to the
-- name and tax code it already owns.
--
-- Stored as a FRACTION (`0.0800` = 8%), the same unit as `sales_transactions.vat_rate` and
-- `computeSaleTotals()`'s `rate` argument. The VAT Companies screen edits it as a percentage
-- ("8") and converts with `percentToRate` / `rateToPercent` (shared/tax.ts).
--
-- `sales_orders.vat_rate` is the snapshot: the rate is copied onto an order when the order is
-- saved and the invoice prints that stored rate, so correcting the company's rate today cannot
-- rewrite an invoice that was already issued. `0` means "this order carries no VAT company".
-- The 10% default backfills existing rows with the rate they were actually invoiced at.
--
-- Reference only - `npm run db:push` is the mechanism that applies schema changes (see
-- migrations/README.md).

ALTER TABLE "vat_companies"
  ADD COLUMN IF NOT EXISTS "vat_rate" DECIMAL(5, 4) NOT NULL DEFAULT 0.1000;

ALTER TABLE "sales_orders"
  ADD COLUMN IF NOT EXISTS "vat_rate" DECIMAL(5, 4) NOT NULL DEFAULT 0.1000;
