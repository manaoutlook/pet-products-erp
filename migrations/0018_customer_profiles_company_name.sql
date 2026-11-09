-- 0018: a customer profile is a company plus the person we deal with.
--
-- "name" was ambiguous once B2B accounts arrived: it was doing duty as both the account label and
-- the human we call. The sales orders already carry `company_name` and `contact_person` apart, so
-- the profile now matches them:
--
--   name          -> contact_person  (the person at the counter / the buyer's contact)
--   company_name                      (new, nullable - a walk-in B2C customer has none)
--
-- Existing rows keep their value as the contact person, which is exactly what they stored.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customer_profiles' AND column_name = 'name'
  ) THEN
    ALTER TABLE "customer_profiles" RENAME COLUMN "name" TO "contact_person";
  END IF;
END $$;

ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "company_name" TEXT;
