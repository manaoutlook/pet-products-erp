import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

/**
 * The companies a VAT invoice may be issued under (CI / HI).
 *
 * AI Agent Note: `HỘ KINH DOANH TIỆN ÍCH GIA ĐÌNH` is a household business and cannot issue a
 * VAT invoice, so the POS asks "print with VAT?" and then makes the cashier pick one of these.
 * The list is one query shared by the POS dialog and the VAT Companies screen; saving a company
 * invalidates `VAT_COMPANIES_QUERY_KEY` and both update at once.
 */

export interface VatCompany {
  id: number;
  code: string;
  name: string;
  taxId: string;
  address: string;
  phone: string | null;
  email: string | null;
  bankAccount: string | null;
  isActive: boolean;
  /** Labels still blank - while non-empty the company cannot issue a valid VAT invoice. */
  missingFields: string[];
}

export interface VatCompaniesPayload {
  companies: VatCompany[];
}

export const VAT_COMPANIES_QUERY_KEY = ["/api/vat-companies"] as const;

export function useVatCompanies() {
  const query = useQuery<VatCompaniesPayload>({
    queryKey: VAT_COMPANIES_QUERY_KEY,
    // AI Agent Note: the default queryFn throws `500: Internal Server Error` for any 5xx and
    // drops the body, which hides the one message that actually helps ("the table is missing -
    // run npm run db:push"). This screen owns its own queryFn so the server's explanation
    // reaches the page.
    queryFn: async () => {
      const response = await fetch("/api/vat-companies", { credentials: "include" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}) as Record<string, unknown>);
        const message =
          typeof body.message === "string" && body.message
            ? body.message
            : `Failed to load VAT companies (${response.status})`;
        const suggestion = typeof body.suggestion === "string" && body.suggestion ? body.suggestion : "";
        throw new Error(suggestion ? `${message} ${suggestion}` : message);
      }
      return (await response.json()) as VatCompaniesPayload;
    },
  });

  // A fetch stub in some page tests answers unknown URLs with `[]`; treat anything that is not
  // the expected object as "no companies configured" instead of letting it reach a renderer.
  const payload =
    query.data && typeof query.data === "object" && !Array.isArray(query.data)
      ? query.data
      : null;

  const companies = useMemo(() => (payload?.companies ?? []), [payload]);
  const activeCompanies = useMemo(
    () => companies.filter((company) => company.isActive),
    [companies]
  );

  return {
    ...query,
    companies,
    activeCompanies,
    /** True when at least one company can actually issue a VAT invoice today. */
    hasUsableCompany: activeCompanies.some((company) => company.missingFields.length === 0),
  };
}
