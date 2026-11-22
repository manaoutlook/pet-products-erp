-- 0035: backfill the three permission modules that used to be implied by another grant.
--
-- `vatCompanies`, `companyProfile` and `vatMargin` are now modules of their own (see
-- db/schema.ts and client/src/pages/RolePermissionsPage.tsx). `roleCan` reads the module out of
-- `roles.permissions` and a missing key is a deny, so every role written before this change
-- would lose the screens the old grants opened:
--
--   VAT Companies screen    was `masterData` (sidebar `read`, writes `create`/`update`)
--   Company Profile screen  was `masterData` (route `read`, saving `update`)
--   VAT Margin Calculator   was `orders`     (sidebar + route `read`, defaults `update`)
--
-- Copy each role's existing grant across so nobody loses a screen on deploy; the Role
-- Permissions screen is then the place to tighten them. In particular `vatMargin` is
-- partner-only information - the seeder gives it to `store_manager` but not to
-- `sales_associate` - so a shop that wants the split hidden from sales staff should switch it
-- off there rather than in this file.
--
-- `db:push` cannot do this: it owns the schema, but `roles.permissions` is `jsonb NOT NULL`
-- with no default, so existing rows keep the object they were written with. This mirrors
-- 0028_finance_accounts.sql, which copied `receipts` into `finance` for the same reason.
--
-- Reference only - run it against a database that is already on the new code (see
-- migrations/README.md). Each statement is guarded by `? 'module'`, so re-running is a no-op,
-- and each module is handled on its own: a role already saved from the Role Permissions screen
-- after the upgrade keeps the switches an admin set and only gains the ones still missing.

UPDATE "roles"
SET "permissions" = jsonb_set(
      "permissions"::jsonb,
      '{vatCompanies}',
      COALESCE("permissions"::jsonb -> 'masterData', 'false'::jsonb),
      true
    )::json
WHERE "permissions" IS NOT NULL
  AND jsonb_typeof("permissions"::jsonb) = 'object'
  AND NOT ("permissions"::jsonb ? 'vatCompanies');

UPDATE "roles"
SET "permissions" = jsonb_set(
      "permissions"::jsonb,
      '{companyProfile}',
      COALESCE("permissions"::jsonb -> 'masterData', 'false'::jsonb),
      true
    )::json
WHERE "permissions" IS NOT NULL
  AND jsonb_typeof("permissions"::jsonb) = 'object'
  AND NOT ("permissions"::jsonb ? 'companyProfile');

UPDATE "roles"
SET "permissions" = jsonb_set(
      "permissions"::jsonb,
      '{vatMargin}',
      COALESCE("permissions"::jsonb -> 'orders', 'false'::jsonb),
      true
    )::json
WHERE "permissions" IS NOT NULL
  AND jsonb_typeof("permissions"::jsonb) = 'object'
  AND NOT ("permissions"::jsonb ? 'vatMargin');
