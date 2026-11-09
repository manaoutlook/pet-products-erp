/**
 * One canonical form for phone numbers: digits with an optional leading `+`.
 *
 * The legacy customer rows carried the human formatting (`+84-930-123-456`). Because
 * `mobileNumber` is shown in the edit form as-is, opening one of those profiles made the
 * validator reject a value the user never typed - the dashes came from the row. Stripping the
 * separators on the way in fixes the display, and doing it on the API boundary as well (see
 * `insertCustomerProfileSchema` in db/schema.ts) keeps a single form in the database, so the
 * unique index also treats `+84930123456`, `+84 930 123 456` and `+84-930-123-456` as the same
 * customer instead of letting all three through.
 *
 * Used by the client (strictly as you type) and the server (before validation), the same way
 * `shared/permissions.ts` is shared.
 */

/**
 * Strip spaces, dashes, dots and parentheses, keeping a leading `+` when there is one.
 * `normalizePhoneNumber('+84-930-123-456')` -> `'+84930123456'`.
 */
export function normalizePhoneNumber(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

/**
 * E.164-ish shape the customer profile form and the API accept: an optional `+` followed by 6
 * to 15 digits, so both the international form (`+84930123456`) and the local one the till uses
 * (`0901234567`) are valid. Separators are not allowed - they are stripped before this is
 * checked, never stored.
 */
export const MOBILE_NUMBER_PATTERN = /^\+?\d{6,15}$/;
