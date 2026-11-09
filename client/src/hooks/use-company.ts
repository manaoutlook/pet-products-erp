import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  missingCompanyFields,
  toCompanyHeader,
  type CompanyHeader,
} from "@shared/company";

/**
 * The one company letterhead the whole UI reads.
 *
 * Both the screen header (`components/company/CompanyHeader.tsx`) and every print action
 * call this hook, so the band on screen and the header on paper come from the same query,
 * the same cache entry and the same completeness rule. A single `PUT /api/company`
 * invalidates this key and both update at once - there is no second copy to keep in sync.
 */

export interface CompanyInfoPayload {
  company: (CompanyHeader & { id: number; updatedAt?: string | null }) | null;
  header: CompanyHeader | null;
  valid: boolean;
  missingFields: string[];
  message?: string;
}

export const COMPANY_QUERY_KEY = ["/api/company"] as const;

export function useCompanyInfo() {
  const query = useQuery<CompanyInfoPayload>({ queryKey: COMPANY_QUERY_KEY });

  // The fetch stub used by some page tests answers every unknown URL with `[]`; treat any
  // non-object payload as "no letterhead yet" instead of letting it reach a renderer.
  const payload =
    query.data && typeof query.data === "object" && !Array.isArray(query.data)
      ? query.data
      : null;

  const company = useMemo(
    () => (payload ? toCompanyHeader(payload.company) : null),
    [payload]
  );
  const missingFields = useMemo(() => missingCompanyFields(company), [company]);

  return {
    ...query,
    /** Trimmed letterhead, or `null` when the company row does not exist yet. */
    company,
    /** Labels of the blank fields - empty means every document may print. */
    missingFields,
    valid: missingFields.length === 0,
  };
}
