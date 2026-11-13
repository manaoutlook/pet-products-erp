/**
 * The buyer's tax code (mã số thuế) - the number a VAT invoice must show.
 *
 * A Vietnamese tax code is 10 digits for the enterprise, or 10 digits followed by a 3 digit
 * branch suffix (`0313623838-001`). Retail customers often hand over the number with the
 * grouping spaces the tax office prints (`0313 623 838`), so the separators are stripped at the
 * boundary and only the canonical digits-and-dash form is ever stored or printed - the same rule
 * `shared/phone.ts` applies to mobile numbers.
 *
 * Used by the customer profile form (as the user types), by the POS buyer block (so a pasted code
 * fills cleanly) and by the API (`insertCustomerProfileSchema` in db/schema.ts).
 */

/** Drop the spaces and dots the tax office uses for grouping. Dashes are part of the code. */
export function normalizeTaxCode(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().replace(/[\s.]/g, '');
}

/**
 * Shape accepted by the form and the API: 10 or 13 digits, optionally with the branch suffix
 * written as `-NNN`. An empty string is allowed - a consumer profile has no tax code, and the
 * POS can still be told one at the counter.
 */
export const TAX_CODE_PATTERN = /^\d{10}(-\d{3})?$/;
