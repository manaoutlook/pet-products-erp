-- 0029_vat_margin_settings.sql
--
-- The VAT Margin Calculator's global defaults.
--
-- The calculator splits a sales order's value between SmartLife and the VAT company that issues
-- the invoice. Three numbers drive the split:
--
--   income tax              the same for every document (20% in the worksheet)
--   profit margin           the share SmartLife keeps, 95%-99%
--
-- (A third setting, the VAT invoice service fee, lived here until 0034 removed it: the fee is no
-- longer charged, so the calculator has no field for it and the stored row is deleted.)
--
-- They were retyped for every statement, so two statements for the same month could disagree.
-- `app_settings` stores them once, keyed by name, and the calculator pre-fills its fields from
-- here. It is deliberately generic: a setting is a serialised scalar (`value` is TEXT) and the
-- code that owns the key (`server/vat-margin-settings.ts`) decides how to read it.
--
-- Rows are upserted, never deleted - clearing a field in the UI stores the default back, so a
-- statement always has a number to compute with.
--
-- Reference only - `npm run db:push` is the mechanism that applies schema changes (see
-- migrations/README.md).

CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" VARCHAR(120) PRIMARY KEY,
  "value" TEXT NOT NULL,
  "updated_at" TIMESTAMP DEFAULT NOW(),
  "updated_by_user_id" INTEGER REFERENCES "users"("id")
);
