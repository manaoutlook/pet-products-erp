import { escapeHtml, openPrintDocument, printValue } from "./print-document";
import { formatCurrency, formatDate, formatPercent, formatQuantity } from "./format";
import type { VatMarginStatement } from "@/hooks/use-vat-margin";

/**
 * The printable VAT margin statement.
 *
 * Why a browser print sheet and not jsPDF: the statement is sent to Vietnamese VAT companies, so
 * every product description must keep its diacritics. The built-in jsPDF fonts have no glyphs for
 * `Đ`, `ệ` or `ỹ` and silently print blanks (the same reason `print-document.ts` was chosen for
 * the sales order and delivery note). Printing the page and choosing "Save as PDF" uses the
 * system's own Unicode fonts, so what is reviewed on screen is exactly what is sent.
 *
 * The layout is A4 LANDSCAPE: sixteen money columns do not fit on a portrait sheet, and shrinking
 * the type until they do makes the document unreadable on paper.
 */

const STATEMENT_STYLES = `
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9px;
    line-height: 1.3;
    color: #000;
    background: #fff;
  }
  h1 { font-size: 15px; letter-spacing: 1.5px; margin: 0; text-align: center; text-transform: uppercase; }
  .subtitle { font-size: 9px; margin: 2px 0 0; text-align: center; }
  .letterhead { text-align: center; border-bottom: 1px solid #000; padding-bottom: 5px; margin-bottom: 8px; }
  .letterhead .company-name { font-size: 12px; font-weight: bold; }
  .letterhead .company-line { font-size: 8.5px; }
  .meta { display: flex; gap: 18px; margin-bottom: 6px; font-size: 9px; }
  .meta div { flex: 1; }
  .meta .label { font-weight: bold; }
  .rates { display: flex; gap: 18px; margin-bottom: 8px; font-size: 9px; }
  .rates span { border: 1px solid #000; padding: 2px 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 2px 4px; font-size: 7.5px; vertical-align: top; }
  th { background: #eee; text-align: center; font-weight: bold; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.center, th.center { text-align: center; white-space: nowrap; }
  tfoot td { font-weight: bold; background: #f5f5f5; }
  .errors { border: 1px solid #000; padding: 5px 7px; margin-bottom: 8px; font-size: 8.5px; }
  .errors .title { font-weight: bold; text-transform: uppercase; }
  .errors ul { margin: 3px 0 0; padding-left: 16px; }
  .signatures { display: flex; gap: 40px; margin-top: 22px; }
  .signature { flex: 1; text-align: center; }
  .signature .role { font-weight: bold; }
  .signature .hint { font-size: 8px; }
  .signature .line { margin-top: 42px; border-top: 1px dashed #000; padding-top: 3px; font-size: 8px; }
  .footer { margin-top: 10px; border-top: 1px solid #999; padding-top: 4px; font-size: 7.5px; text-align: center; }
  tr { page-break-inside: avoid; }
`;

const NUM = (value: unknown): string => escapeHtml(formatCurrency(value as number));
const QTY = (value: unknown): string => escapeHtml(formatQuantity(value as number));
const PCT = (value: unknown): string => escapeHtml(formatPercent(value as number, { maximumFractionDigits: 2 }));

function headerRow(): string {
  return `<tr>
    <th class="center">#</th>
    <th>SKU</th>
    <th>Description</th>
    <th class="num">Qty (G)</th>
    <th class="num">Landing (E)</th>
    <th class="num">B2B (F)</th>
    <th class="num">Margin (H)</th>
    <th class="num">SmartLife (I)</th>
    <th class="num">VAT co. / unit (J)</th>
    <th class="num">VAT co. profit (K)</th>
    <th class="num">Income tax (L)</th>
    <th class="num">Service fee (M)</th>
    <th class="num">Pay back (N)</th>
    <th class="num">Sales value (O)</th>
    <th class="num">VAT (P)</th>
    <th class="num">Invoice total (Q)</th>
  </tr>`;
}

/**
 * The whole sheet, ready for `window.print()`.
 *
 * Everything that came from the database is escaped: a product description containing `<` or a
 * company name containing `&` must not be able to break the document (same rule as
 * `print-document.ts`).
 */
export function buildVatMarginPrintDocument(statement: VatMarginStatement): string {
  const { document: doc, lines, totals, params, errors } = statement;

  const letterhead = doc.vatCompanyName
    ? `<div class="letterhead">
        <div class="company-name">${escapeHtml(doc.vatCompanyName)}</div>
        ${doc.vatCompanyTaxId ? `<div class="company-line">Tax code: ${escapeHtml(doc.vatCompanyTaxId)}</div>` : ""}
        ${doc.vatCompanyAddress ? `<div class="company-line">${escapeHtml(doc.vatCompanyAddress)}</div>` : ""}
      </div>`
    : "";

  const errorBlock = errors.length
    ? `<div class="errors">
        <div class="title">Cannot be sent - update the Product module</div>
        <ul>${errors.map((issue) => `<li>${escapeHtml(issue.message)}</li>`).join("")}</ul>
      </div>`
    : "";

  const rows = lines
    .map(
      (line, index) => `<tr>
        <td class="center">${index + 1}</td>
        <td>${printValue(line.productCode)}</td>
        <td>${printValue(line.description)}</td>
        <td class="num">${QTY(line.quantity)}</td>
        <td class="num">${NUM(line.landingPrice)}</td>
        <td class="num">${NUM(line.b2bPrice)}</td>
        <td class="num">${NUM(line.marginAmount)}</td>
        <td class="num">${NUM(line.smartLifePrice)}</td>
        <td class="num">${NUM(line.conquerorProfitUnit)}</td>
        <td class="num">${NUM(line.conquerorProfitTotal)}</td>
        <td class="num">${NUM(line.incomeTax)}</td>
        <td class="num">${NUM(line.serviceFee)}</td>
        <td class="num">${NUM(line.paybackToSmartLife)}</td>
        <td class="num">${NUM(line.salesValue)}</td>
        <td class="num">${NUM(line.vatAmount)}</td>
        <td class="num">${NUM(line.invoiceTotal)}</td>
      </tr>`
    )
    .join("");

  const footer = `<tr>
    <td class="center" colspan="3">Total</td>
    <td class="num">${QTY(totals.quantity)}</td>
    <td class="num" colspan="5"></td>
    <td class="num">${NUM(totals.conquerorProfitTotal)}</td>
    <td class="num">${NUM(totals.incomeTax)}</td>
    <td class="num">${NUM(totals.serviceFee)}</td>
    <td class="num">${NUM(totals.paybackToSmartLife)}</td>
    <td class="num">${NUM(totals.salesValue)}</td>
    <td class="num">${NUM(totals.vatAmount)}</td>
    <td class="num">${NUM(totals.invoiceTotal)}</td>
  </tr>`;

  const body = `
    ${letterhead}
    <h1>VAT margin statement</h1>
    <p class="subtitle">Profit split for the VAT invoice issued on this document</p>

    <div class="meta">
      <div><span class="label">${escapeHtml(doc.typeLabel)}:</span> ${printValue(doc.reference)}</div>
      <div><span class="label">Order:</span> ${printValue(doc.orderNumber)}</div>
      <div><span class="label">Invoice No.:</span> ${printValue(doc.invoiceNumber)}</div>
      <div><span class="label">Date:</span> ${printValue(doc.orderDate ? formatDate(doc.orderDate) : "")}</div>
    </div>
    <div class="meta">
      <div><span class="label">Customer:</span> ${printValue(doc.companyName || doc.customerName)}</div>
      <div><span class="label">Contact:</span> ${printValue(doc.contactPerson)}</div>
      <div><span class="label">VAT rate:</span> ${PCT(params.vatRate)}</div>
    </div>

    <div class="rates">
      <span>Profit margin: ${PCT(params.profitMarginRate)}</span>
      <span>Income tax: ${PCT(params.incomeTaxRate)}</span>
      <span>VAT invoice service fee: ${PCT(params.serviceFeeRate)}</span>
    </div>

    ${errorBlock}

    <table>
      <thead>${headerRow()}</thead>
      <tbody>${rows}</tbody>
      <tfoot>${footer}</tfoot>
    </table>

    <div class="signatures">
      <div class="signature">
        <div class="role">Prepared by</div>
        <div class="hint">SmartLife</div>
        <div class="line">Name / Signature / Date</div>
      </div>
      <div class="signature">
        <div class="role">Confirmed by</div>
        <div class="hint">${printValue(doc.vatCompanyName || "VAT company")}</div>
        <div class="line">Name / Signature / Date</div>
      </div>
    </div>

    <div class="footer">
      Unit columns (H, I, J) are per unit; K-Q are whole-line amounts, rounded to the dong.
    </div>`;

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <title>VAT margin statement ${escapeHtml(doc.reference)}</title>
    <style>${STATEMENT_STYLES}</style>
  </head>
  <body>${body}</body>
</html>`;
}

/**
 * Open the statement on an A4 landscape sheet and let the operator print or "Save as PDF".
 * Returns `false` when the browser blocked the new window.
 */
export function printVatMarginStatement(statement: VatMarginStatement): boolean {
  return openPrintDocument(buildVatMarginPrintDocument(statement));
}

