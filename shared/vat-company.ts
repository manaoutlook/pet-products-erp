/**
 * The VAT company letterhead, resolved once for every document that prints it.
 *
 * A VAT company is one of the two licensed entities (CI / HI) that may issue the shop's VAT
 * paperwork. Its printable block is *not* the four-field Company Profile (`shared/company.ts`):
 * it has a name, a tax code and a registered address, and there is no separate delivery
 * address. This module maps that block onto the existing `CompanyHeader` shape so the sales
 * order, the delivery note and the invoice all draw their heading with the same renderer and
 * the same completeness rule - a company missing its tax code cannot print a document.
 *
 * Framework-free: imported by `server/` and `client/`.
 */

import { normalizeCompanyValue, type CompanyHeader } from "./company";

/** The minimum a VAT company must expose to be printed. */
export interface VatCompanyLetterheadSource {
  name?: string | null;
  taxId?: string | null;
  address?: string | null;
}

/** Labels of the blank seller fields, in print order. Empty means "may print". */
export function vatCompanyMissingFields(company: VatCompanyLetterheadSource): string[] {
  const missing: string[] = [];
  if (!normalizeCompanyValue(company.name)) missing.push("Company name");
  if (!normalizeCompanyValue(company.taxId)) missing.push("Tax code");
  if (!normalizeCompanyValue(company.address)) missing.push("Address");
  return missing;
}

/**
 * The VAT company as a printable letterhead, or `null` when there is no company at all.
 *
 * `registeredAddress` and `deliveryAddress` carry the same value: the delivery address is
 * never printed (`COMPANY_HEADER_PRINT_FIELDS`), but the shared completeness check expects
 * the field to be filled before any document prints.
 */
export function vatCompanyLetterhead(
  company: VatCompanyLetterheadSource | null | undefined
): CompanyHeader | null {
  if (!company) return null;

  const name = normalizeCompanyValue(company.name);
  const taxId = normalizeCompanyValue(company.taxId);
  const address = normalizeCompanyValue(company.address);

  if (!name && !taxId && !address) return null;

  return {
    companyName: name,
    registeredAddress: address,
    deliveryAddress: address,
    taxId,
  };
}

/**
 * The letterhead a sales document prints under: the selected VAT company when there is one,
 * the shop's Company Profile otherwise.
 *
 * `snapshot` is the block copied onto the document when it was saved/issued, so a reprint is
 * not affected by a later edit to the VAT company record.
 */
export function documentVatCompanyLetterhead(
  snapshot: VatCompanyLetterheadSource | null | undefined,
  fallback: CompanyHeader | null | undefined
): CompanyHeader | null | undefined {
  const vat = vatCompanyLetterhead(snapshot);
  return vat ?? fallback;
}
