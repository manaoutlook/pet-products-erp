import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, ExternalLink, Loader2, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDateTime, formatPercent, formatQuantity } from "@/utils/format";
import {
  buildPrintDocument,
  escapeHtml,
  openPrintDocument,
  printValue,
} from "@/utils/print-document";
import { isCancelledStatus, invoiceStatusLabel, type InvoicePayload } from "@shared/invoice";

/**
 * The A4 tax invoice / retail invoice.
 *
 * AI Agent Note - this renderer is deliberately dumb: every value it prints already exists on
 * the payload built by `server/invoice-documents.ts` from the STORED sale. It reads nothing
 * from the catalogue, the company profile or the cart, and it does no arithmetic on the
 * totals. That is what makes the till receipt, this document and a reprint next year agree:
 *
 *   - seller  = the VAT company that issued the invoice (CI/HI), or the household letterhead
 *               for a non-VAT retail sale;
 *   - buyer   = the customer profile recorded on the sale (a VAT invoice without it is not a
 *               valid document, so printing is blocked while it is missing);
 *   - lines   = the product code/description SNAPSHOTS taken when the sale was written;
 *   - totals  = subtotal / vatRate / vatAmount / total as stored. No `* 0.1`, no `/ 1.1`.
 *
 * Cancelled or refunded sales are stamped CANCELLED. A correction is never an edit: cancel
 * the wrong invoice, then invoice the correction as a new sale under a new number.
 *
 * The same HTML string is what gets archived (`uploads/invoices/<number>.html`) and what the
 * user prints, so a reprint cannot differ from the issued copy.
 */

/** Extra sheet CSS on top of the shared A4 styles. */
const INVOICE_STYLES = `
  .invoice-title { font-size: 16px; letter-spacing: 3px; margin: 10px 0 2px; text-align: center; }
  .invoice-subtitle { font-size: 10px; text-align: center; color: #333; margin-bottom: 10px; }
  .party { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
  .party-box { border: 1px solid #000; padding: 6px 8px; }
  .party-box h3 { margin: 0 0 4px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
  .party-box div { font-size: 10.5px; }
  .totals { margin-top: 8px; display: flex; justify-content: flex-end; }
  .totals table { width: 62%; }
  .totals td { border: none; padding: 3px 6px; }
  .totals tr.grand td { border-top: 2px solid #000; font-weight: bold; font-size: 12px; }
  .notes-line { margin-top: 8px; font-size: 10px; color: #333; }
  .stamp {
    position: fixed;
    top: 42%;
    left: 12%;
    right: 12%;
    text-align: center;
    font-size: 64px;
    font-weight: bold;
    letter-spacing: 8px;
    color: rgba(200, 0, 0, 0.28);
    border: 6px solid rgba(200, 0, 0, 0.28);
    padding: 10px 0;
    transform: rotate(-18deg);
    pointer-events: none;
  }
`;

function partyLine(label: string, value: unknown): string {
  return `<div><span class="label">${escapeHtml(label)}:</span> ${printValue(value)}</div>`;
}

/**
 * Build the complete A4 document for one invoice.
 *
 * Pure function - no React, no fetch - so the preview, the print and the archived copy all
 * come from the exact same string.
 */
export function buildInvoiceDocumentHtml(invoice: InvoicePayload): string {
  const rows = invoice.lines
    .map(
      (line) => `
        <tr>
          <td class="center">${line.lineNumber}</td>
          <td>${printValue(line.productCode)}</td>
          <td>${printValue(line.description)}</td>
          <td class="num">${escapeHtml(formatQuantity(line.quantity))}</td>
          <td class="num">${escapeHtml(formatCurrency(line.unitPrice))}</td>
          <td class="num">${escapeHtml(formatCurrency(line.lineTotal))}</td>
        </tr>`
    )
    .join('');

  const buyer = invoice.buyer;
  const buyerBlock = `
    <div class="party-box">
      <h3>Buyer</h3>
      ${partyLine('Name', buyer?.name)}
      ${partyLine('Company', buyer?.companyName)}
      ${partyLine('Tax code', buyer?.taxId)}
      ${partyLine('Address', buyer?.address)}
      ${partyLine('Phone', buyer?.phone)}
    </div>`;

  const sellerBlock = `
    <div class="party-box">
      <h3>Seller</h3>
      ${partyLine('Company', invoice.seller.name)}
      ${partyLine('Tax code', invoice.seller.taxId)}
      ${partyLine('Address', invoice.seller.address)}
      ${invoice.seller.phone ? partyLine('Phone', invoice.seller.phone) : ''}
      ${invoice.seller.bankAccount ? partyLine('Bank account', invoice.seller.bankAccount) : ''}
    </div>`;

  // VAT is shown only when it was actually charged. A retail sale prints "No VAT" instead of a
  // misleading 0% line, because the household business cannot issue a VAT invoice at all.
  const vatRows = invoice.withVat
    ? `
        <tr>
          <td class="label">VAT (${escapeHtml(formatPercent(invoice.vatRate))})</td>
          <td class="num">${escapeHtml(formatCurrency(invoice.vatAmount))}</td>
        </tr>`
    : `
        <tr>
          <td class="label">VAT</td>
          <td class="num">No VAT invoice issued</td>
        </tr>`;

  const notes = invoice.notes.length
    ? `<div class="notes-line">${invoice.notes.map((note) => escapeHtml(note)).join('<br />')}</div>`
    : '';

  const stamp = isCancelledStatus(invoice.status) ? `<div class="stamp">CANCELLED</div>` : '';

  const body = `
    ${stamp}
    <div class="company-header">
      <div class="company-name">${printValue(invoice.seller.name)}</div>
      <div class="company-line">${printValue(invoice.seller.address)}</div>
      <div class="company-line">
        <span class="company-field-label">Tax ID:</span> ${printValue(invoice.seller.taxId)}
      </div>
    </div>

    <h1 class="invoice-title">${invoice.kind === 'VAT' ? 'VAT INVOICE' : 'SALES INVOICE'}</h1>
    <div class="invoice-subtitle">
      ${escapeHtml(invoice.withVat ? 'Hóa đơn giá trị gia tăng' : 'Hóa đơn bán hàng')}
    </div>

    <div class="meta">
      <div><span class="label">Invoice No:</span> ${printValue(invoice.invoiceNumber)}</div>
      <div><span class="label">Date:</span> ${printValue(formatDateTime(invoice.invoiceDate))}</div>
      <div><span class="label">Status:</span> ${escapeHtml(invoiceStatusLabel(invoice.status))}</div>
    </div>

    <div class="party">
      ${sellerBlock}
      ${buyerBlock}
    </div>

    <table>
      <thead>
        <tr>
          <th class="center" style="width: 34px;">No</th>
          <th style="width: 110px;">Product Code</th>
          <th>Description</th>
          <th class="num" style="width: 60px;">Qty</th>
          <th class="num" style="width: 100px;">Unit Price</th>
          <th class="num" style="width: 110px;">Amount</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6">&nbsp;</td></tr>'}</tbody>
    </table>

    <div class="totals">
      <table>
        <tr>
          <td class="label">Subtotal (excl. VAT)</td>
          <td class="num">${escapeHtml(formatCurrency(invoice.subtotal))}</td>
        </tr>
        ${vatRows}
        <tr class="grand">
          <td>Total</td>
          <td class="num">${escapeHtml(formatCurrency(invoice.total))}</td>
        </tr>
      </table>
    </div>

    ${notes}

    <div class="grid" style="margin-top: 10px;">
      <div><span class="label">Payment Method:</span> ${printValue(invoice.paymentMethod)}</div>
      <div><span class="label">Cashier:</span> ${printValue(invoice.cashierName)}</div>
      <div><span class="label">Store:</span> ${printValue(invoice.storeName)}</div>
      <div><span class="label">Currency:</span> ${escapeHtml(invoice.currency)}</div>
    </div>

    <div class="signatures">
      <div class="signature">
        <div class="role">Seller</div>
        <div class="hint">Signature &amp; Stamp:</div>
        <div class="line">&nbsp;</div>
      </div>
      <div class="signature">
        <div class="role">Buyer</div>
        <div class="hint">Signature:</div>
        <div class="line">&nbsp;</div>
      </div>
    </div>

    <div class="footer">
      ${escapeHtml(invoice.invoiceNumber)} &middot; Issued once and archived - a reprint is
      always this same document.
    </div>`;

  // The shared A4 stylesheet first, then the invoice-only rules.
  return buildPrintDocument(`Invoice ${invoice.invoiceNumber}`, body).replace(
    '</style>',
    `${INVOICE_STYLES}</style>`
  );
}

/**
 * Why an invoice may not be printed yet, or `null` when it may.
 *
 * A VAT invoice is only valid with a seller (company name, tax code, address) and a buyer.
 * The seller side is enforced when the sale is created (server/sales.ts) and re-checked here
 * because the company details can be edited after the fact.
 */
export function invoicePrintBlocker(invoice: InvoicePayload): string | null {
  if (invoice.sellerMissingFields.length > 0) {
    return `The seller details are incomplete (${invoice.sellerMissingFields.join(', ')}). ` +
      'Complete them in the Company Profile or VAT Companies screen.';
  }
  if (invoice.withVat && !invoice.buyer?.name?.trim()) {
    return 'A VAT invoice needs a buyer. Enter the buyer details at checkout before completing the sale.';
  }
  return null;
}

/**
 * Archive the document that is being issued.
 *
 * Called once, the first time the invoice is shown. The server keeps the first copy, so a
 * later call answers `created: false` and the stored URL is unchanged.
 */
export async function archiveInvoiceDocument(
  transactionId: number,
  documentHtml: string
): Promise<{ archivedDocumentUrl: string; created: boolean }> {
  const response = await fetch(`/api/sales-transactions/${transactionId}/invoice/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ document: documentHtml }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to archive the invoice');
  }

  return response.json();
}

/**
 * The document to put on paper: the archived copy if one exists, the freshly built HTML
 * otherwise.
 *
 * Printing the archived copy is the point of archiving - even if the code that builds the
 * document changes, the file that was issued is what comes out of the printer.
 */
async function resolvePrintableHtml(invoice: InvoicePayload): Promise<string> {
  if (invoice.archivedDocumentUrl) {
    try {
      const response = await fetch(invoice.archivedDocumentUrl, { credentials: 'include' });
      if (response.ok) return await response.text();
    } catch (error) {
      // A missing archive file must never block a reprint.
      console.error('Could not read the archived invoice document:', error);
    }
  }
  return buildInvoiceDocumentHtml(invoice);
}

/** Open the document in a new tab, where the browser can print it or save a PDF. */
function openDocumentInNewTab(html: string): boolean {
  if (typeof window === 'undefined') return false;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank');
  if (!opened) {
    URL.revokeObjectURL(url);
    return false;
  }
  // The tab needs the URL long enough to load the document.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
interface InvoicePrintDialogProps {
  /** The payload from `GET /api/sales-transactions/:id/invoice`, or null while loading. */
  invoice: InvoicePayload | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shows a spinner instead of the preview. */
  loading?: boolean;
  /** Called after a first archive, so the caller can refresh the transaction row. */
  onArchived?: () => void;
}

/**
 * A4 invoice preview + print.
 *
 * The preview is the print document itself in an iframe, so what the user sees is exactly what
 * the printer receives. The document is archived when the dialog opens (not when Print is
 * clicked): the copy that gets stored is the one the cashier is looking at, so a customer who
 * walks away with the paper still has a stored document behind it.
 */
export function InvoicePrintDialog({
  invoice,
  open,
  onOpenChange,
  loading = false,
  onArchived,
}: InvoicePrintDialogProps) {
  const { toast } = useToast();
  const [documentHtml, setDocumentHtml] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const blocker = invoice ? invoicePrintBlocker(invoice) : null;
  const canPrint = Boolean(invoice) && blocker === null;

  // Build (or load the archived copy of) the document for the preview.
  useEffect(() => {
    let cancelled = false;

    if (!open || !invoice || blocker) {
      setDocumentHtml(null);
      return () => { cancelled = true; };
    }

    (async () => {
      const html = await resolvePrintableHtml(invoice);
      if (!cancelled) setDocumentHtml(html);
    })();

    return () => { cancelled = true; };
  }, [open, invoice, blocker]);

  // Archive on first open. A failure is reported but never blocks printing: the sale is already
  // complete and a paper copy must still be possible.
  useEffect(() => {
    let cancelled = false;

    if (!open || !invoice || blocker || invoice.archivedDocumentUrl) {
      return () => { cancelled = true; };
    }

    (async () => {
      setArchiving(true);
      try {
        const result = await archiveInvoiceDocument(
          invoice.transactionId,
          buildInvoiceDocumentHtml(invoice)
        );
        if (!cancelled && result.created) onArchived?.();
      } catch (error) {
        console.error('Invoice archive failed:', error);
        if (!cancelled) {
          toast({
            title: "Invoice not archived",
            description: error instanceof Error ? error.message : 'Unknown error',
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setArchiving(false);
      }
    })();

    return () => { cancelled = true; };
    // `invoice` identity changes after the archive; the re-run is a no-op because the refreshed
    // payload carries `archivedDocumentUrl`.
  }, [open, invoice, blocker, onArchived, toast]);

  const handlePrint = useCallback(async () => {
    if (!invoice) return;

    if (!canPrint) {
      toast({
        title: "Invoice cannot be printed",
        description: blocker ?? 'The invoice is still loading',
        variant: "destructive",
      });
      return;
    }

    const html = documentHtml ?? (await resolvePrintableHtml(invoice));
    if (!openPrintDocument(html)) {
      toast({
        title: "Print Blocked",
        description: "Allow pop-ups for this site to print the invoice",
        variant: "destructive",
      });
    }
  }, [invoice, canPrint, blocker, documentHtml, toast]);

  const handleOpenInTab = useCallback(async () => {
    if (!invoice) return;
    const html = documentHtml ?? (await resolvePrintableHtml(invoice));
    if (!openDocumentInNewTab(html)) {
      toast({
        title: "Pop-up blocked",
        description: "Allow pop-ups for this site to open the invoice document",
        variant: "destructive",
      });
    }
  }, [invoice, documentHtml, toast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {invoice ? `Invoice ${invoice.invoiceNumber}` : 'Invoice'}
            {invoice?.withVat ? ' (VAT)' : ''}
          </DialogTitle>
          <DialogDescription>
            A4 preview of the issued document. It is archived when it first opens, so every
            later reprint is identical - use your browser's "Save as PDF" for a PDF copy.
          </DialogDescription>
        </DialogHeader>

        {loading || (!documentHtml && canPrint) ? (
          <div className="flex h-[50vh] items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Preparing the invoice...
          </div>
        ) : !canPrint ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Invoice cannot be printed</AlertTitle>
            <AlertDescription>{blocker}</AlertDescription>
          </Alert>
        ) : (
          <iframe
            title={invoice ? `Invoice ${invoice.invoiceNumber}` : 'Invoice'}
            srcDoc={documentHtml ?? ''}
            className="h-[70vh] w-full rounded-md border bg-white"
          />
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {archiving
              ? 'Archiving the issued copy...'
              : invoice?.archivedDocumentUrl
                ? `Archived ${invoice.archivedAt ? formatDateTime(invoice.archivedAt) : ''}`
                : ''}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleOpenInTab} disabled={!canPrint}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open / Save as PDF
            </Button>
            <Button onClick={handlePrint} disabled={!canPrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default InvoicePrintDialog;


