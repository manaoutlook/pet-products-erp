import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

/**
 * Regression cover for the downloaded receipt PDF.
 *
 * The PDF used to be typeset with jsPDF's built-in fonts (`doc.text(..., 'helvetica')`) on a
 * fixed 80 x 297 mm page. Those fonts are the Adobe core fonts and have no Vietnamese glyphs,
 * so "Phường" printed as "Ph°êng" and "HỘ" as "HØ"; and because jsPDF's `maxWidth` wrapping
 * did not advance the cursor, the wrapped company name printed straight over the address.
 *
 * The receipt is now laid out in millimetres (utils/receipt-pdf.ts) and rendered once, by the
 * browser, onto a canvas that becomes the page. So the fake below has no `text` method at
 * all: any regression back to `doc.text` fails this suite instead of shipping.
 */
const addImage = vi.fn();
const save = vi.fn();
const createdWith: Array<Record<string, unknown>> = [];

vi.mock('jspdf', () => ({
    jsPDF: class FakeJsPDF {
        constructor(options: Record<string, unknown>) {
            createdWith.push(options);
        }

        addImage(...args: unknown[]) {
            addImage(...args);
        }

        save(...args: unknown[]) {
            save(...args);
        }
    },
}));

import { ReceiptPrinter } from '@/components/POS/ReceiptPrinter';

const company = {
    companyName: 'HỘ KINH DOANH TIỆN ÍCH GIA ĐÌNH',
    registeredAddress: '1D TMT17 KP3, Phường Trung Mỹ Tây, Thành phố Hồ Chí Minh, Việt Nam',
    deliveryAddress: '99 Nguyen Trai, District 5, HCMC',
    taxId: '0861830029',
};

const receiptData = {
    invoiceNumber: 'DC-20261117-0004',
    transactionDate: '2026-11-17T13:32:00.000Z',
    cashierName: 'Admin',
    storeName: 'Smart ERP',
    items: [
        {
            productId: 1,
            product: { id: 1, name: 'Royal Canin Adult 4kg', sku: 'RC-4', price: 22000 },
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

/** Just enough of a 2D context to lay the receipt out and paint it. */
function stubCanvas() {
    const context = {
        font: '',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        textBaseline: '',
        textAlign: '',
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        setLineDash: vi.fn(),
        fillText: vi.fn(),
        // Roughly Courier New at 300 dpi: ~0.6 em per character.
        measureText: (text: string) => ({ width: text.length * 8 }),
    };

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        context as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
        'data:image/png;base64,AAAA'
    );

    return context;
}

describe('ReceiptPrinter PDF download', () => {
    beforeEach(() => {
        createdWith.length = 0;
        addImage.mockClear();
        save.mockClear();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('sends one image of the laid-out receipt to a page as tall as the receipt', async () => {
        const context = stubCanvas();

        render(<ReceiptPrinter receiptData={receiptData} company={company} />);
        fireEvent.click(screen.getByRole('button', { name: /pdf/i }));

        await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

        const options = createdWith[0];
        const format = options.format as [number, number];

        // 80 mm thermal roll, and a height the content chose - not the old fixed 297 mm.
        expect(options.unit).toBe('mm');
        expect(format[0]).toBe(80);
        expect(format[1]).toBeGreaterThan(60);
        expect(format[1]).toBeLessThan(250);

        expect(addImage).toHaveBeenCalledTimes(1);
        const [image, kind, x, y, width, height] = addImage.mock.calls[0];
        expect(kind).toBe('PNG');
        expect(String(image)).toMatch(/^data:image\/png/);
        expect([x, y]).toEqual([0, 0]);
        expect(width).toBe(format[0]);
        expect(height).toBe(format[1]);

        // The Vietnamese letterhead reached the canvas with its diacritics intact.
        const painted = context.fillText.mock.calls.map((call) => String(call[0])).join(' ');
        expect(painted).toContain('Phường');
        expect(painted).toContain('Việt Nam');
        expect(painted).toContain('TOTAL:');

        expect(save).toHaveBeenCalledWith(`receipt-${receiptData.invoiceNumber}.pdf`);
    });
});
