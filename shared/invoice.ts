/**
 * The invoice document contract (shared by the server that shapes it and the browser that
 * renders it).
 *
 * AI Agent Note - the whole point of this file:
 * An invoice is a legal document, not a view over live data. Everything printed comes from
 * what was STORED on the sale (`sales_transactions` + `sales_transaction_items`), never from
 * the current product catalogue or the current company profile:
 *
 *   - the seller block is the VAT company that issued the invoice, or the Company Profile
 *     letterhead for a retail (non-VAT) sale;
 *   - every line's code and description is the snapshot taken at sale time;
 *   - subtotal / vatRate / vatAmount / total are the numbers stored on the sale.
 *
 * So the same document prints the same way today, tomorrow and after a product rename.
 * A correction is never an edit: the wrong invoice is cancelled (status voided/refunded,
 * stamped as such on reprint) and a NEW sale is invoiced under a NEW number. That is the
 * re-issuance rule recorded here and in db/schema.ts + server/sales.ts.
 *
 * Why no credit note yet: a refund/cancellation is fully traceable (transaction status +
 * `sales_transaction_actions` audit rows + the voided invoice copy), and the owner has not
 * asked for a separate credit-note document. If one is ever needed it must be a new
 * sequence and a new document - do not let a reprint imply a credit note that was never
 * issued.
 */

/** Prefix of each VAT company's invoice sequence. Fixed: the tax books are already printed. */
export const VAT_INVOICE_PREFIXES: Record<string, string> = {
  CI: "CI",
  HI: "HI",
};

/** The two licensed companies. Seeded by migration 0022; edited from the VAT Companies menu. */
export const VAT_COMPANY_SEEDS = [
  { code: "CI", name: "Conqueror International" },
  { code: "HI", name: "Hasim International" },
] as const;

export type InvoiceKind = "RETAIL" | "VAT";

/** Seller block, exactly as it must appear on paper. */
export interface InvoiceParty {
  name: string;
  taxId: string;
  address: string;
  phone?: string | null;
  email?: string | null;
  bankAccount?: string | null;
}

/** Buyer block. A VAT invoice is invalid without it, so the UI blocks printing when empty. */
export interface InvoiceBuyer {
  name: string;
  companyName?: string | null;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface InvoiceLine {
  lineNumber: number;
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/**
 * Everything the A4 invoice and the till receipt need, and nothing else.
 *
 * `storedTotals` is the contract with the database: the renderer prints these numbers and
 * must never derive one from another (no `total / 1.1`).
 */
export interface InvoicePayload {
  transactionId: number;
  invoiceNumber: string;
  invoiceDate: string; // ISO timestamp of the sale
  kind: InvoiceKind;
  withVat: boolean;
  /** 'completed' | 'refunded' | 'voided' - anything else is stamped as cancelled. */
  status: string;
  seller: InvoiceParty;
  /** Fields the seller block is missing; while non-empty a VAT invoice must not print. */
  sellerMissingFields: string[];
  buyer: InvoiceBuyer | null;
  lines: InvoiceLine[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  paymentMethod: string;
  cashierName: string;
  storeName: string | null;
  currency: "VND";
  /** Archived copy of the issued PDF (`/uploads/invoices/...`), or null before first print. */
  archivedDocumentUrl: string | null;
  archivedAt: string | null;
  /** Extra note lines printed under the totals (e.g. why a document is void). */
  notes: string[];
}

/** True when the document must be stamped CANCELLED instead of looking like a valid invoice. */
export function isCancelledStatus(status: string): boolean {
  return status !== "completed";
}

export function invoiceStatusLabel(status: string): string {
  switch (status) {
    case "refunded":
      return "CANCELLED / REFUNDED";
    case "voided":
      return "CANCELLED / VOID";
    default:
      return "COMPLETED";
  }
}
