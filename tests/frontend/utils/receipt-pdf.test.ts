import { describe, it, expect } from 'vitest';
import {
  RECEIPT_PAGE_MARGIN_MM,
  RECEIPT_PAGE_WIDTH_MM,
  layoutReceipt,
  type ReceiptMeasurer,
  type ReceiptPdfData,
  type ReceiptPdfLayout,
} from '@/utils/receipt-pdf';

/**
 * Regression cover for the downloaded receipt PDF.
 *
 * The PDF used to be drawn with jsPDF's built-in fonts at fixed coordinates on an
 * 80 x 297 mm page: `maxWidth` wrapped the text but the cursor still advanced one line, so
 * the two-line company name printed straight over the address, and the built-in fonts have
 * no Vietnamese glyphs at all ("Phường" came out as "Ph°êng").
 *
 * The layout below is what the PDF is built from, so these assertions are what keeps it
 * readable: no two lines may share a baseline unless one is a left label and the other a
 * right value, and the page must end where the text ends.
 */
const company = {
  companyName: 'HỘ KINH DOANH TIỆN ÍCH GIA ĐÌNH PET SHOP',
  registeredAddress: '1D TMT17 KP3, Phường Trung Mỹ Tây, Thành phố Hồ Chí Minh, Việt Nam',
  deliveryAddress: '99 Nguyen Trai, District 5, HCMC',
  taxId: '0861830029',
};

const baseData: ReceiptPdfData = {
  invoiceNumber: 'DC-20261117-0004',
  transactionDate: '2026-11-17T13:32:00.000Z',
  cashierName: 'Admin',
  storeName: 'Smart ERP',
  items: [
    {
      product: { name: 'Royal Canin Adult 4kg' },
      quantity: 2,
      unitPrice: 22000,
      totalPrice: 44000,
    },
  ],
  subtotal: 44000,
  tax: 0,
  total: 44000,
  paymentMethod: 'cash',
};

/**
 * Stand-in for the browser's text metrics: wraps on spaces at a per-character width derived
 * from the font size. Deliberately harsher than a real 80 mm receipt so wrapping is certain.
 */
const measure: ReceiptMeasurer = (text, sizePt, _bold, maxWidthMm) => {
  const charWidthMm = sizePt * 0.6 * (25.4 / 72);
  const maxChars = Math.max(4, Math.floor(maxWidthMm / charWidthMm));
  const lines: string[] = [];
  let current = '';

  text.trim().split(/\s+/).forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
      return;
    }
    lines.push(current);
    current = word;
  });

  if (current) lines.push(current);
  return lines;
};

function layout(data: ReceiptPdfData = baseData): ReceiptPdfLayout {
  return layoutReceipt(data, 'VAT (not invoiced)', company, measure);
}

/** Every distinct baseline, top to bottom. */
function baselines(result: ReceiptPdfLayout): number[] {
  return [...new Set(result.texts.map((text) => text.yMm))].sort((a, b) => a - b);
}

describe('receipt PDF layout', () => {
  it('wraps the letterhead and pushes the address below it instead of over it', () => {
    const result = layout();

    const nameLines = result.texts.filter(
      (text) => text.bold && text.align === 'center' && text.sizePt > 8
    );
    expect(nameLines.length).toBeGreaterThan(1);

    const lastCompanyLine = Math.max(...nameLines.map((text) => text.yMm));
    const addressTop = Math.min(
      ...result.texts
        .filter((text) => text.text.startsWith('1D TMT17'))
        .map((text) => text.yMm)
    );

    // The address starts a full line BELOW the wrapped name, not on top of it.
    expect(addressTop).toBeGreaterThan(lastCompanyLine);
    expect(addressTop - lastCompanyLine).toBeGreaterThan(2.5);
  });

  it('never prints two lines on one baseline unless they are a left/right pair', () => {
    const result = layout();

    const byBaseline = new Map<number, string[]>();
    result.texts.forEach((text) => {
      byBaseline.set(text.yMm, [...(byBaseline.get(text.yMm) ?? []), text.align]);
    });

    byBaseline.forEach((aligns) => {
      // A row is exactly one label on the left and one value on the right.
      expect(aligns.length).toBeLessThanOrEqual(2);
      expect(new Set(aligns).size).toBe(aligns.length);
    });

    // ...and consecutive baselines are at least one small line apart.
    const rows = baselines(result);
    rows.slice(1).forEach((value, index) => {
      expect(value - rows[index]).toBeGreaterThan(2);
    });
  });

  it('lays every element out inside the roll and keeps the money on the right margin', () => {
    const result = layout();
    const right = RECEIPT_PAGE_WIDTH_MM - RECEIPT_PAGE_MARGIN_MM;

    expect(result.widthMm).toBe(RECEIPT_PAGE_WIDTH_MM);

    result.texts.forEach((text) => {
      expect(text.yMm).toBeGreaterThan(0);
      expect(text.yMm).toBeLessThan(result.heightMm);
      if (text.align === 'right') expect(text.xMm).toBe(right);
      if (text.align === 'left') expect(text.xMm).toBe(RECEIPT_PAGE_MARGIN_MM);
      if (text.align === 'center') expect(text.xMm).toBe(RECEIPT_PAGE_WIDTH_MM / 2);
    });

    const total = result.texts.find((text) => text.text.startsWith('TOTAL:'));
    expect(total?.bold).toBe(true);
    expect(total?.align).toBe('right');
  });

  it('sizes the page to the receipt instead of padding it out to 297 mm', () => {
    const result = layout();
    const lastBaseline = Math.max(...result.texts.map((text) => text.yMm));

    expect(result.heightMm).toBeLessThan(250);
    expect(result.heightMm).toBeGreaterThan(lastBaseline);
    // The last line is followed by the bottom margin, not by blank paper.
    expect(result.heightMm - lastBaseline).toBeLessThan(10);
  });

  it('grows for a long sale instead of clipping the tail of the receipt', () => {
    const short = layout();
    const long = layout({
      ...baseData,
      items: Array.from({ length: 12 }, (_, index) => ({
        product: { name: `Sản phẩm ${index + 1}` },
        quantity: 1,
        unitPrice: 10000,
        totalPrice: 10000,
      })),
    });

    expect(long.heightMm).toBeGreaterThan(short.heightMm);
    // Every line is still on the page - nothing ran past the bottom edge.
    long.texts.forEach((text) => expect(text.yMm).toBeLessThan(long.heightMm));
    expect(long.texts.some((text) => text.text === 'Smart ERP')).toBe(true);
  });

  it('wraps long product and Vietnamese names instead of truncating them', () => {
    const result = layout({
      ...baseData,
      items: [
        {
          product: { name: 'Thức ăn hạt Royal Canin Mini Adult cho chó nhỏ 8kg' },
          quantity: 1,
          unitPrice: 22000,
          totalPrice: 22000,
        },
      ],
    });

    const printed = result.texts.map((text) => text.text).join(' ');
    expect(printed).not.toContain('...');
    expect(printed).toContain('Royal Canin');
    expect(printed).toContain('8kg');
    // The letterhead keeps its Vietnamese diacritics all the way into the layout.
    expect(printed).toContain('Phường');
    expect(printed).toContain('Việt Nam');
  });

  it('draws the separators and the TOTAL rule on the layout', () => {
    const result = layout();
    expect(result.rules.length).toBeGreaterThanOrEqual(4);
    expect(result.rules.some((rule) => !rule.dashed)).toBe(true);
    result.rules.forEach((rule) => {
      expect(rule.yMm).toBeGreaterThan(0);
      expect(rule.yMm).toBeLessThan(result.heightMm);
    });
  });
});
