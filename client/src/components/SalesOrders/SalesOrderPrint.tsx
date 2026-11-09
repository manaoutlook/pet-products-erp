import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatQuantity } from "@/utils/format";
import { BRAND_NAME, BRAND_WEBSITE } from "@/config/branding";
import { buildPrintDocument, escapeHtml, openPrintDocument, printValue } from "@/utils/print-document";

/** One line on the printed order: the catalogue snapshot stored on the order row. */
export interface SalesOrderPrintLine {
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: number | string;
  totalPrice?: number | string | null;
}

/** Everything the sheet needs - a superset of the list rows, so no extra request is required. */
export interface SalesOrderPrintData {
  orderNumber: string;
  orderDate?: string | Date | null;
  customerName: string;
  companyName?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  deliveryAddress?: string | null;
  specialInstructions?: string | null;
  totalAmount?: number | string | null;
  items?: SalesOrderPrintLine[] | null;
  preparedByUser?: { username: string } | null;
}

function lineAmount(line: SalesOrderPrintLine): number {
  if (line.totalPrice !== null && line.totalPrice !== undefined) {
    return Number(line.totalPrice);
  }
  return Number(line.quantity) * Number(line.unitPrice);
}

/**
 * Build the A4 sales order exactly as the customer signs it (PDF page 1).
 *
 * AI Agent Note: the customer block and product code/description are printed from the values
 * snapshotted on the order, never by joining back to `products` / `customer_profiles` - a
 * reprint of a signed order must not pick up a later rename.
 */
export function buildSalesOrderPrintDocument(order: SalesOrderPrintData): string {
  const items = order.items ?? [];
  const total = order.totalAmount ?? items.reduce((sum, line) => sum + lineAmount(line), 0);

  const rows = items
    .map(
      (line, index) => `
        <tr>
          <td class="center">${index + 1}</td>
          <td>${printValue(line.productCode)}</td>
          <td>${printValue(line.description)}</td>
          <td class="num">${escapeHtml(formatQuantity(line.quantity))}</td>
          <td class="num">${escapeHtml(formatCurrency(line.unitPrice))}</td>
          <td class="num">${escapeHtml(formatCurrency(lineAmount(line)))}</td>
        </tr>`
    )
    .join('');

  const body = `
    <div class="header">
      <p class="brand">${escapeHtml(BRAND_NAME)}</p>
      <h1>SALES ORDER FORM</h1>
      <div class="meta">
        <div><span class="label">Order No:</span> ${printValue(order.orderNumber)}</div>
        <div><span class="label">Order Date:</span> ${printValue(formatDate(order.orderDate))}</div>
      </div>
    </div>

    <div class="section-title">Customer Information</div>
    <div class="grid">
      <div><span class="label">Customer Name:</span> ${printValue(order.customerName)}</div>
      <div><span class="label">Company Name:</span> ${printValue(order.companyName)}</div>
      <div><span class="label">Contact Person:</span> ${printValue(order.contactPerson)}</div>
      <div><span class="label">Phone:</span> ${printValue(order.phone)}</div>
      <div class="wide"><span class="label">Delivery Address:</span> ${printValue(order.deliveryAddress)}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="center" style="width: 34px;">No</th>
          <th style="width: 110px;">Product Code</th>
          <th>Product Description</th>
          <th class="num" style="width: 60px;">Qty</th>
          <th class="num" style="width: 100px;">Unit Price</th>
          <th class="num" style="width: 110px;">Amount</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6">&nbsp;</td></tr>'}</tbody>
      <tfoot>
        <tr>
          <td colspan="5" class="num">Total</td>
          <td class="num">${escapeHtml(formatCurrency(total))}</td>
        </tr>
      </tfoot>
    </table>

    <div class="section-title">Special Instructions</div>
    <div class="notes">${printValue(order.specialInstructions)}</div>

    <div class="signatures">
      <div class="signature">
        <div class="role">Prepared By (SL)</div>
        <div class="hint">Signature:</div>
        <div class="line">&nbsp;</div>
      </div>
      <div class="signature">
        <div class="role">Customer Approval</div>
        <div class="hint">Signature &amp; Chop:</div>
        <div class="line">&nbsp;</div>
      </div>
    </div>

    <div class="footer">
      ${escapeHtml(BRAND_NAME)} &middot; ${escapeHtml(BRAND_WEBSITE)} &middot; Prepared by
      ${printValue(order.preparedByUser?.username)}
    </div>`;

  return buildPrintDocument(`Sales Order ${order.orderNumber}`, body);
}

/** Print the order, reporting a blocked pop-up instead of failing silently. */
export function printSalesOrder(order: SalesOrderPrintData): boolean {
  return openPrintDocument(buildSalesOrderPrintDocument(order));
}

interface SalesOrderPrintDialogProps {
  order: SalesOrderPrintData;
  /** The button that opens the preview (rendered as the dialog trigger). */
  children: ReactNode;
}

/**
 * A4 preview + print button.
 *
 * The preview is the print document itself in an iframe, so what the user sees is exactly
 * what the printer receives - a second, hand-built preview would drift from the sheet.
 */
export function SalesOrderPrintDialog({ order, children }: SalesOrderPrintDialogProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const documentHtml = buildSalesOrderPrintDocument(order);

  const handlePrint = () => {
    if (!printSalesOrder(order)) {
      toast({
        title: "Print Blocked",
        description: "Allow pop-ups for this site to print the sales order",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sales Order - {order.orderNumber}</DialogTitle>
          <DialogDescription>
            A4 preview. Print, then collect the customer's signature and stamp.
          </DialogDescription>
        </DialogHeader>
        <iframe
          title={`Sales order ${order.orderNumber}`}
          srcDoc={documentHtml}
          className="h-[70vh] w-full rounded-md border bg-white"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SalesOrderPrintDialog;
