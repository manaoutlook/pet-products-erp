-- 0028_finance_accounts.sql
--
-- Financial accounts: the money that is NOT a customer receipt.
--
-- `invoice_payments` records what a customer paid against an invoice. It has no place for the
-- shop's own expenses (rent, salaries, fuel), for income that is not a sale (scrap sales,
-- interest), or for the partners putting money in and taking it out. Those were kept outside the
-- system, so no screen could answer "did we make money this month?" or "how much of the partner's
-- money is still in the company?".
--
-- Two tables close that gap, deliberately separate from the receivable tables:
--
--   `finance_partners` - who the money belongs to. A partner is not a user and not a supplier;
--                        the row only needs a unique name so two withdrawals cannot be filed
--                        under slightly different spellings.
--   `finance_entries`  - one row per movement, with its own number (`FIN-YYYYMMDD-NNNN`,
--                        allocated inside the insert transaction from `invoice_counters` with
--                        `counter_type = 'FINANCE'` so a rollback cannot burn a number).
--                        `entry_type` is 'income' | 'expense' | 'partner_deposit' |
--                        'partner_withdrawal'.
--
-- The rules that the database itself enforces:
--
--   * amount > 0                 - a movement of zero is not a movement.
--   * direction matches the type - income / partner_deposit are 'credit',
--                                  expense / partner_withdrawal are 'debit'. Storing it (and
--                                  checking it) means the ledger and the report cannot disagree.
--   * partner fields match type  - partner deposits/withdrawals must name a partner and a
--                                  funding kind ('capital' or 'loan'); expenses/income must name
--                                  neither.
--
-- Rows are NEVER edited or deleted after posting. A mistake is VOIDED (`status = 'voided'`,
-- `voided_at`, `voided_by_user_id`, `void_reason`) and the row stays in the book, exactly like a
-- voided payment receipt. Every total reads only `status = 'posted'`.
--
-- `invoice_payments` is NOT copied here. The report (`server/finance.ts::financeSummary`) adds the
-- two streams at read time, so a receipt voided in Receivables disappears from income at once with
-- no reconciliation step.
--
-- Partner withdrawal guard (server/finance.ts): the partner row is locked `FOR UPDATE`, the live
-- balance is recomputed from posted entries, and the withdrawal is refused when it exceeds
-- `sum(deposits) - sum(withdrawals)`. Voiding a deposit is refused when the partner has since
-- withdrawn the money.
--
-- Reference only - `npm run db:push` is the mechanism that applies schema changes (see
-- migrations/README.md).

CREATE TABLE IF NOT EXISTS "finance_partners" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(200) NOT NULL UNIQUE,
  "phone" VARCHAR(20),
  "notes" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by_user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "finance_entries" (
  "id" SERIAL PRIMARY KEY,
  "entry_number" VARCHAR(50) NOT NULL UNIQUE,
  -- 'income' | 'expense' | 'partner_deposit' | 'partner_withdrawal'
  "entry_type" VARCHAR(24) NOT NULL,
  -- 'debit' (money out) | 'credit' (money in) - derived from entry_type and checked below.
  "direction" VARCHAR(6) NOT NULL,
  "category" VARCHAR(80) NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(15, 2) NOT NULL, -- VND, whole dong
  "entry_date" DATE NOT NULL,
  "payment_method" VARCHAR(20) NOT NULL DEFAULT 'CASH',
  "reference" VARCHAR(100),
  "notes" TEXT,
  -- Set for partner deposits/withdrawals only.
  "partner_id" INTEGER REFERENCES "finance_partners"("id"),
  "funding_kind" VARCHAR(10),
  -- 'posted' | 'voided'. A voided row stays in the book and is excluded from every total.
  "status" VARCHAR(10) NOT NULL DEFAULT 'posted',
  "voided_at" TIMESTAMP,
  "voided_by_user_id" INTEGER REFERENCES "users"("id"),
  "void_reason" TEXT,
  "created_by_user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW(),
  CONSTRAINT "finance_entries_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "finance_entries_type_valid"
    CHECK ("entry_type" IN ('income', 'expense', 'partner_deposit', 'partner_withdrawal')),
  CONSTRAINT "finance_entries_direction_matches_type"
    CHECK (("entry_type" IN ('income', 'partner_deposit') AND "direction" = 'credit')
        OR ("entry_type" IN ('expense', 'partner_withdrawal') AND "direction" = 'debit')),
  CONSTRAINT "finance_entries_partner_consistency"
    CHECK (("entry_type" IN ('partner_deposit', 'partner_withdrawal')
            AND "partner_id" IS NOT NULL AND "funding_kind" IS NOT NULL)
        OR ("entry_type" IN ('income', 'expense')
            AND "partner_id" IS NULL AND "funding_kind" IS NULL))
);

CREATE INDEX IF NOT EXISTS "finance_entries_entry_date_idx"
  ON "finance_entries" ("entry_date");
CREATE INDEX IF NOT EXISTS "finance_entries_type_status_idx"
  ON "finance_entries" ("entry_type", "status");
CREATE INDEX IF NOT EXISTS "finance_entries_partner_idx"
  ON "finance_entries" ("partner_id");

-- Existing roles: give `finance` the same grant the role already has for `receipts`, so the
-- people who handle money keep seeing the new screen. Roles are otherwise edited on the
-- Role Permissions screen. `jsonb_typeof` guards against a malformed value.
UPDATE "roles"
SET "permissions" = jsonb_set(
      "permissions"::jsonb,
      '{finance}',
      COALESCE("permissions"::jsonb -> 'receipts', 'false'::jsonb),
      true
    )::json
WHERE "permissions" IS NOT NULL
  AND jsonb_typeof("permissions"::jsonb) = 'object'
  AND NOT ("permissions"::jsonb ? 'finance');

