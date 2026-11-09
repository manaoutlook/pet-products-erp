import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDateTime } from "@/utils/format";
import { BRAND_NAME, BRAND_WEBSITE } from "@/config/branding";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
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
  const money = (value: number) => `$${Number(value).toFixed(2)}`;

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
          <div class="row"><span>Tax (10%):</span><span>${money(data.tax)}</span></div>
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

      // Create PDF document
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [80, 297], // Thermal receipt width (80mm) and A4 height
      });

      let yPosition = 10;

      // Header - the company letterhead: name, registered address, labelled tax ID.
      // Centred, no application title, no delivery address (see shared/company.ts).
      const letterhead = company as CompanyHeader;

      companyHeaderPrintLines(letterhead).forEach((line) => {
        if (line.emphasis) {
          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
        } else {
          doc.setFontSize(7);
          doc.setFont('helvetica', 'normal');
        }

        const text = line.label.length > 0 ? `${line.label}: ${line.value}` : line.value;
        doc.text(text, 40, yPosition, { align: 'center', maxWidth: 70 });
        yPosition += line.emphasis ? 5 : 3;
      });
      yPosition += 2;

      if (receiptData.storeName) {
        doc.setFontSize(10);
        doc.text(receiptData.storeName, 40, yPosition, { align: 'center' });
        yPosition += 4;
      }

      doc.setFontSize(8);
      doc.text('Point of Sale Receipt', 40, yPosition, { align: 'center' });
      yPosition += 6;

      // Line
      doc.setLineWidth(0.5);
      doc.line(5, yPosition, 75, yPosition);
      yPosition += 6;

      // Transaction Info
      doc.setFontSize(8);
      doc.text(`Invoice: ${receiptData.invoiceNumber}`, 5, yPosition);
      yPosition += 4;

      const date = formatDateTime(receiptData.transactionDate);
      doc.text(`Date: ${date}`, 5, yPosition);
      yPosition += 4;

      doc.text(`Cashier: ${receiptData.cashierName}`, 5, yPosition);
      yPosition += 4;

      doc.text(`Payment: ${receiptData.paymentMethod.toUpperCase()}`, 5, yPosition);
      yPosition += 6;

      // Line
      doc.line(5, yPosition, 75, yPosition);
      yPosition += 6;

      // Items
      receiptData.items.forEach((item) => {
        // Product name (truncate if too long)
        const productName = item.product.name.length > 25
          ? item.product.name.substring(0, 22) + '...'
          : item.product.name;
        doc.text(productName, 5, yPosition);
        doc.text(`$${Number(item.unitPrice).toFixed(2)}`, 70, yPosition, { align: 'right' });
        yPosition += 3;

        doc.setFontSize(6);
        doc.text(`Qty: ${item.quantity}`, 5, yPosition);
        doc.text(`Total: $${Number(item.totalPrice).toFixed(2)}`, 70, yPosition, { align: 'right' });
        doc.setFontSize(8);
        yPosition += 4;
      });

      // Line
      doc.line(5, yPosition, 75, yPosition);
      yPosition += 6;

      // Totals
      doc.text(`Subtotal: $${receiptData.subtotal.toFixed(2)}`, 70, yPosition, { align: 'right' });
      yPosition += 4;

      doc.text(`Tax (10%): $${receiptData.tax.toFixed(2)}`, 70, yPosition, { align: 'right' });
      yPosition += 4;

      // Total line
      doc.setLineWidth(1);
      doc.line(5, yPosition, 75, yPosition);
      yPosition += 6;

      doc.setFontSize(10);
      doc.text(`TOTAL: $${receiptData.total.toFixed(2)}`, 70, yPosition, { align: 'right' });
      yPosition += 8;

      // Line
      doc.setLineWidth(0.5);
      doc.line(5, yPosition, 75, yPosition);
      yPosition += 6;

      // Footer
      doc.setFontSize(6);
      doc.text('Thank you for your business!', 40, yPosition, { align: 'center' });
      yPosition += 3;

      doc.text('Please keep this receipt for your records', 40, yPosition, { align: 'center' });
      yPosition += 6;

      doc.setFontSize(8);
      doc.text(BRAND_NAME, 40, yPosition, { align: 'center' });
      yPosition += 4;

      doc.setFontSize(6);
      doc.text(BRAND_WEBSITE, 40, yPosition, { align: 'center' });

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

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
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
      <CardContent>
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
                    <span>${Number(item.unitPrice).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Qty: {item.quantity}</span>
                    <span>Total: ${Number(item.totalPrice).toFixed(2)}</span>
                  </div>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-slate-400 my-2" />

          {/* Totals */}
          <div className="mb-4">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>${receiptData.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tax (10%):</span>
              <span>${receiptData.tax.toFixed(2)}</span>
            </div>
            <div className="border-t-2 border-slate-800 my-2"></div>
            <div className="flex justify-between font-bold text-lg">
              <span>TOTAL:</span>
              <span>${receiptData.total.toFixed(2)}</span>
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

        {onClose && (
          <div className="mt-4 flex justify-center">
            <Button onClick={onClose} variant="outline">
              Close
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
