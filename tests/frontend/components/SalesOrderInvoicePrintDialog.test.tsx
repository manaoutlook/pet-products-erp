import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SalesOrderInvoicePrintDialog } from '@/components/SalesOrders/SalesOrderInvoicePrint';
import type { SalesOrderInvoicePayload } from '@shared/invoice';

/**
 * The "VAT Invoice" dialog of a sales order.
 *
 * Its whole job is to keep the one irreversible action (issuing the number) behind an explicit
 * click, and to explain itself instead of failing when the order cannot be invoiced: no number
 * yet, a cancelled order, a user without permission, a seller snapshot with missing fields.
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

const invoice: SalesOrderInvoicePayload = {
    salesOrderId: 7,
    orderNumber: 'SO-20261115-0001',
    invoiceNumber: 'CI-20261115-0001',
    invoiceDate: '2026-11-15T10:00:00.000Z',
    seller: { name: 'Conqueror International', taxId: '0312362838', address: '12 Nguyen Hue' },
    sellerMissingFields: [],
    buyer: {
        name: 'Pet Shop A',
        companyName: 'Pet Shop A',
        taxId: '0319999999',
        address: '99 Le Loi',
        phone: '0900000000',
    },
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
    vatRate: 0.1,
    vatAmount: 100_000,
    total: 1_100_000,
    currency: 'VND',
};

const json = (data: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
});

const openDialog = async (props: Partial<React.ComponentProps<typeof SalesOrderInvoicePrintDialog>> = {}) => {
    const user = userEvent.setup();
    render(
        <SalesOrderInvoicePrintDialog order={{ id: 7, orderNumber: 'SO-20261115-0001' }} {...props}>
            <button type="button">Open invoice</button>
        </SalesOrderInvoicePrintDialog>,
    );
    await user.click(screen.getByRole('button', { name: /open invoice/i }));
    return user;
};

describe('SalesOrderInvoicePrintDialog', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        mocks.toast.mockClear();
        mocks.openPrintDocument.mockClear();
        mocks.openPrintDocument.mockReturnValue(true);
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('shows the issued invoice and prints the same document', async () => {
        fetchMock.mockResolvedValue(json({ invoice }));

        const user = await openDialog();

        const frame = await screen.findByTitle('VAT invoice CI-20261115-0001');
        expect(frame.getAttribute('srcdoc')).toContain('Conqueror International');
        expect(fetchMock).toHaveBeenCalledWith('/api/sales-orders/7/vat-invoice', { credentials: 'include' });

        await user.click(screen.getByRole('button', { name: /print invoice/i }));
        expect(mocks.openPrintDocument).toHaveBeenCalledTimes(1);
        expect(String(mocks.openPrintDocument.mock.calls[0][0])).toContain('CI-20261115-0001');
    });

    it('warns when printing is blocked by the browser', async () => {
        fetchMock.mockResolvedValue(json({ invoice }));
        mocks.openPrintDocument.mockReturnValue(false);

        const user = await openDialog();

        const print = await screen.findByRole('button', { name: /print invoice/i });
        await user.click(print);

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Print Blocked' })),
        );
    });

    it('offers to issue the invoice when no number exists yet', async () => {
        fetchMock.mockResolvedValueOnce(json({ message: 'Not issued' }, 404));
        fetchMock.mockResolvedValueOnce(json({ invoice }));

        const user = await openDialog();

        expect(
            await screen.findByText(/no vat invoice has been issued for this order yet/i),
        ).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /issue vat invoice/i }));

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'VAT invoice issued',
                    description: 'CI-20261115-0001 - print it and send it with the delivery note.',
                }),
            ),
        );
        expect(await screen.findByTitle('VAT invoice CI-20261115-0001')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenLastCalledWith(
            '/api/sales-orders/7/vat-invoice',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('refuses to invoice a cancelled order', async () => {
        fetchMock.mockResolvedValue(json({ message: 'Not issued' }, 404));

        await openDialog({ order: { id: 7, orderNumber: 'SO-20261115-0001', status: 'cancelled' } });

        expect(await screen.findByText(/cancelled order cannot be invoiced/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /issue vat invoice/i })).toBeDisabled();
    });

    it('explains that issuing needs permission instead of hiding the button', async () => {
        fetchMock.mockResolvedValue(json({ message: 'Not issued' }, 404));

        await openDialog({ canIssue: false });

        expect(await screen.findByText(/do not have permission to issue invoices/i)).toBeInTheDocument();
        // A read-only user can still see the document, so the action stays visible but disabled.
        expect(screen.getByRole('button', { name: /issue vat invoice/i })).toBeDisabled();
    });

    it('shows the server reason when the invoice cannot be loaded', async () => {
        fetchMock.mockResolvedValue(json({ message: 'Order has no VAT company' }, 500));

        await openDialog();

        expect(await screen.findByText('Invoice unavailable')).toBeInTheDocument();
        expect(screen.getByText('Order has no VAT company')).toBeInTheDocument();
    });

    it('falls back to its own message when the failure has no JSON body', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => Promise.reject(new Error('not json')),
        });

        await openDialog();

        expect(await screen.findByText('Failed to load the VAT invoice')).toBeInTheDocument();
    });

    it('stays printable when only some seller details are missing, and says which', async () => {
        fetchMock.mockResolvedValue(
            json({ invoice: { ...invoice, sellerMissingFields: ['Tax code'] } }),
        );

        await openDialog();

        expect(await screen.findByText('Seller details incomplete')).toBeInTheDocument();
        expect(screen.getByText(/Tax code is missing/)).toBeInTheDocument();
        // A missing tax code must not produce a printed tax invoice.
        expect(screen.getByRole('button', { name: /print invoice/i })).toBeDisabled();
    });

    it('pluralises the missing-field list', async () => {
        fetchMock.mockResolvedValue(
            json({ invoice: { ...invoice, sellerMissingFields: ['Tax code', 'Address'] } }),
        );

        await openDialog();

        expect(await screen.findByText(/Tax code, Address are missing/)).toBeInTheDocument();
    });

    it('reports a failed issue without losing the dialog', async () => {
        fetchMock.mockResolvedValueOnce(json({ message: 'Not issued' }, 404));
        fetchMock.mockResolvedValueOnce(json({ message: 'Sequence is locked' }, 409));

        const user = await openDialog();

        await user.click(await screen.findByRole('button', { name: /issue vat invoice/i }));

        expect(await screen.findByText('Sequence is locked')).toBeInTheDocument();
        expect(screen.queryByTitle(/VAT invoice/)).not.toBeInTheDocument();
    });

    it('uses a generic message when issuing fails without a JSON body', async () => {
        fetchMock.mockResolvedValueOnce(json({ message: 'Not issued' }, 404));
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: async () => Promise.reject(new Error('not json')),
        });

        const user = await openDialog();

        await user.click(await screen.findByRole('button', { name: /issue vat invoice/i }));

        expect(await screen.findByText('Failed to issue the VAT invoice')).toBeInTheDocument();
    });
});
