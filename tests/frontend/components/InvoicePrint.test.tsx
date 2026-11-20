import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InvoicePayload } from '@shared/invoice';
import {
    archiveInvoiceDocument,
    buildInvoiceDocumentHtml,
    invoicePrintBlocker,
    InvoicePrintDialog,
} from '@/components/POS/InvoicePrint';

/**
 * The A4 invoice: the document text itself, the rule that decides whether it may print at all,
 * and the dialog that archives the issued copy.
 *
 * The payload is everything the document prints - so these tests vary the payload, not the
 * code: VAT vs retail, cancelled vs completed, a complete seller vs one still missing its tax
 * code, and buyer text that tries to inject markup into the sheet.
 */

const mocks = vi.hoisted(() => ({
    toast: vi.fn(),
    openPrintDocument: vi.fn(() => true),
}));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: mocks.toast, toasts: [], dismiss: vi.fn() }),
}));

vi.mock('@/utils/print-document', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/utils/print-document')>()),
    openPrintDocument: mocks.openPrintDocument,
}));

const baseInvoice: InvoicePayload = {
    transactionId: 42,
    invoiceNumber: 'STR001-20261119-0001',
    invoiceDate: '2026-11-19T03:00:00.000Z',
    kind: 'RETAIL',
    withVat: false,
    status: 'completed',
    seller: {
        name: 'Pet Shop Household Business',
        taxId: '0312345678',
        address: '12 Le Loi, District 1',
        phone: null,
        bankAccount: null,
    },
    sellerMissingFields: [],
    buyer: null,
    lines: [
        {
            lineNumber: 1,
            productCode: 'PC-RM-002',
            description: 'Nasal Hair Trimmer',
            quantity: 2,
            unitPrice: 500_000,
            lineTotal: 1_000_000,
        },
    ],
    subtotal: 1_000_000,
    vatRate: 0,
    vatAmount: 0,
    total: 1_000_000,
    paymentMethod: 'CASH',
    cashierName: 'test_admin',
    storeName: 'Test Store 1',
    currency: 'VND',
    archivedDocumentUrl: null,
    archivedAt: null,
    notes: [],
};

function makeInvoice(overrides: Partial<InvoicePayload> = {}): InvoicePayload {
    return { ...baseInvoice, ...overrides };
}

const vatInvoice = () =>
    makeInvoice({
        kind: 'VAT',
        withVat: true,
        vatRate: 0.1,
        vatAmount: 100_000,
        subtotal: 1_000_000,
        total: 1_100_000,
        buyer: {
            name: 'Pet Shop A',
            companyName: 'Pet Shop A Co., Ltd.',
            taxId: '0319999999',
            address: '99 Le Loi',
            phone: '0900000000',
        },
        seller: {
            name: 'Conqueror International',
            taxId: '0312362838',
            address: '12 Nguyen Hue',
            phone: '0281234567',
            bankAccount: '0123456789 - Vietcombank',
        },
    });

describe('buildInvoiceDocumentHtml', () => {
    it('prints a retail sale as a sales invoice with no VAT line charged', () => {
        const html = buildInvoiceDocumentHtml(makeInvoice());

        expect(html).toContain('SALES INVOICE');
        expect(html).toContain('Hóa đơn bán hàng');
        // A household business cannot issue VAT, so the sheet says so instead of printing 0%.
        expect(html).toContain('No VAT invoice issued');
        expect(html).not.toContain('VAT (');
        expect(html).toContain('STR001-20261119-0001');
        expect(html).toContain('Nasal Hair Trimmer');
        expect(html).toContain('VND');
    });

    it('prints a VAT invoice with the rate, the amount and the seller bank account', () => {
        const html = buildInvoiceDocumentHtml(vatInvoice());

        expect(html).toContain('VAT INVOICE');
        expect(html).toContain('Hóa đơn giá trị gia tăng');
        expect(html).toContain('VAT (10%)');
        expect(html).toContain('Pet Shop A Co., Ltd.');
        expect(html).toContain('0281234567');
        expect(html).toContain('0123456789 - Vietcombank');
        expect(html).not.toContain('No VAT invoice issued');
    });

    it('stamps a cancelled sale and prints its notes', () => {
        const html = buildInvoiceDocumentHtml(
            makeInvoice({ status: 'voided', notes: ['Voided: customer returned the goods', 'Reprinted by admin'] }),
        );

        expect(html).toContain('class="stamp"');
        expect(html).toContain('CANCELLED');
        expect(html).toContain('Voided: customer returned the goods');
        expect(html).toContain('Reprinted by admin');
    });

    it('leaves the stamp and the notes block out when they do not apply', () => {
        const html = buildInvoiceDocumentHtml(makeInvoice());

        expect(html).not.toContain('CANCELLED');
        // The class is declared in the stylesheet either way - what must be absent is the block.
        expect(html).not.toContain('<div class="notes-line">');
    });

    it('keeps the table shape for an invoice with no lines', () => {
        const html = buildInvoiceDocumentHtml(makeInvoice({ lines: [] }));

        expect(html).toContain('<td colspan="6">&nbsp;</td>');
    });

    it('escapes buyer and product text so it cannot inject markup', () => {
        const html = buildInvoiceDocumentHtml(
            makeInvoice({
                lines: [
                    {
                        lineNumber: 1,
                        productCode: 'X-1',
                        description: '<script>alert(1)</script>',
                        quantity: 1,
                        unitPrice: 1,
                        lineTotal: 1,
                    },
                ],
                seller: { ...baseInvoice.seller, name: 'A & B <Trading>' },
            }),
        );

        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('A &amp; B &lt;Trading&gt;');
    });
});

describe('invoicePrintBlocker', () => {
    it('refuses while the seller letterhead is incomplete', () => {
        const blocker = invoicePrintBlocker(
            makeInvoice({ sellerMissingFields: ['Tax code', 'Address'] }),
        );

        expect(blocker).toContain('Tax code, Address');
        expect(blocker).toContain('Company Profile or VAT Companies');
    });

    it('refuses a VAT invoice without a buyer', () => {
        const blocker = invoicePrintBlocker(vatInvoiceWith({ buyer: null }));

        expect(blocker).toBe(
            'A VAT invoice needs a buyer. Enter the buyer details at checkout before completing the sale.',
        );
    });

    it('refuses a VAT invoice whose buyer has no name', () => {
        const blocker = invoicePrintBlocker(
            vatInvoiceWith({
                buyer: { name: '   ', companyName: 'Nameless Co.', taxId: null, address: null, phone: null },
            }),
        );

        expect(blocker).toContain('needs a buyer');
    });

    it('allows a retail sale with no buyer at all', () => {
        // Nothing on a retail invoice is legally required from the buyer.
        expect(invoicePrintBlocker(makeInvoice({ buyer: null }))).toBeNull();
    });

    it('allows a complete VAT invoice', () => {
        expect(invoicePrintBlocker(vatInvoice())).toBeNull();
    });
});

/** A VAT payload, so the VAT-only rules can be varied without repeating the fixture. */
function vatInvoiceWith(overrides: Partial<InvoicePayload> = {}): InvoicePayload {
    return { ...vatInvoice(), ...overrides };
}

describe('archiveInvoiceDocument', () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts the document and returns the stored URL', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ archivedDocumentUrl: '/uploads/invoices/x.html', created: true }),
        });

        const result = await archiveInvoiceDocument(42, '<html></html>');

        expect(result).toEqual({ archivedDocumentUrl: '/uploads/invoices/x.html', created: true });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/sales-transactions/42/invoice/archive',
            expect.objectContaining({
                method: 'POST',
                credentials: 'include',
                body: JSON.stringify({ document: '<html></html>' }),
            }),
        );
    });

    it('surfaces the server message when archiving is refused', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            json: async () => ({ message: 'Sale not found' }),
        });

        await expect(archiveInvoiceDocument(42, '<html></html>')).rejects.toThrow('Sale not found');
    });

    it('falls back to its own message when the refusal has no JSON body', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            json: async () => Promise.reject(new Error('not json')),
        });

        await expect(archiveInvoiceDocument(42, '<html></html>')).rejects.toThrow(
            'Failed to archive the invoice',
        );
    });
});

describe('InvoicePrintDialog', () => {
    const fetchMock = vi.fn();
    const onOpenChange = vi.fn();
    const onArchived = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        onOpenChange.mockReset();
        onArchived.mockReset();
        mocks.openPrintDocument.mockClear();
        mocks.openPrintDocument.mockReturnValue(true);
        mocks.toast.mockClear();
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(window, 'open').mockReturnValue({
            document: { write: vi.fn(), close: vi.fn() },
            print: vi.fn(),
        } as unknown as Window);
        vi.stubGlobal('URL', Object.assign(URL, {
            createObjectURL: vi.fn(() => 'blob:invoice'),
            revokeObjectURL: vi.fn(),
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    /** First call archives, second serves the stored copy - the shape the dialog produces. */
    function respondWithArchive() {
        fetchMock.mockImplementation(async (url: string) => {
            if (String(url).endsWith('/invoice/archive')) {
                return {
                    ok: true,
                    json: async () => ({ archivedDocumentUrl: '/uploads/invoices/42.html', created: true }),
                };
            }
            return { ok: true, text: async () => '<html>archived</html>' };
        });
    }

    const renderDialog = (invoice: InvoicePayload | null, props: { loading?: boolean } = {}) =>
        render(
            <InvoicePrintDialog
                invoice={invoice}
                open
                onOpenChange={onOpenChange}
                onArchived={onArchived}
                loading={props.loading}
            />,
        );

    const printButton = () => screen.getByRole('button', { name: /print/i });

    it('shows a spinner while the payload is loading', () => {
        renderDialog(null, { loading: true });

        expect(screen.getByText(/preparing the invoice/i)).toBeInTheDocument();
        expect(printButton()).toBeDisabled();
    });

    it('archives the issued copy on first open and previews it', async () => {
        respondWithArchive();

        renderDialog(makeInvoice());

        await waitFor(() => expect(onArchived).toHaveBeenCalled());
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/sales-transactions/42/invoice/archive',
            expect.objectContaining({ method: 'POST' }),
        );

        const frame = await screen.findByTitle(/invoice STR001-20261119-0001/i);
        await waitFor(() =>
            expect(frame.getAttribute('srcdoc')).toContain('Nasal Hair Trimmer'),
        );
    });

    it('previews the stored copy when one already exists, without archiving again', async () => {
        fetchMock.mockResolvedValue({ ok: true, text: async () => '<html>archived copy</html>' });

        renderDialog(
            makeInvoice({
                archivedDocumentUrl: '/uploads/invoices/42.html',
                archivedAt: '2026-11-19T04:00:00.000Z',
            }),
        );

        const frame = await screen.findByTitle(/invoice/i);
        await waitFor(() => expect(frame.getAttribute('srcdoc')).toBe('<html>archived copy</html>'));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('/uploads/invoices/42.html', { credentials: 'include' });
    });

    it('falls back to the freshly built document when the archive cannot be read', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fetchMock.mockResolvedValue({ ok: false, text: async () => '' });

        renderDialog(makeInvoice({ archivedDocumentUrl: '/uploads/invoices/gone.html' }));

        const frame = await screen.findByTitle(/invoice/i);
        await waitFor(() =>
            expect(frame.getAttribute('srcdoc')).toContain('Nasal Hair Trimmer'),
        );
    });

    it('keeps printing possible when archiving fails, and says so', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'Disk full' }) });

        renderDialog(makeInvoice());

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Invoice not archived', description: 'Disk full' }),
            ),
        );
        expect(printButton()).toBeEnabled();
    });

    it('replaces the preview with the reason when the document may not print', async () => {
        renderDialog(makeInvoice({ sellerMissingFields: ['Tax code'] }));

        expect(await screen.findByText('Invoice cannot be printed')).toBeInTheDocument();
        expect(screen.getByText(/Tax code/)).toBeInTheDocument();
        expect(printButton()).toBeDisabled();
        expect(screen.getByRole('button', { name: /open \/ save as pdf/i })).toBeDisabled();
        // Nothing was archived for a document that cannot be issued.
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('prints once the preview is ready', async () => {
        respondWithArchive();
        const user = userEvent.setup();

        renderDialog(makeInvoice());
        await waitFor(() => expect(printButton()).toBeEnabled());
        await user.click(printButton());

        await waitFor(() => expect(mocks.openPrintDocument).toHaveBeenCalled());
        expect(String(mocks.openPrintDocument.mock.calls[0][0])).toContain('Nasal Hair Trimmer');
    });

    it('warns when the print window is blocked', async () => {
        respondWithArchive();
        mocks.openPrintDocument.mockReturnValue(false);
        const user = userEvent.setup();

        renderDialog(makeInvoice());
        await waitFor(() => expect(printButton()).toBeEnabled());
        await user.click(printButton());

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Print Blocked' })),
        );
    });

    it('opens the document in a tab, warning when the pop-up is blocked', async () => {
        respondWithArchive();
        const user = userEvent.setup();

        renderDialog(makeInvoice());
        const openButton = screen.getByRole('button', { name: /open \/ save as pdf/i });
        await waitFor(() => expect(openButton).toBeEnabled());

        await user.click(openButton);
        expect(window.open).toHaveBeenCalled();
        expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Pop-up blocked' }));

        vi.mocked(window.open).mockReturnValueOnce(null);
        await user.click(openButton);

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Pop-up blocked' })),
        );
    });
});

