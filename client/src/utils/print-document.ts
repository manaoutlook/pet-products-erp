/**
 * Printable A4 documents (sales orders, delivery notes).
 *
 * The receipt printer (`components/POS/ReceiptPrinter.tsx`) proved the pattern: build a
 * standalone HTML document with its own CSS and let the browser print it. Copying
 * `element.innerHTML` into a new window does not work - the Tailwind classes travel with
 * the markup but the stylesheet does not, so every layout collapses on paper.
 *
 * Everything that reaches the sheet is escaped: a customer name containing `&` or a product
 * description containing `<` must never be able to break the document.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape a value for interpolation into the print document. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Blank line for a missing field, so the printed form keeps its shape. */
export function printValue(value: unknown): string {
  const escaped = escapeHtml(value).trim();
  return escaped.length > 0 ? escaped : '&nbsp;';
}

/**
 * Shared sheet CSS: A4 portrait, white paper, black ink, 10 mm margins.
 * Kept in one place so a sales order and a delivery note look like they came from the
 * same office and still fit on one page after the customer prints them.
 */
export const PRINT_DOCUMENT_STYLES = `
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    line-height: 1.35;
    color: #000;
    background: #fff;
  }
  h1 { font-size: 18px; letter-spacing: 2px; margin: 0; text-align: center; }
  .brand { font-size: 12px; font-weight: bold; margin: 0; text-align: center; }
  .subtitle { font-size: 10px; color: #333; margin: 2px 0 0; text-align: center; }
  .header { border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
  .meta { display: flex; gap: 24px; margin-top: 10px; font-size: 11px; }
  .meta div { flex: 1; }
  .label { font-weight: bold; }
  .section-title {
    font-size: 11px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin: 14px 0 6px;
    border-bottom: 1px solid #999;
    padding-bottom: 3px;
  }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .grid .wide { grid-column: 1 / -1; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #000; padding: 4px 6px; font-size: 10.5px; vertical-align: top; }
  th { background: #eee; text-align: left; font-weight: bold; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.center, th.center { text-align: center; }
  tfoot td { font-weight: bold; }
  .notes { margin-top: 12px; min-height: 48px; border: 1px solid #000; padding: 6px; white-space: pre-wrap; }
  .confirmation { margin-top: 14px; font-size: 10.5px; }
  .box { display: inline-block; width: 10px; height: 10px; border: 1px solid #000; margin-right: 6px; vertical-align: -1px; }
  .box.checked:after { content: 'X'; font-size: 9px; font-weight: bold; display: block; text-align: center; line-height: 10px; }
  .signatures { display: flex; gap: 32px; margin-top: 28px; }
  .signature { flex: 1; text-align: center; }
  .signature .role { font-weight: bold; }
  .signature .hint { font-size: 10px; color: #333; }
  .signature .line { margin-top: 56px; border-top: 1px dashed #000; padding-top: 4px; font-size: 10px; }
  .footer { margin-top: 18px; border-top: 1px solid #999; padding-top: 6px; font-size: 9.5px; color: #333; text-align: center; }
  tr { page-break-inside: avoid; }
`;

/** Wrap a document body in the full A4 sheet. */
export function buildPrintDocument(title: string, body: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>${PRINT_DOCUMENT_STYLES}</style>
  </head>
  <body>${body}</body>
</html>`;
}

/**
 * Open the document in a new window and print it.
 *
 * Returns `false` when the browser blocked the pop-up - the caller shows the "allow
 * pop-ups" toast instead of failing silently.
 */
export function openPrintDocument(html: string): boolean {
  if (typeof window === 'undefined') return false;

  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.print();
  return true;
}
