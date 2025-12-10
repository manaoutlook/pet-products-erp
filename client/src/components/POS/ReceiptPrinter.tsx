import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Printer, Download, Receipt, FileText, Search, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  price: number;
}

interface CartItem {
  productId: number;
  product: Product;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

interface ReceiptData {
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
  onPrint?: () => void;
  onClose?: () => void;
}

export function ReceiptPrinter({ receiptData, onPrint, onClose }: ReceiptPrinterProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  if (!receiptData) {
    return null;
  }

  const handlePrint = () => {
    if (receiptRef.current) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Receipt - ${receiptData.invoiceNumber}</title>
              <style>
                body {
                  font-family: 'Courier New', monospace;
                  font-size: 12px;
                  line-height: 1.4;
                  max-width: 300px;
                  margin: 0 auto;
                  padding: 10px;
                }
                .center { text-align: center; }
                .right { text-align: right; }
                .bold { font-weight: bold; }
                .line { border-top: 1px dashed #000; margin: 8px 0; }
                .item { margin: 4px 0; }
                .total-line { border-top: 2px solid #000; margin: 8px 0; }
              </style>
            </head>
            <body>
              ${receiptRef.current.innerHTML}
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
        onPrint?.();
      }
    }
  };

  const handleDownload = () => {
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
      });
    }
  };

  const handleDownloadPDF = async () => {
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

      // Header
      doc.setFontSize(14);
      doc.text('PET PRODUCTS ERP', 40, yPosition, { align: 'center' });
      yPosition += 6;

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

      const date = new Date(receiptData.transactionDate).toLocaleString();
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
      doc.text('PET PRODUCTS ERP', 40, yPosition, { align: 'center' });
      yPosition += 4;

      doc.setFontSize(6);
      doc.text('www.petproducts.com', 40, yPosition, { align: 'center' });

      // Save the PDF
      doc.save(`receipt-${receiptData.invoiceNumber}.pdf`);

      toast({
        title: "PDF Downloaded",
        description: "Receipt PDF has been saved to your downloads",
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
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1" />
              TXT
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadPDF}>
              <FileText className="h-4 w-4 mr-1" />
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" />
              Print
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={receiptRef}
          className="font-mono text-sm bg-white border p-4 rounded"
          style={{ fontFamily: 'Courier New, monospace' }}
        >
          {/* Header */}
          <div className="text-center mb-4">
            <div className="font-bold text-lg">PET PRODUCTS ERP</div>
            {receiptData.storeName && (
              <div className="text-sm">{receiptData.storeName}</div>
            )}
            <div className="text-xs mt-1">Point of Sale Receipt</div>
          </div>

          <div className="line"></div>

          {/* Transaction Info */}
          <div className="mb-4">
            <div className="flex justify-between">
              <span>Invoice:</span>
              <span className="font-bold">{receiptData.invoiceNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>Date:</span>
              <span>{new Date(receiptData.transactionDate).toLocaleString()}</span>
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

          <div className="line"></div>

          {/* Items */}
          <div className="mb-4">
            {receiptData.items.map((item, index) => (
              <div key={index} className="item">
                  <div className="flex justify-between">
                    <span className="flex-1">{item.product.name}</span>
                    <span>${Number(item.unitPrice).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Qty: {item.quantity}</span>
                    <span>Total: ${Number(item.totalPrice).toFixed(2)}</span>
                  </div>
              </div>
            ))}
          </div>

          <div className="line"></div>

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
            <div className="total-line"></div>
            <div className="flex justify-between font-bold text-lg">
              <span>TOTAL:</span>
              <span>${receiptData.total.toFixed(2)}</span>
            </div>
          </div>

          <div className="line"></div>

          {/* Footer */}
          <div className="text-center text-xs">
            <div>Thank you for your business!</div>
            <div className="mt-2">Please keep this receipt for your records</div>
            <div className="mt-4 font-bold">PET PRODUCTS ERP</div>
            <div>www.petproducts.com</div>
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
