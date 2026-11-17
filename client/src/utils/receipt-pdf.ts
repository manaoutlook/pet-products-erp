/**
 * The receipt as an 80 mm thermal PDF - the same sheet the cashier previews, on paper.
 *
 * AI Agent Note: this used to be drawn with `doc.text(..., 'helvetica')` at hard-coded
 * millimetre coordinates on a fixed 80 x 297 mm page, and it broke in two ways:
 *
 * 1. GLYPHS. jsPDF's built-in fonts are the Adobe core fonts (WinAnsi), which carry no
 *    Vietnamese characters - "Phường" printed as "Ph°êng" and "HỘ" as "HØ". A Vietnamese
 *    receipt cannot be typeset with a font that has no Vietnamese.
 * 2. LAYOUT. `doc.text(text, x, y, { maxWidth })` wraps, but the cursor was still advanced
 *    by one line, so the two-line company name and the two-line address were printed on top
 *    of each other; and anything past 297 mm simply fell off the page.
 *
 * The receipt is now LAID OUT here (wrapped lines, one baseline each, in millimetres) and
 * RENDERED by the browser onto a 300 dpi canvas, which is embedded in the PDF as one image.
 * That gives the file exactly the glyphs and the wrapping of the on-screen preview, and the
 * page is exactly as tall as its content.
 *
 * Before "simplifying" this back to `doc.text`, note that vector text here would have to be
 * ASCII-only or ship an embedded Unicode font (~300 KB of base64) with the bundle.
 */
import { companyHeaderPrintLines, type CompanyHeader } from '@shared/company';
import { BRAND_NAME, BRAND_WEBSITE } from '@/config/branding';
import { formatCurrency, formatDateTime } from '@/utils/format';

/** Thermal roll width the receipt is designed for. */
export const RECEIPT_PAGE_WIDTH_MM = 80;

/** Blank margin on every side of the roll. */
export const RECEIPT_PAGE_MARGIN_MM = 5;

/**
 * Raster resolution. 203 dpi is a thermal head's own resolution; 300 keeps the glyph edges
 * clean on a phone screen and still compresses to a small PNG because it is black on white.
 */
export const RECEIPT_RENDER_DPI = 300;

/** Points are the font-size unit everywhere else in the app; millimetres are the page. */
const MM_PER_PT = 25.4 / 72;

const PX_PER_MM = RECEIPT_RENDER_DPI / 25.4;

/** The preview and the print sheet are monospace ("paper"); the PDF matches them. */
const FONT_STACK = '"Courier New", Courier, monospace';

/** What the receipt says. `ReceiptData` (the component) satisfies this structurally. */
export interface ReceiptPdfData {
  invoiceNumber: string;
  transactionDate: string;
  cashierName: string;
  storeName?: string;
  items: Array<{
    product: { name: string };
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
}

/** One line of text, already wrapped, positioned by its baseline. */
export interface ReceiptPdfText {
  text: string;
  /** Left edge, centre or right edge - see `align`. */
  xMm: number;
  /** Baseline, measured from the top of the page. */
  yMm: number;
  sizePt: number;
  bold: boolean;
  align: 'left' | 'center' | 'right';
}

/** A separator, or the rule above TOTAL. */
export interface ReceiptPdfRule {
  yMm: number;
  dashed: boolean;
  lineWidthPt: number;
}

export interface ReceiptPdfLayout {
  widthMm: number;
  /** Exactly as tall as the content - a receipt must never spill onto a blank page. */
  heightMm: number;
  texts: ReceiptPdfText[];
  rules: ReceiptPdfRule[];
}

/**
 * Wrap `text` to `maxWidthMm`, returning one entry per printed line.
 *
 * Injected rather than called directly so the layout can be tested without a canvas, and so
 * every line is wrapped by the same metrics that later draw it.
 */
export type ReceiptMeasurer = (
  text: string,
  sizePt: number,
  bold: boolean,
  maxWidthMm: number
) => string[];

/** CSS font shorthand for a receipt line, at the render resolution. */
export function receiptFont(sizePt: number, bold: boolean): string {
  return `${bold ? 'bold ' : 'normal '}${(sizePt / 72) * RECEIPT_RENDER_DPI}px ${FONT_STACK}`;
}

/**
 * Font sizes, in points. The letterhead is larger than the body (it is the shop's name), the
 * TOTAL is the one number the customer looks for - and a thermal receipt is 80 mm wide, so
 * "larger than the body" still means 9-10 pt, not the 12-16 pt of an A4 heading.
 */
const SIZE = {
  companyName: 9,
  letterhead: 6.5,
  storeName: 8,
  title: 7.5,
  body: 7.5,
  small: 6.5,
  total: 9.5,
} as const;

/** Distance between two baselines of one block: a little more than the font size. */
function leadingMm(sizePt: number): number {
  return round(sizePt * MM_PER_PT * 1.4);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Lay the receipt out, top to bottom, and report the page size it needs.
 *
 * Every element advances the cursor by the height it actually occupies, so a wrapped
 * letterhead or a two-line product name pushes what follows it down instead of printing over
 * it - the bug this file exists to prevent.
 */
export function layoutReceipt(
  data: ReceiptPdfData,
  vatLabel: string,
  company: Partial<CompanyHeader> | null | undefined,
  measure: ReceiptMeasurer
): ReceiptPdfLayout {
  const widthMm = RECEIPT_PAGE_WIDTH_MM;
  const left = RECEIPT_PAGE_MARGIN_MM;
  const right = widthMm - RECEIPT_PAGE_MARGIN_MM;
  const centre = widthMm / 2;
  const contentWidthMm = right - left;

  const texts: ReceiptPdfText[] = [];
  const rules: ReceiptPdfRule[] = [];

  /** Top of the next line, in millimetres. */
  let cursor = RECEIPT_PAGE_MARGIN_MM;

  /**
   * Draw one wrapped block and advance past it. `cursor` is the top of the block's first
   * line; the baseline sits a little below it so the ascenders are not clipped.
   */
  const block = (
    text: string,
    options: {
      sizePt: number;
      bold?: boolean;
      align?: 'left' | 'center' | 'right';
      widthMm?: number;
      gapAfterMm?: number;
    }
  ): void => {
    const align = options.align ?? 'left';
    const bold = options.bold ?? false;
    const lineHeight = leadingMm(options.sizePt);
    const x = align === 'center' ? centre : align === 'right' ? right : left;
    const lines = measure(text, options.sizePt, bold, options.widthMm ?? contentWidthMm);

    lines.forEach((line, index) => {
      texts.push({
        text: line,
        xMm: x,
        yMm: round(cursor + index * lineHeight + lineHeight * 0.78),
        sizePt: options.sizePt,
        bold,
        align,
      });
    });

    cursor += lines.length * lineHeight + (options.gapAfterMm ?? 0);
  };

  /**
   * Label on the left, value on the right - the layout of a till receipt. Whichever side
   * wraps determines how far the cursor moves, so the two can never collide.
   */
  const row = (
    label: string,
    value: string,
    options: { sizePt: number; bold?: boolean; valueWidthMm: number; gapAfterMm?: number }
  ): void => {
    const bold = options.bold ?? false;
    const lineHeight = leadingMm(options.sizePt);
    const labelWidthMm = Math.max(contentWidthMm - options.valueWidthMm - 2, 10);
    const labelLines = measure(label, options.sizePt, bold, labelWidthMm);
    const valueLines = measure(value, options.sizePt, bold, options.valueWidthMm);
    const top = cursor;

    labelLines.forEach((line, index) => {
      texts.push({
        text: line,
        xMm: left,
        yMm: round(top + index * lineHeight + lineHeight * 0.78),
        sizePt: options.sizePt,
        bold,
        align: 'left',
      });
    });

    valueLines.forEach((line, index) => {
      texts.push({
        text: line,
        xMm: right,
        yMm: round(top + index * lineHeight + lineHeight * 0.78),
        sizePt: options.sizePt,
        bold,
        align: 'right',
      });
    });

    cursor += Math.max(labelLines.length, valueLines.length) * lineHeight;
    cursor += options.gapAfterMm ?? 0;
  };

  const rule = (dashed: boolean, lineWidthPt: number, gapAfterMm: number): void => {
    rules.push({ yMm: round(cursor), dashed, lineWidthPt });
    cursor += gapAfterMm;
  };

  // ---- Letterhead: the same lines, in the same order, as every other document ----
  companyHeaderPrintLines(company).forEach((line) => {
    const text = line.label.length > 0 ? `${line.label}: ${line.value}` : line.value;
    block(text, {
      sizePt: line.emphasis ? SIZE.companyName : SIZE.letterhead,
      bold: line.emphasis,
      align: 'center',
      gapAfterMm: line.emphasis ? 1 : 0.5,
    });
  });

  if (data.storeName) {
    block(data.storeName, { sizePt: SIZE.storeName, align: 'center', gapAfterMm: 0.5 });
  }

  block('Point of Sale Receipt', { sizePt: SIZE.title, align: 'center', gapAfterMm: 2 });
  rule(true, 0.4, 2);

  // ---- Transaction ----
  row('Invoice:', data.invoiceNumber, { sizePt: SIZE.body, valueWidthMm: 42 });
  row('Date:', formatDateTime(data.transactionDate), { sizePt: SIZE.body, valueWidthMm: 42 });
  row('Cashier:', data.cashierName, { sizePt: SIZE.body, valueWidthMm: 42 });
  row('Payment:', data.paymentMethod.toUpperCase(), {
    sizePt: SIZE.body,
    valueWidthMm: 42,
    gapAfterMm: 1.5,
  });

  rule(true, 0.4, 2);

  // ---- Items ----
  data.items.forEach((item) => {
    // No truncation: a long product name wraps, exactly as it does in the preview.
    row(item.product.name, formatCurrency(item.unitPrice), {
      sizePt: SIZE.body,
      valueWidthMm: 20,
      gapAfterMm: 0.2,
    });
    row(`Qty: ${item.quantity}`, `Total: ${formatCurrency(item.totalPrice)}`, {
      sizePt: SIZE.small,
      valueWidthMm: 34,
      gapAfterMm: 1.5,
    });
  });

  rule(true, 0.4, 2);

  // ---- Totals ----
  block(`Subtotal: ${formatCurrency(data.subtotal)}`, {
    sizePt: SIZE.body,
    align: 'right',
    gapAfterMm: 0.5,
  });
  block(`${vatLabel}: ${formatCurrency(data.tax)}`, {
    sizePt: SIZE.body,
    align: 'right',
    gapAfterMm: 1.5,
  });
  rule(false, 0.8, 1.5);
  block(`TOTAL: ${formatCurrency(data.total)}`, {
    sizePt: SIZE.total,
    bold: true,
    align: 'right',
    gapAfterMm: 2,
  });

  rule(true, 0.4, 2);

  // ---- Footer ----
  block('Thank you for your business!', { sizePt: SIZE.small, align: 'center' });
  block('Please keep this receipt for your records', {
    sizePt: SIZE.small,
    align: 'center',
    gapAfterMm: 2,
  });
  block(BRAND_NAME, { sizePt: SIZE.body, align: 'center' });
  block(BRAND_WEBSITE, { sizePt: SIZE.small, align: 'center' });

  return {
    widthMm,
    // The page ends a margin below the last baseline: no fixed 297 mm of blank paper.
    heightMm: round(cursor + RECEIPT_PAGE_MARGIN_MM),
    texts,
    rules,
  };
}

let measuringCanvas: HTMLCanvasElement | null = null;

function measureContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measuringCanvas) measuringCanvas = document.createElement('canvas');
  return measuringCanvas.getContext('2d');
}

/**
 * The measurer the PDF uses: the browser's own text metrics at the render resolution, so a
 * line is wrapped by exactly the metrics that later draw it.
 */
export const measureReceiptText: ReceiptMeasurer = (text, sizePt, bold, maxWidthMm) => {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const context = measureContext();
  // No canvas (older browser, jsdom): one line is better than a thrown download.
  if (!context) return [trimmed];

  const maxWidthPx = maxWidthMm * PX_PER_MM;
  context.font = receiptFont(sizePt, bold);

  const lines: string[] = [];
  let current = '';

  trimmed.split(/\s+/).forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidthPx || !current) {
      current = candidate;
      return;
    }
    lines.push(current);
    current = word;
  });

  if (current) lines.push(current);
  return lines;
};

/**
 * Draw the laid-out receipt and return a PNG data URL, ready for `doc.addImage`.
 *
 * Raster on purpose: the canvas uses the system fonts, so Vietnamese is rendered by the same
 * engine that renders the preview. jsPDF's own fonts cannot do that (see the note at the top).
 */
export function renderReceiptImage(layout: ReceiptPdfLayout): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(layout.widthMm * PX_PER_MM);
  canvas.height = Math.ceil(layout.heightMm * PX_PER_MM);

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('This browser cannot render the receipt to a canvas');
  }

  // White paper, black ink - the preview and the print sheet do the same.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  context.strokeStyle = '#000000';
  context.textBaseline = 'alphabetic';

  layout.rules.forEach((rule) => {
    const y = rule.yMm * PX_PER_MM;
    context.lineWidth = Math.max((rule.lineWidthPt / 72) * RECEIPT_RENDER_DPI, 1);
    context.setLineDash(rule.dashed ? [1 * PX_PER_MM, 1 * PX_PER_MM] : []);
    context.beginPath();
    context.moveTo(RECEIPT_PAGE_MARGIN_MM * PX_PER_MM, y);
    context.lineTo((layout.widthMm - RECEIPT_PAGE_MARGIN_MM) * PX_PER_MM, y);
    context.stroke();
  });
  context.setLineDash([]);

  layout.texts.forEach((text) => {
    context.font = receiptFont(text.sizePt, text.bold);
    context.textAlign = text.align;
    context.fillText(text.text, text.xMm * PX_PER_MM, text.yMm * PX_PER_MM);
  });

  return canvas.toDataURL('image/png');
}
