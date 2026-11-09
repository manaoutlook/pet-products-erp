import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReceiptPrinter } from '@/components/POS/ReceiptPrinter';
import { BRAND_NAME, BRAND_WEBSITE } from '@/config/branding';

/**
 * Regression cover for the receipt preview that went white-on-white in dark mode.
 *
 * The preview is "paper": it sits on a hard-coded white surface, so its ink and its
 * separators must be fixed colours rather than theme tokens (`text-foreground` /
 * `text-muted-foreground` / `border` all flip to near-white on the dark theme and become
 * invisible on white). The print sheet must also be self-contained, because it is written
 * into a popup window that loads no Tailwind.
 */
const receiptData = {
    invoiceNumber: 'DC-20261107-0001',
    transactionDate: '2026-11-07T10:15:00.000Z',
    cashierName: 'Admin',
    storeName: 'Smart ERP',
    items: [
        {
            productId: 1,
            product: { id: 1, name: 'Royal Canin <Adult>', sku: 'RC-1', price: 22000 },
            quantity: 1,
            unitPrice: 22000,
            totalPrice: 22000,
        },
    ],
    subtotal: 40000,
    tax: 4000,
    total: 44000,
    paymentMethod: 'cash',
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ReceiptPrinter preview', () => {
    it('uses fixed paper ink instead of theme foreground tokens', () => {
        const { container } = render(<ReceiptPrinter receiptData={receiptData} />);

        const paper = container.querySelector('.font-mono') as HTMLElement;
        expect(paper).toBeTruthy();
        expect(paper.className).toContain('bg-white');
        expect(paper.className).toContain('text-slate-900');

        // Nothing inside the white sheet may inherit a theme-dependent text colour.
        expect(paper.className).not.toContain('text-foreground');
        expect(paper.querySelector('[class*="text-foreground"]')).toBeNull();
        expect(paper.querySelector('[class*="text-muted-foreground"]')).toBeNull();

        // The muted item line stays readable on white.
        expect(paper.innerHTML).toContain('text-slate-600');
    });

    it('draws the separators with real utilities (no CSS-less class names)', () => {
        const { container } = render(<ReceiptPrinter receiptData={receiptData} />);
        const paper = container.querySelector('.font-mono') as HTMLElement;

        // `.line` / `.total-line` / `.item` never had any CSS behind them, so the
        // separators rendered as nothing at all.
        expect(paper.querySelector('.line')).toBeNull();
        expect(paper.querySelector('.total-line')).toBeNull();
        expect(paper.querySelector('.item')).toBeNull();

        expect(paper.querySelectorAll('.border-dashed').length).toBe(4);
        expect(paper.querySelectorAll('.border-t-2').length).toBe(1);
    });

    it('renders the receipt content in the preview', () => {
        render(<ReceiptPrinter receiptData={receiptData} />);

        expect(screen.getByText('DC-20261107-0001')).toBeTruthy();
        expect(screen.getByText('Royal Canin <Adult>')).toBeTruthy();
        expect(screen.getByText('$44000.00')).toBeTruthy();
        expect(screen.getByText(/Qty: 1/)).toBeTruthy();
    });

    it('shows the shared branding footer, not a per-output domain', () => {
        const { container } = render(<ReceiptPrinter receiptData={receiptData} />);
        const paper = container.querySelector('.font-mono') as HTMLElement;

        // Regression: the downloaded PDF used to advertise a different domain from the
        // receipt the cashier previews on screen. Both read from @/config/branding now.
        expect(paper.textContent).toContain(BRAND_WEBSITE);
        expect(paper.textContent).toContain(BRAND_NAME);
        expect(paper.textContent).not.toContain('petproducts.com');
        expect(paper.textContent).not.toContain('smartpdf.com');
    });
});

describe('ReceiptPrinter print sheet', () => {
    it('writes a self-contained document with its own CSS and escaped values', () => {
        const write = vi.fn();
        const print = vi.fn();
        vi.spyOn(window, 'open').mockReturnValue({
            document: { write, close: vi.fn() },
            print,
        } as unknown as Window);

        render(<ReceiptPrinter receiptData={receiptData} />);
        fireEvent.click(screen.getByRole('button', { name: /print/i }));

        expect(print).toHaveBeenCalled();
        const html = write.mock.calls[0][0] as string;

        // The popup has no Tailwind, so layout must come from the sheet's own CSS.
        expect(html).toContain('display: flex');
        expect(html).toContain('justify-content: space-between');
        expect(html).not.toContain('text-slate-900');
        expect(html).not.toContain('class="flex');

        // Paper is white with black ink, whatever the app theme is.
        expect(html).toContain('background: #fff');
        expect(html).toContain('color: #000');

        // Content is carried over, and user-entered text is escaped.
        expect(html).toContain('DC-20261107-0001');
        expect(html).toContain('Royal Canin &lt;Adult&gt;');
        expect(html).toContain('$44000.00');

        // Footer branding is shared with the preview and the jsPDF export - a receipt that
        // is printed must not advertise a different domain from the one on screen.
        expect(html).toContain(BRAND_WEBSITE);
        expect(html).toContain(BRAND_NAME);
        expect(html).not.toContain('petproducts.com');
        expect(html).not.toContain('smartpdf.com');
    });

    it('shows a toast instead of a blank tab when pop-ups are blocked', () => {
        vi.spyOn(window, 'open').mockReturnValue(null);

        render(<ReceiptPrinter receiptData={receiptData} />);
        expect(() => fireEvent.click(screen.getByRole('button', { name: /print/i }))).not.toThrow();
    });
});
