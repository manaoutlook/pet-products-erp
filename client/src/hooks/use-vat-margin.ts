import { useQuery } from "@tanstack/react-query";
import type {
  VatMarginIssue,
  VatMarginLine,
  VatMarginParams,
  VatMarginTotals,
} from "@shared/vat-margin";

/**
 * The VAT Margin Calculator's data.
 *
 * Three reads, one per thing the screen shows: the saved defaults (the rate fields), the
 * documents that can be picked, and the statement for the picked document.
 *
 * AI Agent Note: the arithmetic is NOT duplicated here. Changing a rate field re-asks
 * `/api/vat-margin/statement`, so the numbers on screen are the numbers the server computed and
 * the printed PDF cannot disagree with what was reviewed. Every query owns its `queryFn` so the
 * server's explanation (a missing price, a document that no longer exists) reaches the page
 * instead of the generic "500: Internal Server Error" the default fetch drops.
 */

export type VatMarginDocumentType = "sales_order" | "delivery_note" | "invoice";

export interface VatMarginDocument {
  /** The id to send back to `/statement` (the delivery note id for a delivery note). */
  id: number;
  type: VatMarginDocumentType;
  reference: string;
  description: string;
  date: string | null;
  salesOrderId: number;
}

export interface VatMarginSettings {
  incomeTaxRate: number;
  profitMarginRate: number;
  serviceFeeRate: number;
}

export interface VatMarginStatementDocument {
  id: number;
  type: VatMarginDocumentType;
  typeLabel: string;
  reference: string;
  orderNumber: string;
  invoiceNumber: string | null;
  customerName: string;
  companyName: string | null;
  contactPerson: string | null;
  orderDate: string | null;
  vatCompanyName: string | null;
  vatCompanyTaxId: string | null;
  vatCompanyAddress: string | null;
}

export interface VatMarginStatement {
  document: VatMarginStatementDocument;
  lines: VatMarginLine[];
  totals: VatMarginTotals;
  params: VatMarginParams;
  errors: VatMarginIssue[];
}

export class VatMarginRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "VatMarginRequestError";
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as Record<string, unknown>);
    const message =
      typeof body.message === "string" && body.message
        ? body.message
        : `Request failed (${response.status})`;
    const suggestion = typeof body.suggestion === "string" && body.suggestion ? body.suggestion : "";
    throw new VatMarginRequestError(suggestion ? `${message} ${suggestion}` : message, response.status);
  }
  return (await response.json()) as T;
}

export const VAT_MARGIN_SETTINGS_KEY = ["/api/vat-margin/settings"] as const;
export const vatMarginDocumentsKey = (type: VatMarginDocumentType) =>
  ["/api/vat-margin/documents", type] as const;

export function useVatMarginSettings() {
  return useQuery<VatMarginSettings>({
    queryKey: VAT_MARGIN_SETTINGS_KEY,
    queryFn: async () => {
      const payload = await getJson<{ settings: VatMarginSettings }>("/api/vat-margin/settings");
      return payload.settings;
    },
  });
}

export function useVatMarginDocuments(type: VatMarginDocumentType) {
  const query = useQuery<VatMarginDocument[]>({
    queryKey: vatMarginDocumentsKey(type),
    queryFn: async () => {
      const payload = await getJson<{ documents: VatMarginDocument[] }>(
        `/api/vat-margin/documents?type=${type}`
      );
      return Array.isArray(payload.documents) ? payload.documents : [];
    },
  });

  return { ...query, documents: query.data ?? [] };
}

export interface VatMarginRates {
  profitMarginRate: number;
  incomeTaxRate: number;
  serviceFeeRate: number;
}

export function useVatMarginStatement(
  type: VatMarginDocumentType,
  id: number | null,
  rates: VatMarginRates
) {
  return useQuery<VatMarginStatement>({
    queryKey: ["/api/vat-margin/statement", type, id, rates],
    enabled: id !== null && Number.isFinite(id),
    queryFn: async () => {
      const params = new URLSearchParams({
        type,
        id: String(id),
        profitMarginRate: String(rates.profitMarginRate),
        incomeTaxRate: String(rates.incomeTaxRate),
        serviceFeeRate: String(rates.serviceFeeRate),
      });
      return getJson<VatMarginStatement>(`/api/vat-margin/statement?${params.toString()}`);
    },
  });
}

/** Save the global defaults. The calculator calls this from "Save as defaults". */
export async function saveVatMarginSettings(rates: VatMarginRates): Promise<VatMarginSettings> {
  const response = await fetch("/api/vat-margin/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(rates),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as Record<string, unknown>);
    throw new VatMarginRequestError(
      typeof body.message === "string" && body.message
        ? body.message
        : "Failed to save the VAT margin settings",
      response.status
    );
  }

  const payload = (await response.json()) as { settings: VatMarginSettings };
  return payload.settings;
}
