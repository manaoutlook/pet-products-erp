import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, FileText, Loader2, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDateTime, formatPercent, formatQuantity } from "@/utils/format";
import { buildPrintDocument, escapeHtml, openPrintDocument, printValue } from "@/utils/print-document";
import { buildDocumentCompanyHeader } from "@/components/company/CompanyHeader";
import { vatCompanyLetterhead } from "@shared/vat-company";
import type { SalesOrderInvoicePayload } from "@shared/invoice";

/** The order row this dialog belongs to - only what the screen already has. */
export interface SalesOrderInvoiceTarget {
  id: number;
  orderNumber: string;
  vatCompanyId?: number | null;
  status?: string | null;
}

function partyLine(label: string, value: unknown): string {
  return `<div><span class="label">${escapeHtml(label)}:</span> ${printValue(value)}</div>`;
}

/**
 * Build the A4 VAT invoice of a sales order.
 *
 * The seller block is the VAT company snapshot stored on the order, so the heading is the
 * company selected when the order was raised - not the shop's Company Profile. Every amount is
 * the stored order total plus VAT from `shared/tax.ts`; nothing is recomputed from the catalogue.
 */
export function buildSalesOrderInvoiceDocument(invoice: SalesOrderInvoicePayload): string {
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
    .join("");

  const body = `
    ${buildDocumentCompanyHeader(
      vatCompanyLetterhead({
        name: invoice.seller.name,
        taxId: invoice.seller.taxId,
        address: invoice.seller.address,
      })
    )}

    <div class="header">
      <h1>VAT INVOICE</h1>
      <div class="subtitle">H&oacute;a &#273;&#417;n gi&aacute; tr&#7883; gia t&#259;ng</div>
      <div class="meta">
        <div><span class="label">Invoice No:</span> ${printValue(invoice.invoiceNumber)}</div>
        <div><span class="label">Invoice Date:</span> ${printValue(formatDateTime(invoice.invoiceDate))}</div>
        <div><span class="label">Sales Order:</span> ${printValue(invoice.orderNumber)}</div>
      </div>
    </div>

    <div class="section-title">Buyer</div>
    <div class="grid">
      ${partyLine("Name", invoice.buyer.name)}
      ${partyLine("Company", invoice.buyer.companyName)}
      ${partyLine("Tax code", invoice.buyer.taxId)}
      ${partyLine("Phone", invoice.buyer.phone)}
      <div class="wide">${partyLine("Address", invoice.buyer.address)}</div>
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

    <div style="margin-top: 10px; display: flex; justify-content: flex-end;">
      <table style="width: 55%;">
        <tr>
          <td class="label">Subtotal (excl. VAT)</td>
          <td class="num">${escapeHtml(formatCurrency(invoice.subtotal))}</td>
        </tr>
        <tr>
          <td class="label">VAT (${escapeHtml(formatPercent(invoice.vatRate))})</td>
          <td class="num">${escapeHtml(formatCurrency(invoice.vatAmount))}</td>
        </tr>
        <tr>
          <td class="label"><strong>Total</strong></td>
          <td class="num"><strong>${escapeHtml(formatCurrency(invoice.total))}</strong></td>
        </tr>
      </table>
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
      ${escapeHtml(invoice.invoiceNumber)} &middot; Issued once for sales order
      ${escapeHtml(invoice.orderNumber)}. A reprint is always this same document.
    </div>`;

  return buildPrintDocument(`VAT Invoice ${invoice.invoiceNumber}`, body);
}

interface SalesOrderInvoicePrintDialogProps {
  order: SalesOrderInvoiceTarget;
  /** False for a read-only user: the dialog can still reprint, but cannot allocate a number. */
  canIssue?: boolean;
  children: ReactNode;
}

/**
 * A4 preview + print for the VAT invoice of a sales order.
 *
 * On first open the invoice is loaded from the order. If it has never been issued, the dialog
 * offers the one explicit action that writes the number ("Issue VAT invoice") - the number is
 * taken from the selected company's sequence and can never be chosen by hand. Once issued, the
 * dialog only reprints: the document is built from the stored order, not from live data.
 */
export function SalesOrderInvoicePrintDialog({
  order,
  canIssue = true,
  children,
}: SalesOrderInvoicePrintDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [invoice, setInvoice] = useState<SalesOrderInvoicePayload | null>(null);
  const [needsIssue, setNeedsIssue] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setNeedsIssue(false);
    setInvoice(null);

    try {
      const response = await fetch(`/api/sales-orders/${order.id}/vat-invoice`, {
        credentials: "include",
      });

      if (response.status === 404) {
        // No number yet: that is the "issue it" state, not a failure.
        setNeedsIssue(true);
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load the VAT invoice");
      }

      const data = await response.json();
      setInvoice(data.invoice as SalesOrderInvoicePayload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load the VAT invoice");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void load();
  };

  const handleIssue = async () => {
    setIssuing(true);
    setError(null);

    try {
      const response = await fetch(`/api/sales-orders/${order.id}/vat-invoice`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Failed to issue the VAT invoice");
      }

      const data = await response.json();
      setInvoice(data.invoice as SalesOrderInvoicePayload);
      setNeedsIssue(false);
      toast({
        title: "VAT invoice issued",
        description: data.invoice?.invoiceNumber
          ? `${data.invoice.invoiceNumber} - print it and send it with the delivery note.`
          : "The invoice number has been allocated",
        variant: "success",
      });
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "Failed to issue the VAT invoice");
    } finally {
      setIssuing(false);
    }
  };

  const missingFields = invoice?.sellerMissingFields ?? [];
  const canPrint = Boolean(invoice) && missingFields.length === 0;

  const handlePrint = () => {
    if (!invoice) return;

    if (!openPrintDocument(buildSalesOrderInvoiceDocument(invoice))) {
      toast({
        title: "Print Blocked",
        description: "Allow pop-ups for this site to print the invoice",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>VAT Invoice - {order.orderNumber}</DialogTitle>
          <DialogDescription>
            Issued in the name of the VAT company selected on this sales order. The number comes
            from that company&apos;s own sequence and is written once.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading invoice...
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Invoice unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : needsIssue ? (
          <div className="space-y-4 py-6">
            <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
              <p className="font-medium">No VAT invoice has been issued for this order yet.</p>
              <p className="text-muted-foreground">
                Issuing it allocates the next number from the selected company&apos;s sequence.
                This can only be done once - a reprint afterwards is the same document.
              </p>
            </div>
            {order.status === "cancelled" ? (
              <p className="text-sm text-destructive">
                This order is cancelled. A cancelled order cannot be invoiced.
              </p>
            ) : !canIssue ? (
              <p className="text-sm text-destructive">
                You do not have permission to issue invoices. Ask someone with Orders &rarr;
                Update access.
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button
                onClick={handleIssue}
                disabled={issuing || order.status === "cancelled" || !canIssue}
              >
                {issuing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                Issue VAT Invoice
              </Button>
            </div>
          </div>
        ) : invoice ? (
          <>
            {missingFields.length > 0 ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Seller details incomplete</AlertTitle>
                <AlertDescription>
                  {missingFields.join(", ")} {missingFields.length === 1 ? "is" : "are"} missing
                  from the VAT company snapshot on this order.
                </AlertDescription>
              </Alert>
            ) : null}

            <iframe
              title={`VAT invoice ${invoice.invoiceNumber}`}
              srcDoc={buildSalesOrderInvoiceDocument(invoice)}
              className="h-[70vh] w-full rounded-md border bg-white"
            />

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button onClick={handlePrint} disabled={!canPrint}>
                <Printer className="mr-2 h-4 w-4" />
                Print Invoice
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default SalesOrderInvoicePrintDialog;


