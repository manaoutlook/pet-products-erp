-- Migration: Customer profiles describe the customer account, not a pet
-- Description: Replaces the pet-shaped columns of "customer_profiles" with account fields:
--                * "mobile_number"  - renamed from "phone_number"; still the natural key used
--                  to look a customer up at the till (UNIQUE, NOT NULL);
--                * "customer_type"  - renamed from "pet_type"; the value domain is now
--                  'B2B' (business account) or 'B2C' (end consumer) instead of 'CAT'/'DOG';
--                * "land_line_number" - renamed from "pet_birthday" and converted from date
--                  to varchar(20): a fixed line, not a birthday, so the old dates are cleared.
--
-- Note: mirror of db/schema.ts "customerProfiles". Applied by `npm run db:push`; this file is
-- the idempotent record of the change (same convention as 0005-0015).

DO $$
BEGIN
  -- phone_number -> mobile_number
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'customer_profiles'
      AND column_name = 'phone_number'
  ) THEN
    ALTER TABLE "customer_profiles" RENAME COLUMN "phone_number" TO "mobile_number";
  END IF;

  -- pet_type -> customer_type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'customer_profiles'
      AND column_name = 'pet_type'
  ) THEN
    ALTER TABLE "customer_profiles" RENAME COLUMN "pet_type" TO "customer_type";
  END IF;

  -- pet_birthday -> land_line_number (date -> varchar)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'customer_profiles'
      AND column_name = 'pet_birthday'
  ) THEN
    ALTER TABLE "customer_profiles" RENAME COLUMN "pet_birthday" TO "land_line_number";
  END IF;
END $$;

-- A birthday is not a phone number, and the column is now free text.
ALTER TABLE "customer_profiles"
  ALTER COLUMN "land_line_number" TYPE VARCHAR(20) USING "land_line_number"::TEXT;

-- Drop the migrated dates so no profile keeps a stray birthday in the land line field.
UPDATE "customer_profiles"
SET "land_line_number" = NULL
WHERE "land_line_number" IS NOT NULL
  AND "land_line_number" ~ '^\d{4}-\d{2}-\d{2}$';

-- 'CAT' / 'DOG' are no longer valid; treat those legacy rows as consumer accounts.
UPDATE "customer_profiles"
SET "customer_type" = 'B2C'
WHERE "customer_type" IS NULL
   OR "customer_type" NOT IN ('B2B', 'B2C');

ALTER TABLE "customer_profiles" ALTER COLUMN "customer_type" SET NOT NULL;

-- Postgres keeps the old name on the constraints that came with the renamed column, which makes
-- future `drizzle-kit push` diffs noisy. Rename them to match the new column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_profiles_phone_number_unique'
      AND conrelid = 'customer_profiles'::regclass
  ) THEN
    ALTER TABLE "customer_profiles"
      RENAME CONSTRAINT "customer_profiles_phone_number_unique"
      TO "customer_profiles_mobile_number_unique";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_profiles_phone_number_not_null'
      AND conrelid = 'customer_profiles'::regclass
  ) THEN
    ALTER TABLE "customer_profiles"
      RENAME CONSTRAINT "customer_profiles_phone_number_not_null"
      TO "customer_profiles_mobile_number_not_null";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_profiles_pet_type_not_null'
      AND conrelid = 'customer_profiles'::regclass
  ) THEN
    ALTER TABLE "customer_profiles"
      RENAME CONSTRAINT "customer_profiles_pet_type_not_null"
      TO "customer_profiles_customer_type_not_null";
  END IF;
END $$;

-- Enforce the dropdown's value domain in the database as well as in the API schema.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_profiles_customer_type_check'
      AND conrelid = 'customer_profiles'::regclass
  ) THEN
    ALTER TABLE "customer_profiles"
      ADD CONSTRAINT "customer_profiles_customer_type_check"
      CHECK ("customer_type" IN ('B2B', 'B2C'));
  END IF;
END $$;
