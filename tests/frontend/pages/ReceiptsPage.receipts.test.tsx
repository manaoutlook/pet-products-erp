import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReceiptsPage from '@/pages/ReceiptsPage';

/**
 * The two receipt registers.
 *
 * The till receipts table is the only place a cashier can reprint or void a completed sale, so
 * these tests pin what the row exposes for each status (cancel only while the sale still stands,
 * refund only once it is completed) and what each action sends to the server.
 */

const mocks = vi.hoisted(() => ({
    toast: vi.fn(),
    user: { id: 1, username: 'test_admin' } as { id: number; username: string } | null,
    canRead: true,
    canUpdate: true,
}));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: mocks.toast, toasts: [], dismiss: vi.fn() }),
}));

vi.mock('@/hooks/use-user', () => ({
    useUser: () => ({ user: mocks.user }),
}));

vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => ({
        hasPermission: (module: string, action: string) =>
            action === 'read' ? mocks.canRead : mocks.canUpdate,
        getModulePermissions: () => null,
        getAllowedModules: () => [],
    }),
}));

vi.mock('@/hooks/use-company', () => ({
    useCompanyInfo: () => ({ company: null, header: null, missingFields: [], valid: false, isLoading: false }),
}));

vi.mock('@/components/POS/ReceiptPrinter', () => ({
    ReceiptPrinter: () => <div>Receipt preview</div>,
}));

vi.mock('@/components/Receipts/CustomerReceiptsPanel', () => ({
    CustomerReceiptsPanel: () => <div>Customer receipts register</div>,
}));

vi.mock('@/components/POS/InvoicePrint', () => ({
    InvoicePrintDialog: ({ invoice }: { invoice: { invoiceNumber: string } | null }) => (
        <div>Invoice dialog {invoice?.invoiceNumber}</div>
    ),
}));

function makeTransaction(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        invoiceNumber: 'STR001-20261119-0001',
        transactionDate: '2026-11-19T03:00:00.000Z',
        totalAmount: '110000',
        subtotal: '100000',
        vatAmount: '10000',
        vatRate: '0.1',
        paymentMethod: 'CASH',
        status: 'completed',
        printedWithVat: true,
        cashierUser: { id: 1, username: 'test_admin' },
        store: { id: 1, name: 'Test Store 1' },
        items: [
            {
                id: 1,
                productId: 11,
                quantity: 1,
                unitPrice: '100000',
                totalPrice: '100000',
                description: null,
                productCode: null,
                product: { id: 11, name: 'Dog Food', sku: 'SKU-1' },
            },
        ],
        ...overrides,
    };
}

const json = (data: unknown, ok = true) => ({
    ok,
    status: ok ? 200 : 400,
    json: async () => data,
    text: async () => JSON.stringify(data),
});

function renderPage(
    transactions: Record<string, unknown>[] = [makeTransaction()],
    options: { onPost?: (url: string, body: unknown) => unknown; invoice?: unknown } = {},
) {
    const stub = vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split('?')[0];
        if (init?.method === 'POST' && options.onPost) {
            return options.onPost(path, init.body ? JSON.parse(String(init.body)) : null);
        }
        if (path.endsWith('/invoice')) return options.invoice ?? json({ invoice: { invoiceNumber: 'STR001-20261119-0001' } });
        return json(transactions);
    });
    vi.stubGlobal('fetch', stub);

    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                staleTime: Infinity,
                queryFn: async ({ queryKey }) => {
                    const response = await fetch(String(queryKey[0]), { credentials: 'include' });
                    return response.json();
                },
            },
            mutations: { retry: false },
        },
    });

    render(
        <QueryClientProvider client={queryClient}>
            <ReceiptsPage />
        </QueryClientProvider>,
    );

    return stub;
}

afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
    mocks.toast.mockClear();
    mocks.user = { id: 1, username: 'test_admin' };
    mocks.canRead = true;
    mocks.canUpdate = true;
});

describe('ReceiptsPage - till receipts', () => {
    it('lists each sale with the status the customer would see', async () => {
        renderPage([
            makeTransaction(),
            makeTransaction({
                id: 2,
                invoiceNumber: 'STR001-20261119-0002',
                status: 'cancelled',
                cashierUser: null,
                store: null,
                totalAmount: '50000',
            }),
            makeTransaction({ id: 3, invoiceNumber: 'STR001-20261119-0003', status: 'refunded' }),
            makeTransaction({ id: 4, invoiceNumber: 'STR001-20261119-0004', status: 'pending' }),
        ]);

        expect(await screen.findByText('STR001-20261119-0001')).toBeInTheDocument();
        expect(screen.getByText('Completed')).toBeInTheDocument();
        expect(screen.getByText('Cancelled')).toBeInTheDocument();
        expect(screen.getByText('Refunded')).toBeInTheDocument();
        // An unknown status is shown as itself rather than silently looking like a sale.
        expect(screen.getByText('pending')).toBeInTheDocument();
        // Missing cashier / store fall back to something printable.
        expect(screen.getByText('Unknown')).toBeInTheDocument();
        expect(screen.getByText('DC')).toBeInTheDocument();
    });

    it('cancels a completed sale after confirmation', async () => {
        const posts: unknown[] = [];
        renderPage([makeTransaction()], {
            onPost: (path, body) => {
                posts.push({ path, body });
                return json({});
            },
        });
        const user = userEvent.setup();

        await user.click(await screen.findByRole('button', { name: /^cancel$/i }));
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText(/Are you sure you want to cancel transaction STR001-20261119-0001/i)).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: /cancel transaction/i }));

        await waitFor(() => expect(posts).toHaveLength(1));
        expect(posts[0]).toEqual({
            path: '/api/sales-transactions/1/cancel',
            body: { reason: 'Cancelled by user' },
        });
        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Transaction Cancelled' }),
            ),
        );
    });

    it('reports a refused cancellation', async () => {
        renderPage([makeTransaction()], {
            onPost: () => json({ message: 'Sale already refunded' }, false),
        });
        const user = userEvent.setup();

        await user.click(await screen.findByRole('button', { name: /^cancel$/i }));
        const dialog = await screen.findByRole('alertdialog');
        await user.click(within(dialog).getByRole('button', { name: /cancel transaction/i }));

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Cancellation Failed', description: 'Sale already refunded' }),
            ),
        );
    });
});

describe('ReceiptsPage - refunds and invoices', () => {
    it('refunds a completed sale with the amount and reason typed in', async () => {
        const posts: unknown[] = [];
        renderPage([makeTransaction()], {
            onPost: (path, body) => {
                posts.push({ path, body });
                return json({});
            },
        });
        const user = userEvent.setup();

        await user.click(await screen.findByRole('button', { name: /^refund$/i }));
        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText(/refund amount/i), '55000');
        await user.type(within(dialog).getByLabelText(/reason for refund/i), 'Defective product');
        await user.click(within(dialog).getByRole('button', { name: 'Process Refund' }));

        await waitFor(() => expect(posts).toHaveLength(1));
        expect(posts[0]).toEqual({
            path: '/api/sales-transactions/1/refund',
            body: { refundAmount: '55000', reason: 'Defective product' },
        });
        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Refund Processed' }),
            ),
        );
    });

    it('refunds in full when no amount is typed', async () => {
        const posts: unknown[] = [];
        renderPage([makeTransaction()], {
            onPost: (path, body) => {
                posts.push({ path, body });
                return json({});
            },
        });
        const user = userEvent.setup();

        await user.click(await screen.findByRole('button', { name: /^refund$/i }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'Process Refund' }));

        await waitFor(() => expect(posts).toHaveLength(1));
        expect(posts[0]).toEqual({
            path: '/api/sales-transactions/1/refund',
            body: { refundAmount: undefined, reason: 'Refund processed' },
        });
    });

    it('reports a refused refund', async () => {
        renderPage([makeTransaction()], {
            onPost: () => json({ message: 'Refund exceeds the sale' }, false),
        });
        const user = userEvent.setup();

        await user.click(await screen.findByRole('button', { name: /^refund$/i }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'Process Refund' }));

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Refund Failed', description: 'Refund exceeds the sale' }),
            ),
        );
    });

    it('offers refund only for a completed sale', async () => {
        renderPage([makeTransaction({ status: 'cancelled' })]);

        expect(await screen.findByText('STR001-20261119-0001')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^refund$/i })).not.toBeInTheDocument();
    });

    it('opens the receipt preview for reprinting', async () => {
        renderPage();
        const user = userEvent.setup();

        await user.click(await screen.findByRole('button', { name: /^view$/i }));

        expect(await screen.findByText('Receipt preview')).toBeInTheDocument();
    });

    it('opens the A4 invoice of the sale', async () => {
        renderPage();
        const user = userEvent.setup();

        await user.click(await screen.findByRole('button', { name: /^invoice$/i }));

        expect(await screen.findByText(/Invoice dialog STR001-20261119-0001/)).toBeInTheDocument();
    });

    it('tells the operator when the invoice cannot be loaded', async () => {
        renderPage([makeTransaction()], { invoice: json({ message: 'Sale not found' }, false) });
        const user = userEvent.setup();

        await user.click(await screen.findByRole('button', { name: /^invoice$/i }));

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Invoice unavailable', description: 'Sale not found' }),
            ),
        );
    });

    it('searches the register on the server', async () => {
        const stub = renderPage();
        const user = userEvent.setup();

        await user.type(await screen.findByLabelText(/search by invoice number/i), 'STR001');
        await user.click(screen.getByRole('button', { name: /^search$/i }));

        await waitFor(() =>
            expect(stub.mock.calls.some(([url]) => String(url).includes('search=STR001'))).toBe(true),
        );
    });
});

describe('ReceiptsPage - access', () => {
    it('asks a signed-out visitor to log in', async () => {
        mocks.user = null;

        renderPage();

        expect(await screen.findByText('Please log in to access receipts')).toBeInTheDocument();
    });

    it('refuses a user without receipts.read', async () => {
        mocks.canRead = false;

        renderPage();

        expect(await screen.findByText('Access Denied')).toBeInTheDocument();
    });
});


