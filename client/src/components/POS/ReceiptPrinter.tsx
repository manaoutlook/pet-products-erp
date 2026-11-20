import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDateTime } from "@/utils/format";
import { BRAND_NAME, BRAND_WEBSITE } from "@/config/branding";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Printer, Download, Receipt, FileText, Search, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DocumentHeaderNotice, companyHeaderMissingFields } from "@/components/company/CompanyHeader";
import {
  companyHeaderPrintLines,
  companyHeaderProblemMessage,
  type CompanyHeader,
} from "@shared/company";
import {
  layoutReceipt,
  measureReceiptText,
  renderReceiptImage,
} from "@/utils/receipt-pdf";

// Dynamic import for jsPDF to avoid SSR issues
let jsPDF: any = null;
const loadJSPDF = async () => {
  if (typeof window !== 'undefined' && !jsPDF) {
    try {
      const { jsPDF: jsPDFLib } = await import('jspdf');
      jsPDF = jsPDFLib;
    } catch (error) {
      console.error('Failed to load jsPDF:', error);
    }
  }
  return jsPDF;
};

interface Product {
  id: number;
  name: string;
  sku: string;
  /** Numeric in the POS cart, a numeric string when it comes straight from the API. */
  price: number | string;
}

interface CartItem {
  productId: number;
  product: Product;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface ReceiptData {
  invoiceNumber: string;
  transactionDate: string;
  cashierName: string;
  storeName?: string;
  items: CartItem[];
  /**
   * AI Agent Note: subtotal / tax / total are the numbers STORED on the sale
   * (`sales_transactions.subtotal` / `vat_amount` / `total_amount`). The receipt must never
   * compute them - the old `subtotal * 0.1` here is why the till showed 110,000 for a sale the
   * database recorded as 100,000.
   */
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
  /** Rate that produced `tax` (0 for a retail sale with no VAT invoice). */
  vatRate?: number;
  /** True when the customer asked for a VAT invoice. */
  withVat?: boolean;
  /** 'completed' | 'refunded' | 'cancelled' - printed so a void copy is recognisable. */
  status?: string;
}

/**
 * Label of the VAT line on any output of this component.
 *
 * A retail sale (no VAT invoice) prints "VAT" with a zero amount; a VAT sale prints the stored
 * rate. Hardcoding "Tax (10%)" was the third copy of the 10% rule and it lied as soon as the
 * rate or the customer's choice differed.
 */
function vatLineLabel(data: ReceiptData): string {
  if (!data.withVat) return 'VAT (not invoiced)';
  const rate = Number(data.vatRate ?? 0);
  return `VAT (${Number.isFinite(rate) ? `${(rate * 100).toFixed(0)}%` : '0%'})`;
}


interface ReceiptPrinterProps {
  receiptData: ReceiptData | null;
  /**
   * The company letterhead from `useCompanyInfo()`. Every output of this component -
   * preview, print sheet and PDF - carries it, and a blank field blocks the output.
   */
  company?: CompanyHeader | null;
  onPrint?: () => void;
  onClose?: () => void;
}

function escapeHtml(value: unknown): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(value ?? '').replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * The letterhead block on the thermal print sheet.
 *
 * Name, registered address and a labelled tax ID - centred, in the same order and with the
 * same rules as the A4 documents (`buildDocumentCompanyHeader`); no delivery address, no
 * application title. The receipt has its own 80mm stylesheet, so it re-renders the shared
 * lines rather than the shared markup.
 */
function buildCompanyHeaderBlock(company: CompanyHeader): string {
  return companyHeaderPrintLines(company)
    .map((line) => {
      const body =
        line.label.length > 0
          ? `<span class="bold">${escapeHtml(line.label)}:</span> ${escapeHtml(line.value)}`
          : escapeHtml(line.value);

      return `<div class="${line.emphasis ? 'bold title' : 'small'}">${body}</div>`;
    })
    .join('');
}

/**
 * Build the printable receipt as a standalone document.
 *
 * AI Agent Note: this used to be `printWindow.document.write(receiptRef.current.innerHTML)`,
 * which copied Tailwind class names into a window that loads no Tailwind - so the
 * `flex justify-between` rows collapsed into one column per span and the separators did not
 * draw. The print sheet owns its own CSS here, on white paper with black ink, and every
 * interpolated value is escaped so a product name cannot break the markup.
 */
function buildPrintDocument(data: ReceiptData, company: CompanyHeader): string {
  // VND, formatted once for the whole app (utils/format.ts) - the receipt must show the
  // same figure as the invoice and the sale screen.
  const money = (value: number) => formatCurrency(value);

  const items = data.items
    .map(
      (item) => `
        <div class="item">
          <div class="row">
            <span>${escapeHtml(item.product.name)}</span>
            <span>${money(item.unitPrice)}</span>
          </div>
          <div class="row small muted">
            <span>Qty: ${escapeHtml(item.quantity)}</span>
            <span>Total: ${money(item.totalPrice)}</span>
          </div>
        </div>`,
    )
    .join('');

  return `<!doctype html>
    <html>
      <head>
        <title>Receipt - ${escapeHtml(data.invoiceNumber)}</title>
        <style>
          @page { margin: 6mm; }
          * { box-sizing: border-box; }
          body {
            font-family: 'Courier New', monospace;
            font-size: 12px;
            line-height: 1.4;
            color: #000;
            background: #fff;
            max-width: 300px;
            margin: 0 auto;
            padding: 10px;
          }
          .center { text-align: center; }
          .row { display: flex; justify-content: space-between; gap: 8px; }
          .small { font-size: 10px; }
          .muted { color: #444; }
          .bold { font-weight: bold; }
          .title { font-size: 16px; }
          .total { font-size: 14px; }
          .section { margin: 0 0 12px; }
          .item { margin: 0 0 8px; }
          .line { border-top: 1px dashed #000; margin: 8px 0; }
          .total-line { border-top: 2px solid #000; margin: 8px 0; }
        </style>
      </head>
      <body>
        <div class="center section">
          ${buildCompanyHeaderBlock(company)}
          ${data.storeName ? `<div>${escapeHtml(data.storeName)}</div>` : ''}
          <div class="small">Point of Sale Receipt</div>
        </div>

        <div class="line"></div>

        <div class="section">
          <div class="row"><span>Invoice:</span><span class="bold">${escapeHtml(data.invoiceNumber)}</span></div>
          <div class="row"><span>Date:</span><span>${escapeHtml(formatDateTime(data.transactionDate))}</span></div>
          <div class="row"><span>Cashier:</span><span>${escapeHtml(data.cashierName)}</span></div>
          <div class="row"><span>Payment:</span><span>${escapeHtml(data.paymentMethod.toUpperCase())}</span></div>
        </div>

        <div class="line"></div>

        <div class="section">${items}</div>

        <div class="line"></div>

        <div class="section">
          <div class="row"><span>Subtotal:</span><span>${money(data.subtotal)}</span></div>
          <div class="row"><span>${vatLineLabel(data)}:</span><span>${money(data.tax)}</span></div>
          <div class="total-line"></div>
          <div class="row bold total"><span>TOTAL:</span><span>${money(data.total)}</span></div>
        </div>

        <div class="line"></div>

        <div class="center small">
          <div>Thank you for your business!</div>
          <div class="item">Please keep this receipt for your records</div>
          <div class="bold">${BRAND_NAME}</div>
          <div>${BRAND_WEBSITE}</div>
        </div>
      </body>
    </html>`;
}

export function ReceiptPrinter({ receiptData, company, onPrint, onClose }: ReceiptPrinterProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  if (!receiptData) {
    return null;
  }

  // The same rule the screen header and the A4 documents apply: no complete letterhead,
  // no output. Reported once here so Print, TXT and PDF cannot drift apart.
  const missingFields = companyHeaderMissingFields(company);
  const isPrintable = missingFields.length === 0;

  const refuseWhenIncomplete = (): boolean => {
    if (isPrintable) return false;

    toast({
      title: "Company letterhead incomplete",
      description: companyHeaderProblemMessage(missingFields),
      variant: "destructive",
    });
    return true;
  };

  const handlePrint = () => {
    if (refuseWhenIncomplete()) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({
        title: "Print Blocked",
        description: "Allow pop-ups for this site to print the receipt",
        variant: "destructive",
      });
      return;
    }

    printWindow.document.write(buildPrintDocument(receiptData, company as CompanyHeader));
    printWindow.document.close();
    printWindow.print();
    onPrint?.();
  };

  const handleDownload = () => {
    if (refuseWhenIncomplete()) return;

    if (receiptRef.current) {
      const receiptContent = receiptRef.current.innerText;
      const blob = new Blob([receiptContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${receiptData.invoiceNumber}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Receipt Downloaded",
        description: "Receipt has been saved to your downloads",
        variant: "success",
      });
    }
  };

  const handleDownloadPDF = async () => {
    if (refuseWhenIncomplete()) return;

    try {
      const jspdf = await loadJSPDF();
      if (!jspdf) {
        toast({
          title: "PDF Generation Failed",
          description: "PDF library not available",
          variant: "destructive",
        });
        return;
      }

      /*
        Layout in millimetres, then let the browser render it (utils/receipt-pdf.ts).
        jsPDF's built-in fonts are the Adobe core fonts and have no Vietnamese glyphs, and its
        `maxWidth` wrapping did not advance the cursor - which is why the downloaded PDF
        printed "Ph°êng" and stacked the letterhead lines on top of each other.
      */
      const layout = layoutReceipt(
        receiptData,
        vatLineLabel(receiptData),
        company as CompanyHeader | null,
        measureReceiptText
      );
      const image = renderReceiptImage(layout);

      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        // The page is exactly as tall as the receipt: an 80 x 297 mm sheet clipped anything
        // longer and left the rest of the page blank.
        format: [layout.widthMm, layout.heightMm],
      });

      doc.addImage(image, 'PNG', 0, 0, layout.widthMm, layout.heightMm);

      // Save the PDF
      doc.save(`receipt-${receiptData.invoiceNumber}.pdf`);

      toast({
        title: "PDF Downloaded",
        description: "Receipt PDF has been saved to your downloads",
        variant: "success",
      });
    } catch (error) {
      console.error('PDF generation error:', error);
      toast({
        title: "PDF Generation Failed",
        description: "Failed to generate PDF receipt",
        variant: "destructive",
      });
    }
  };

  /*
    The preview lives in a fixed overlay (`fixed inset-0 ... p-4`), so the card itself has to
    stay inside the viewport and scroll internally. Before this, a receipt with a few items was
    taller than the window: the overlay cannot scroll, so the top of the letterhead and the
    "Close" button were both off-screen with no scrollbar to reach them.
    `max-h-[calc(100vh-2rem)]` matches the overlay's `p-4`; the header (TXT / PDF / Print) and the
    Close button stay put while the paper scrolls.
  */
  return (
    <Card className="flex w-full max-w-md mx-auto flex-col overflow-hidden max-h-[calc(100vh-2rem)]">
      <CardHeader className="shrink-0">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Receipt
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleDownload} disabled={!isPrintable}>
              <Download className="h-4 w-4 mr-1" />
              TXT
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadPDF} disabled={!isPrintable}>
              <FileText className="h-4 w-4 mr-1" />
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={!isPrintable}>
              <Printer className="h-4 w-4 mr-1" />
              Print
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      {/* `min-h-0` + `overflow-y-auto`: the scroll container. Without `min-h-0` a flex child
          refuses to shrink below its content height and the card overflows the viewport again. */}
      <CardContent className="min-h-0 flex-1 overflow-y-auto">
        {!isPrintable && <DocumentHeaderNotice missingFields={missingFields} className="mb-4" />}
        {/*
          AI Agent Note: a receipt is "paper", not a themed surface - its ink is fixed so it
          reads the same in light and dark mode. Previously the container was `bg-white` while
          the text inherited `text-foreground` (near-white in dark mode), so the whole receipt
          was white-on-white. The `.line` / `.total-line` / `.item` class names had no CSS
          behind them anywhere either, so the separators never drew. Keep these colours
          explicit; do not swap them for `text-foreground` / `border`.
        */}
        <div
          ref={receiptRef}
          className="font-mono text-sm bg-white text-slate-900 border border-slate-300 p-4 rounded"
          style={{ fontFamily: 'Courier New, monospace' }}
        >
          {/* Header - the company letterhead: name, registered address, labelled tax ID. */}
          <div className="text-center mb-4">
            {company ? (
              companyHeaderPrintLines(company).map((line) => (
                <div
                  key={line.key}
                  className={cn(
                    "break-words",
                    line.emphasis ? "font-bold text-lg" : "text-sm"
                  )}
                >
                  {line.label.length > 0 && (
                    <span className="font-bold">{line.label}: </span>
                  )}
                  {line.value || "—"}
                </div>
              ))
            ) : (
              <div className="font-bold text-lg">—</div>
            )}
            {receiptData.storeName && (
              <div className="text-sm">{receiptData.storeName}</div>
            )}
            <div className="text-xs mt-1">Point of Sale Receipt</div>
          </div>

          <div className="border-t border-dashed border-slate-400 my-2" />

          {/* Transaction Info */}
          <div className="mb-4">
            <div className="flex justify-between">
              <span>Invoice:</span>
              <span className="font-bold">{receiptData.invoiceNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>Date:</span>
              <span>{formatDateTime(receiptData.transactionDate)}</span>
            </div>
            <div className="flex justify-between">
              <span>Cashier:</span>
              <span>{receiptData.cashierName}</span>
            </div>
            <div className="flex justify-between">
              <span>Payment:</span>
              <span>{receiptData.paymentMethod.toUpperCase()}</span>
            </div>
          </div>

          <div className="border-t border-dashed border-slate-400 my-2" />

          {/* Items */}
          <div className="mb-4">
            {receiptData.items.map((item, index) => (
              <div key={index} className="mb-2">
                  <div className="flex justify-between">
                    <span className="flex-1">{item.product.name}</span>
                    <span>{formatCurrency(item.unitPrice)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Qty: {item.quantity}</span>
                    <span>Total: {formatCurrency(item.totalPrice)}</span>
                  </div>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-slate-400 my-2" />

          {/* Totals */}
          <div className="mb-4">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>{formatCurrency(receiptData.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>{vatLineLabel(receiptData)}:</span>
              <span>{formatCurrency(receiptData.tax)}</span>
            </div>
            <div className="border-t-2 border-slate-800 my-2"></div>
            <div className="flex justify-between font-bold text-lg">
              <span>TOTAL:</span>
              <span>{formatCurrency(receiptData.total)}</span>
            </div>
          </div>

          <div className="border-t border-dashed border-slate-400 my-2" />

          {/* Footer */}
          <div className="text-center text-xs">
            <div>Thank you for your business!</div>
            <div className="mt-2">Please keep this receipt for your records</div>
            <div className="mt-4 font-bold">{BRAND_NAME}</div>
            <div>{BRAND_WEBSITE}</div>
          </div>
        </div>
      </CardContent>

      {/* Outside the scroll area, so a tall receipt can always be closed without scrolling. */}
      {onClose && (
        <CardFooter className="shrink-0 justify-center border-t p-4">
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
