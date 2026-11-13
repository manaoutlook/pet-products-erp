-- Migration: the buyer's tax code on a customer profile
-- Description:
--
--    A VAT invoice must show the buyer's tax code (mã số thuế) next to the buyer's name and
--    address. The POS used to ask the cashier to type it on every sale, even though the customer
--    is a profile we already keep - and a mistyped digit on a VAT invoice is not something the
--    customer can accept.
--
--    `customer_profiles.tax_id` stores it once. The POS buyer block is filled from the selected
--    profile (name / company / address / phone come from the same row), and the sale still takes
--    its own snapshot, so editing a profile later never rewrites an invoice that was issued.
--
--    NOT NULL DEFAULT '' rather than NULL: a consumer profile has no tax code, and the create /
--    edit form treats "no tax code" as an empty string, which keeps one representation in the
--    table instead of '' vs NULL for the same fact.
--
--    The value is normalised at the API boundary (spaces and grouping dots removed, so
--    `0313 623 838` becomes `0313623838`) and checked against `^\d{10}(-\d{3})?$` - the 10 digit
--    enterprise code, optionally with the 3 digit branch suffix. See shared/tax-code.ts.

ALTER TABLE customer_profiles
  ADD COLUMN IF NOT EXISTS tax_id VARCHAR(50) NOT NULL DEFAULT '';

COMMENT ON COLUMN customer_profiles.tax_id IS
  'Buyer tax code (mã số thuế) printed on a VAT invoice; empty when the customer has none';
