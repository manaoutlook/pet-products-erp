import { formatCurrency, formatDateTime } from "@/utils/format";
import {
  buildPrintDocument,
  escapeHtml,
  openPrintDocument,
  printValue,
} from "@/utils/print-document";
import { buildDocumentCompanyHeader } from "@/components/company/CompanyHeader";
import { documentVatCompanyLetterhead } from "@shared/vat-company";
import type { CompanyHeader } from "@shared/company";

/**
 * The customer payment receipt (`RCPT-…`), printed on paper.
 *
 * AI Agent Note - this is NOT the till receipt. The till receipt (`components/POS/ReceiptPrinter.tsx`)
 * proves a SALE and carries the shop's letterhead; this document proves that money was RECEIVED
 * against an invoice, so it prints under the letterhead of whoever issued that invoice - the VAT
 * company (Conqueror International / HI) for a VAT invoice, the Company Profile for a retail one.
 * That is why the numbers must come from the stored invoice/receipt rows and never be recomputed
 * here: `amount`, `paidBefore` and `balanceAfter` are read off the receipt register by
 * `server/payments.ts::listReceipts`, so a reprint in five years matches the paper the customer
 * walked out with.
 *
 * Every value is escaped: a buyer name or reference containing `&`/`<` must not break the sheet.
 */

/** One row of `GET /api/invoice-payments` - only the fields this document prints. */
export interface CustomerReceipt {
  id: number;
  receiptNumber: string;
  amount: number;
  paymentMethod: string;
  paidAt: string | Date;
  reference: string | null;
  notes: string | null;
  voided: boolean;
  voidedAt: string | Date | null;
  voidReason: string | null;
  receivedBy: { id: number; username: string } | null;
  store: { id: number; name: string } | null;
  paidBefore: number;
  balanceAfter: number;
  invoice: {
    id: number;
    invoiceNumber: string;
    source: string;
    kind: string;
    buyerName: string;
    subtotal: number;
    vatRate: number;
    vatAmount: number;
    totalAmount: number;
    orderNumber: string | null;
    vatCompany: {
      id: number;
      name: string;
      taxId: string;
      address: string;
    } | null;
  };
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  DIGITAL_WALLET: "Digital wallet",
  OTHER: "Other",
};

const VOID_STAMP_STYLE = [
  "position:fixed",
  "top:38%",
  "left:10%",
  "right:10%",
  "text-align:center",
  "font-size:56px",
  "font-weight:bold",
  "letter-spacing:8px",
  "color:rgba(200,0,0,0.28)",
  "border:6px solid rgba(200,0,0,0.28)",
  "padding:8px 0",
  "transform:rotate(-16deg)",
  "pointer-events:none",
].join(";");

function field(label: string, value: unknown): string {
  return `<div><span class="label">${escapeHtml(label)}:</span> ${printValue(value)}</div>`;
}

/**
 * Build the complete printable document for one receipt.
 *
 * Pure function - no React, no fetch - so the preview, the print and any future archive all
 * come from the same string. `fallbackCompany` is the Company Profile (`useCompanyInfo()`); it
 * is only used when the invoice was not issued by a VAT company.
 */
export function buildPaymentReceiptDocument(
  receipt: CustomerReceipt,
  fallbackCompany?: CompanyHeader | null
): string {
  const letterhead = documentVatCompanyLetterhead(receipt.invoice.vatCompany, fallbackCompany);
  // Throws CompanyHeaderError when the issuing letterhead is incomplete: a receipt without a
  // name/tax code is not a document, so printing is blocked rather than filled with blanks.
  const header = buildDocumentCompanyHeader(letterhead);

  const method = PAYMENT_METHOD_LABELS[receipt.paymentMethod] ?? receipt.paymentMethod;
  const receivedBy = receipt.receivedBy?.username?.trim() || "—";
  const issuedBy = receipt.invoice.vatCompany
    ? `${receipt.invoice.vatCompany.name} · Tax ID ${receipt.invoice.vatCompany.taxId}`
    : "Shop (retail invoice)";
  const receivedWithStore = receipt.store
    ? `${receivedBy} (${receipt.store.name})`
    : receivedBy;

  const voidBlock = receipt.voided
    ? `
      <div style="${VOID_STAMP_STYLE}">VOIDED</div>
      <div class="notes">
        <span class="label">Voided:</span> ${printValue(
          receipt.voidedAt ? formatDateTime(receipt.voidedAt) : ""
        )}
        &nbsp; <span class="label">Reason:</span> ${printValue(receipt.voidReason)}
      </div>`
    : "";

  const notesBlock = receipt.notes?.trim()
    ? `<div class="notes"><span class="label">Notes:</span> ${printValue(receipt.notes)}</div>`
    : "";

  return buildPrintDocument(
    `Receipt ${receipt.receiptNumber}`,
    `
    ${header}

    <h1>PAYMENT RECEIPT</h1>
    <p class="subtitle">Phiếu thu tiền · Receipt No ${printValue(receipt.receiptNumber)}</p>

    <div class="meta">
      ${field("Receipt No", receipt.receiptNumber)}
      ${field("Date", formatDateTime(receipt.paidAt))}
    </div>
    <div class="meta">
      ${field("Invoice No", receipt.invoice.invoiceNumber)}
      ${field("Sales Order", receipt.invoice.orderNumber)}
    </div>
    <div class="meta">
      ${field("Received from", receipt.invoice.buyerName)}
      ${field("Payment method", method)}
    </div>
    <div class="meta">
      ${field("Issued by", issuedBy)}
      ${field("Received by", receivedWithStore)}
    </div>
    <div class="meta">
      ${field("Reference", receipt.reference)}
      ${field("Store", receipt.store?.name)}
    </div>

    <div class="section-title">Payment</div>
    <table>
      <thead>
        <tr>
          <th>Invoice</th>
          <th class="num">Invoice total</th>
          <th class="num">Paid before this receipt</th>
          <th class="num">This receipt</th>
          <th class="num">Balance remaining</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${printValue(receipt.invoice.invoiceNumber)}</td>
          <td class="num">${escapeHtml(formatCurrency(receipt.invoice.totalAmount))}</td>
          <td class="num">${escapeHtml(formatCurrency(receipt.paidBefore))}</td>
          <td class="num"><strong>${escapeHtml(formatCurrency(receipt.amount))}</strong></td>
          <td class="num">${escapeHtml(formatCurrency(receipt.balanceAfter))}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3">Amount received</td>
          <td class="num">${escapeHtml(formatCurrency(receipt.amount))}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>

    <p class="confirmation">
      Received the amount stated above against invoice
      <strong>${printValue(receipt.invoice.invoiceNumber)}</strong>. This receipt does not change
      the invoice: it pays it down by the amount above, and the balance shown on the last line is
      what is still owed.
    </p>

    ${notesBlock}
    ${voidBlock}

    <div class="signatures">
      <div class="signature">
        <div class="role">Payer</div>
        <div class="hint">Signature &amp; full name</div>
        <div class="line">${printValue(receipt.invoice.buyerName)}</div>
      </div>
      <div class="signature">
        <div class="role">Received by</div>
        <div class="hint">Signature &amp; stamp</div>
        <div class="line">${printValue(receivedWithStore)}</div>
      </div>
    </div>

    <div class="footer">
      A receipt is written once and never edited. A correction is a void, and money returned is a
      separate document.
    </div>
  `
  );
}

/** Print one receipt; `false` means the browser blocked the print window. */
export function printPaymentReceipt(
  receipt: CustomerReceipt,
  fallbackCompany?: CompanyHeader | null
): boolean {
  return openPrintDocument(buildPaymentReceiptDocument(receipt, fallbackCompany));
}
