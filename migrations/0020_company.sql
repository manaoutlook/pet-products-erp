-- 0020: the company letterhead - one row, printed on every document.
--
-- Until now the letterhead did not exist: sales orders and delivery notes printed a brand
-- name from `client/src/config/branding.ts`, receipts printed the same string, and purchase
-- orders printed nothing at all. There was no company name, address or tax ID anywhere.
--
--   company_name          trading name stamped on every page
--   registered_address    legal / head-office address
--   delivery_address      warehouse address used on delivery paperwork
--   tax_id                tax or VAT registration number
--
-- The table is a singleton and says so: `id` is pinned to 1 by a CHECK, so a second company
-- is unrepresentable rather than merely "not done". Columns are NOT NULL with an empty
-- default, because "not set up yet" is a state the app renders (the screen header says what
-- is missing and printing is blocked) - not an error to be special-cased.
--
-- No seed row is inserted: an empty default row and no row mean the same thing to every
-- reader (`missingCompanyFields()` lists all four), and creating one here would claim a
-- company name the user never entered.

CREATE TABLE IF NOT EXISTS "company" (
  "id" INTEGER PRIMARY KEY,
  "company_name" TEXT NOT NULL DEFAULT '',
  "registered_address" TEXT NOT NULL DEFAULT '',
  "delivery_address" TEXT NOT NULL DEFAULT '',
  "tax_id" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW(),
  CONSTRAINT "company_singleton_check" CHECK ("id" = 1)
);
