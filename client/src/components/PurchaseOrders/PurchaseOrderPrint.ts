import { BRAND_NAME, BRAND_WEBSITE } from "@/config/branding";
import {
  buildPrintDocument,
  escapeHtml,
  openPrintDocument,
  printValue,
} from "@/utils/print-document";
import { formatCurrency, formatDate, formatQuantity } from "@/utils/format";
import { buildDocumentCompanyHeader } from "@/components/company/CompanyHeader";
import type { CompanyHeader } from "@shared/company";

/**
 * The A4 purchase order sent to a supplier.
 *
 * Previously `PurchaseOrdersPage` printed a two-line `window.open` string, so the paper
 * that left the building carried no letterhead at all while every other document did.
 * This builder puts the shared company header (`components/company/CompanyHeader.tsx`) on
 * it, from the same `company` row the screen reads.
 */

export interface PurchaseOrderPrintLine {
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: number | string;
  totalPrice?: number | string | null;
}

export interface PurchaseOrderPrintData {
  orderNumber: string;
  orderDate?: string | Date | null;
  deliveryDate?: string | Date | null;
  status?: string | null;
  supplierName: string;
  destinationStoreName?: string | null;
  notes?: string | null;
  totalAmount?: number | string | null;
  items?: PurchaseOrderPrintLine[] | null;
}

function lineAmount(line: PurchaseOrderPrintLine): number {
  if (line.totalPrice !== null && line.totalPrice !== undefined) {
    return Number(line.totalPrice);
  }
  return Number(line.quantity) * Number(line.unitPrice);
}

export function buildPurchaseOrderPrintDocument(
  order: PurchaseOrderPrintData,
  company: CompanyHeader | null | undefined
): string {
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
    .join("");

  const body = `
    ${buildDocumentCompanyHeader(company)}

    <div class="header">
      <h1>PURCHASE ORDER</h1>
      <div class="meta">
        <div><span class="label">Order No:</span> ${printValue(order.orderNumber)}</div>
        <div><span class="label">Order Date:</span> ${printValue(formatDate(order.orderDate))}</div>
        <div><span class="label">Delivery Date:</span> ${printValue(formatDate(order.deliveryDate))}</div>
      </div>
    </div>

    <div class="section-title">Supplier Information</div>
    <div class="grid">
      <div><span class="label">Supplier Name:</span> ${printValue(order.supplierName)}</div>
      <div><span class="label">Destination Store:</span> ${printValue(order.destinationStoreName)}</div>
      <div><span class="label">Status:</span> ${printValue(order.status)}</div>
    </div>

    <div class="section-title">Order Lines</div>
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

    <div class="section-title">Notes</div>
    <div class="notes">${printValue(order.notes)}</div>

    <div class="signatures">
      <div class="signature">
        <div class="role">Prepared By</div>
        <div class="hint">Signature:</div>
        <div class="line">&nbsp;</div>
      </div>
      <div class="signature">
        <div class="role">Supplier Confirmation</div>
        <div class="hint">Signature &amp; Chop:</div>
        <div class="line">&nbsp;</div>
      </div>
    </div>

    <div class="footer">
      ${escapeHtml(BRAND_NAME)} &middot; ${escapeHtml(BRAND_WEBSITE)}
    </div>`;

  return buildPrintDocument(`Purchase Order ${order.orderNumber}`, body);
}

/** Print the order, reporting a blocked pop-up instead of failing silently. */
export function printPurchaseOrder(
  order: PurchaseOrderPrintData,
  company: CompanyHeader | null | undefined
): boolean {
  return openPrintDocument(buildPurchaseOrderPrintDocument(order, company));
}
