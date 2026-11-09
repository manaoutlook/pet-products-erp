/**
 * The company letterhead - one definition for the whole application.
 *
 * Every outbound paper (sales order, delivery note, receipt, purchase order) and the
 * band at the top of every screen read the same four fields from the same single
 * `company` row. Keeping the field list, the labels and the completeness rule here -
 * rather than in each of the eight render sites - is what makes the printed header and
 * the on-screen header impossible to drift apart: the server validates with this list,
 * the browser blocks a print with this list, and the label a user sees on paper is
 * byte-for-byte the label they see on screen.
 *
 * Framework-free on purpose: imported by `server/` (tsx) and `client/` (Vite).
 */

/** The only allowed primary key. `company` is a one-row table, enforced by a CHECK. */
export const COMPANY_SINGLETON_ID = 1;

/**
 * The four printable fields, in print order.
 *
 * `key` is the camelCase field used by the API, the database column and both renderers;
 * `label` is the text stamped in front of the value ("Company Name: ..."). One label,
 * one spelling, everywhere.
 */
export const COMPANY_FIELDS = [
  { key: "companyName", column: "company_name", label: "Company Name" },
  { key: "registeredAddress", column: "registered_address", label: "Registered Address" },
  { key: "deliveryAddress", column: "delivery_address", label: "Delivery Address" },
  { key: "taxId", column: "tax_id", label: "Tax ID" },
] as const;

export type CompanyFieldKey = (typeof COMPANY_FIELDS)[number]["key"];

/**
 * The fields that actually reach the paper's heading, in print order.
 *
 * `deliveryAddress` is deliberately absent: it belongs to the company record (and still
 * blocks printing while blank, like every other field) but it is not part of the heading.
 * `taxId` is the one value a reader cannot identify on its own, so it is the one value
 * that keeps its label on paper.
 *
 * `emphasis` marks the company name, which is set larger and bolder than the lines under it.
 */
export const COMPANY_HEADER_PRINT_FIELDS = [
  { key: "companyName", showLabel: false, emphasis: true },
  { key: "registeredAddress", showLabel: false, emphasis: false },
  { key: "taxId", showLabel: true, emphasis: false },
] as const satisfies ReadonlyArray<{
  key: CompanyFieldKey;
  showLabel: boolean;
  emphasis: boolean;
}>;

/** A complete (or partially filled) letterhead, keyed exactly like the API payload. */
export type CompanyHeader = Record<CompanyFieldKey, string>;

/** Trim only - an address of `"  "` is as absent as an empty one. */
export function normalizeCompanyValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Coerce anything object-shaped (a Drizzle row, an API payload, a form value, a stray
 * array) into a letterhead. `null` in, `null` out, so "no company record yet" stays
 * distinguishable from "record exists but every field is blank".
 */
export function toCompanyHeader(
  source: Record<string, unknown> | null | undefined
): CompanyHeader | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const header = {} as CompanyHeader;
  for (const field of COMPANY_FIELDS) {
    header[field.key] = normalizeCompanyValue(source[field.key]);
  }
  return header;
}

/** One line of the printed heading: usually a bare value, sometimes `label: value`. */
export interface CompanyHeaderLine {
  key: CompanyFieldKey;
  /** Empty when the value stands on its own; `Tax ID` otherwise. */
  label: string;
  value: string;
  /** True for the company name - set larger and bolder than the lines under it. */
  emphasis: boolean;
}

/**
 * The printed heading, resolved to plain data so HTML, jsPDF and the React preview can all
 * draw the same three lines without each re-deciding what is shown or labelled.
 */
export function companyHeaderPrintLines(
  company: Partial<CompanyHeader> | null | undefined
): CompanyHeaderLine[] {
  return COMPANY_HEADER_PRINT_FIELDS.map((printed) => {
    const field = COMPANY_FIELDS.find((candidate) => candidate.key === printed.key);
    return {
      key: printed.key,
      label: printed.showLabel ? (field?.label ?? printed.key) : "",
      value: normalizeCompanyValue(company?.[printed.key]),
      emphasis: printed.emphasis,
    };
  });
}

/** Labels of every field still blank, in print order. Empty array means "printable". */
export function missingCompanyFields(
  company: CompanyHeader | null | undefined
): string[] {
  if (!company) {
    return COMPANY_FIELDS.map((field) => field.label);
  }

  return COMPANY_FIELDS.filter((field) => !normalizeCompanyValue(company[field.key])).map(
    (field) => field.label
  );
}

export function isCompanyHeaderComplete(
  company: CompanyHeader | null | undefined
): company is CompanyHeader {
  return missingCompanyFields(company).length === 0;
}

/**
 * One sentence, used verbatim by the API response and the UI alert, so a cashier and a
 * support engineer read the same explanation of why a document was refused.
 */
export function companyHeaderProblemMessage(
  missing: string[],
  options: { hasRecord?: boolean } = {}
): string {
  if (missing.length === 0) {
    return "The company letterhead is complete.";
  }

  if (options.hasRecord === false) {
    return `Company letterhead is not set up - ${missing.join(", ")} ${
      missing.length === 1 ? "is" : "are"
    } missing. Complete the Company Profile before printing.`;
  }

  return `Company letterhead is incomplete - ${missing.join(", ")} ${
    missing.length === 1 ? "is" : "are"
  } missing. Complete the Company Profile before printing.`;
}
