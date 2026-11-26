-- 0036: money on hand starts from the truth, and a supplier bill says how it was paid.
--
-- Two things `db:push` cannot finish on an existing database:
--
--  1. `purchase_orders.payment_method` is added by `db:push` (a new column), but the CHECK
--     constraints on `finance_entries` are NOT diffed by push - it leaves the old definition in
--     place. A fresh database gets the new ones from db/schema.ts; an existing one keeps the old
--     ones and would reject the new entry type with
--     "violates check constraint finance_entries_direction_matches_type".
--  2. `opening_balance` is a new credit entry type: the money the shop already had when the books
--     opened. It must be a credit (money in) and must not name a partner, which is exactly what
--     these two constraints describe.
--
-- Run this against a database that is already on the new code (the same "reference only" rule as
-- the other files here - see migrations/README.md). Every statement is idempotent, so re-running
-- it is a no-op.
--
-- The column is added here as well so a database that has not been pushed yet still ends up in
-- the right shape; `db:push` is still the thing that owns the rest of the schema.

ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "payment_method" varchar(20) NOT NULL DEFAULT 'CASH';

ALTER TABLE "finance_entries"
  DROP CONSTRAINT IF EXISTS "finance_entries_direction_matches_type";

ALTER TABLE "finance_entries"
  ADD CONSTRAINT "finance_entries_direction_matches_type" CHECK (
    ("entry_type" IN ('income', 'partner_deposit', 'opening_balance') AND "direction" = 'credit')
    OR ("entry_type" IN ('expense', 'partner_withdrawal') AND "direction" = 'debit')
  );

ALTER TABLE "finance_entries"
  DROP CONSTRAINT IF EXISTS "finance_entries_partner_consistency";

ALTER TABLE "finance_entries"
  ADD CONSTRAINT "finance_entries_partner_consistency" CHECK (
    ("entry_type" IN ('partner_deposit', 'partner_withdrawal')
      AND "partner_id" IS NOT NULL AND "funding_kind" IS NOT NULL)
    OR ("entry_type" IN ('income', 'expense', 'opening_balance')
      AND "partner_id" IS NULL AND "funding_kind" IS NULL)
  );
