-- 0017: store phone numbers without the human separators.
--
-- The customer rows seeded before the profile rework held `+84-930-123-456` style values. The
-- edit form pre-fills `mobile_number` as-is, so those rows could not be saved again: the
-- client validator rejected the dashes that came from the database rather than from a
-- keystroke. New writes are normalised by shared/phone.ts (client) and
-- insertCustomerProfileSchema (API); this migration cleans up what is already stored.
--
-- Digits are kept, a leading `+` is kept, every other character (space, dash, dot, brackets)
-- is dropped. Normalising cannot introduce a duplicate: it only removes characters, so two
-- rows that differ only by separators would already have been the same number.

UPDATE customer_profiles
SET mobile_number = CASE
        WHEN mobile_number LIKE '+%' THEN '+' || regexp_replace(substr(mobile_number, 2), '[^0-9]', '', 'g')
        ELSE regexp_replace(mobile_number, '[^0-9]', '', 'g')
    END,
    land_line_number = CASE
        WHEN land_line_number IS NULL THEN NULL
        WHEN land_line_number LIKE '+%' THEN '+' || regexp_replace(substr(land_line_number, 2), '[^0-9]', '', 'g')
        ELSE regexp_replace(land_line_number, '[^0-9]', '', 'g')
    END
WHERE mobile_number ~ '[^0-9+]'
   OR mobile_number ~ '\+.'
   OR COALESCE(land_line_number, '') ~ '[^0-9+]'
   OR COALESCE(land_line_number, '') ~ '\+.';
