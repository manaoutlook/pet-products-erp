/**
 * The issued-invoice record: one payload builder and one archive.
 *
 * AI Agent Note - three rules live in this file:
 *
 * 1. THE DOCUMENT IS BUILT FROM THE SALE, NOT FROM THE CATALOGUE.
 *    `buildInvoicePayload` reads `sales_transactions` + `sales_transaction_items` only. The
 *    seller block comes from the VAT company that issued the invoice, or - for a retail,
 *    non-VAT sale - from the Company Profile. Product code and description come from the line
 *    snapshots. Nothing joins the live `products` row, so renaming a product does not change
 *    a document that was already issued.
 *
 * 2. THE NUMBERS ARE READ, NEVER DERIVED.
 *    `subtotal` / `vatRate` / `vatAmount` / `total` are the stored columns. Deriving any of
 *    them (the old `total / 1.1` on reprint) is how the till, the database and the reprint
 *    ended up showing three different totals for one 100,000 sale.
 *
 * 3. THE ISSUED DOCUMENT IS ARCHIVED ONCE AND THEN RE-SERVED.
 *    The browser builds the print-ready A4 HTML and posts it back here on first issue;
 *    `uploads/invoices/<invoice number>.html` is written once and every later print opens
 *    that same file. The PDF is the browser's own "Save as PDF" of the archived document, so
 *    it cannot differ from what was issued.
 *
 *    AI Agent Note - why HTML and not a server-rendered PDF: there is no server-side PDF
 *    engine in this project, and jsPDF (the client library the till receipt uses) cannot
 *    render Vietnamese diacritics without embedding a TTF font. A PDF generated that way
 *    would print "H KINH DOANH" instead of "HỘ KINH DOANH", which is worse than useless on a
 *    tax invoice. One HTML renderer, archived verbatim, keeps the document and its PDF
 *    identical by construction.
 *
 * If the sale is cancelled or refunded, the payload carries the real status and the renderer
 * stamps CANCELLED across the page - see shared/invoice.ts. Corrections are re-issued as a
 * NEW sale under a NEW number; an issued invoice is never overwritten.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@db";
import { salesTransactions, vatCompanies } from "@db/schema";
import { eq } from "drizzle-orm";
import { getCompanyInfo } from "./company";
import {
  isCancelledStatus,
  invoiceStatusLabel,
  type InvoiceBuyer,
  type InvoiceLine,
  type InvoiceParty,
  type InvoicePayload,
} from "../shared/invoice";

/** Public URL prefix of the archive directory; also used to recognise stored files. */
export const INVOICE_ARCHIVE_URL_PREFIX = "/uploads/invoices/";

/** Absolute directory issued invoices are written to (created on first archive). */
export const invoiceArchiveDir = path.resolve(process.cwd(), "uploads", "invoices");

/** Largest issued document accepted from the browser (10 MB - an A4 page is far smaller). */
export const MAX_INVOICE_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** A client-correctable failure (unknown sale, bad PDF) as opposed to a crash. */
export class InvoiceDocumentError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "InvoiceDocumentError";
    this.status = status;
  }
}

/**
 * File name of an archived invoice.
 *
 * The invoice number is the identity of the document, so it *is* the file name - but it is
 * sanitised first: it comes out of the database, and a path separator in a file name would
 * let a row write outside the archive directory.
 */
export function invoiceArchiveFileName(invoiceNumber: string): string {
  return `${invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "_")}.html`;
}

/** The required seller fields of a VAT company, in the order the UI lists them. */
export function vatCompanyMissingFields(company: {
  name?: string | null;
  taxId?: string | null;
  address?: string | null;
}): string[] {
  const missing: string[] = [];
  if (!company.name?.trim()) missing.push("Company name");
  if (!company.taxId?.trim()) missing.push("Tax code");
  if (!company.address?.trim()) missing.push("Address");
  return missing;
}

/**
 * Build everything the A4 invoice and the till receipt print for one sale.
 *
 * Throws `InvoiceDocumentError(404)` when the sale does not exist.
 */
export async function buildInvoicePayload(transactionId: number): Promise<InvoicePayload> {
  const transaction = await db.query.salesTransactions.findFirst({
    where: eq(salesTransactions.id, transactionId),
    with: {
      items: true,
      store: true,
      cashierUser: true,
      customerProfile: true,
      vatCompany: true,
    },
  });

  if (!transaction) {
    throw new InvoiceDocumentError("Sales transaction not found", 404);
  }

  const vatCompany = transaction.vatCompany as typeof vatCompanies.$inferSelect | null;

  // Seller: the licensing company for a VAT invoice, the household letterhead otherwise.
  let seller: InvoiceParty;
  let sellerMissingFields: string[];

  if (vatCompany) {
    seller = {
      name: vatCompany.name,
      taxId: vatCompany.taxId,
      address: vatCompany.address,
      phone: vatCompany.phone,
      email: vatCompany.email,
      bankAccount: vatCompany.bankAccount,
    };
    sellerMissingFields = vatCompanyMissingFields(vatCompany);
  } else {
    const info = await getCompanyInfo();
    const record = info.record;
    seller = {
      name: record?.companyName ?? "",
      taxId: record?.taxId ?? "",
      address: record?.registeredAddress ?? "",
      phone: null,
      email: null,
      bankAccount: null,
    };
    sellerMissingFields = [...info.missingFields];
  }

  // Buyer: the snapshot taken when the sale was rung up. The live customer profile is only a
  // fallback for sales written before the buyer columns existed - never the other way round.
  const profile = transaction.customerProfile as {
    contactPerson?: string | null;
    companyName?: string | null;
    mobileNumber?: string | null;
    address?: string | null;
    email?: string | null;
  } | null;

  const buyerName = transaction.buyerName?.trim();
  const buyer: InvoiceBuyer | null = buyerName
    ? {
        name: buyerName,
        companyName: transaction.buyerCompanyName,
        taxId: transaction.buyerTaxId,
        address: transaction.buyerAddress,
        phone: transaction.buyerPhone,
        email: transaction.buyerEmail,
      }
    : profile
      ? {
          name: profile.contactPerson || profile.companyName || profile.mobileNumber || "Customer",
          companyName: profile.companyName ?? null,
          // customer_profiles has no tax-code column yet; a B2B VAT invoice needs one, so it
          // is left null here rather than guessed. Add the column and this mapping together.
          taxId: null,
          address: profile.address ?? null,
          phone: profile.mobileNumber ?? null,
          email: profile.email ?? null,
        }
      : null;

  const lines: InvoiceLine[] = transaction.items.map((item, index) => ({
    lineNumber: index + 1,
    // The snapshot is the authoritative text. The empty fallback covers sales written before
    // the snapshot columns existed - it must never fall back to the live product name.
    productCode: item.productCode?.trim() || "",
    description: item.description?.trim() || "(item description not recorded)",
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    lineTotal: Number(item.totalPrice),
  }));

  const notes: string[] = [];
  if (!transaction.printedWithVat) {
    notes.push("Retail sale - no VAT invoice issued.");
  }
  if (isCancelledStatus(transaction.status)) {
    notes.push(
      `This invoice was ${invoiceStatusLabel(transaction.status).toLowerCase()}. ` +
        "It is retained for the record only and is not a valid document."
    );
  }

  return {
    transactionId: transaction.id,
    invoiceNumber: transaction.invoiceNumber,
    invoiceDate: (transaction.transactionDate ?? transaction.createdAt ?? new Date()).toISOString(),
    kind: vatCompany ? "VAT" : "RETAIL",
    withVat: transaction.printedWithVat,
    status: transaction.status,
    seller,
    sellerMissingFields,
    buyer,
    lines,
    subtotal: Number(transaction.subtotal),
    vatRate: Number(transaction.vatRate),
    vatAmount: Number(transaction.vatAmount),
    total: Number(transaction.totalAmount),
    paymentMethod: transaction.paymentMethod,
    // Same widened relational type as the buyer block above; `one(users)` at runtime.
    cashierName:
      (transaction.cashierUser as { username?: string } | null)?.username ?? "Unknown",
    storeName: (transaction.store as { name?: string } | null)?.name ?? null,
    currency: "VND",
    archivedDocumentUrl: transaction.archivedDocumentUrl,
    archivedAt: transaction.archivedAt ? transaction.archivedAt.toISOString() : null,
    notes,
  };
}

export interface ArchiveInvoiceResult {
  url: string;
  /** False when the file already existed and the stored copy was kept untouched. */
  created: boolean;
}

/**
 * Store the print-ready document that was actually handed to the customer.
 *
 * Accepts the full A4 HTML document as produced by
 * `client/src/components/POS/InvoicePrint.tsx`. The first archive wins: if a document already
 * exists for this invoice number, the existing file and the stored URL are returned
 * unchanged. That is the immutability guarantee - a second print can never replace the
 * document that was issued.
 */
export async function archiveIssuedInvoiceDocument(
  transactionId: number,
  documentHtml: string
): Promise<ArchiveInvoiceResult> {
  const transaction = await db.query.salesTransactions.findFirst({
    where: eq(salesTransactions.id, transactionId),
    columns: { id: true, invoiceNumber: true, archivedDocumentUrl: true },
  });

  if (!transaction) {
    throw new InvoiceDocumentError("Sales transaction not found", 404);
  }

  if (transaction.archivedDocumentUrl) {
    return { url: transaction.archivedDocumentUrl, created: false };
  }

  const html = typeof documentHtml === "string" ? documentHtml.trim() : "";

  if (html.length === 0) {
    throw new InvoiceDocumentError("The invoice document is empty.");
  }
  if (Buffer.byteLength(html, "utf8") > MAX_INVOICE_DOCUMENT_BYTES) {
    throw new InvoiceDocumentError("The invoice document is too large to archive.");
  }
  // Only a complete HTML document is accepted; this keeps arbitrary uploads out of the
  // archive directory and guarantees the file can be opened and printed later.
  if (!/^<!doctype html>/i.test(html) && !/^<html[\s>]/i.test(html)) {
    throw new InvoiceDocumentError("The invoice document must be a complete HTML document.");
  }

  await fs.mkdir(invoiceArchiveDir, { recursive: true });

  const fileName = invoiceArchiveFileName(transaction.invoiceNumber);
  const absolutePath = path.join(invoiceArchiveDir, fileName);
  const url = `${INVOICE_ARCHIVE_URL_PREFIX}${fileName}`;

  // `wx` = create, fail if it exists. Two tills archiving the same sale at once: the loser
  // keeps the winner's file rather than overwriting it.
  try {
    await fs.writeFile(absolutePath, html, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "EEXIST") throw error;
  }

  await db
    .update(salesTransactions)
    .set({ archivedDocumentUrl: url, archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(salesTransactions.id, transactionId));

  return { url, created: true };
}
