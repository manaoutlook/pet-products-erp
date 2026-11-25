import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PurchaseOrdersPage from '@/pages/PurchaseOrdersPage';

/**
 * The Purchase Orders screen beyond the goods-receipt entry point (covered next door): the
 * action row, the two detail dialogs, and printing.
 *
 * An action is a one-way paper trail - "Payment Sent" unlocks receiving, a cancel freezes the
 * order - so each button is checked against the state that allows it and the state that must not.
 */

const mocks = vi.hoisted(() => ({
    toast: vi.fn(),
    printPurchaseOrder: vi.fn(() => true),
    company: null as Record<string, string> | null,
}));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: mocks.toast, toasts: [], dismiss: vi.fn() }),
}));

vi.mock('@/components/PurchaseOrders/PurchaseOrderPrint', () => ({
    printPurchaseOrder: mocks.printPurchaseOrder,
}));

vi.mock('@/hooks/use-company', () => ({
    useCompanyInfo: () => ({
        company: mocks.company,
        header: mocks.company,
        missingFields: [],
        valid: Boolean(mocks.company),
        isLoading: false,
    }),
}));

vi.mock('@/components/PurchaseOrders/CreatePurchaseOrderDialog', () => ({
    CreatePurchaseOrderDialog: () => <button type="button">New purchase order</button>,
}));

vi.mock('@/components/PurchaseOrders/EditPurchaseOrderDialog', () => ({
    EditPurchaseOrderDialog: () => <button type="button">Edit order dates</button>,
}));

vi.mock('@/components/PurchaseOrders/ReceiveGoodsDialog', () => ({
    ReceiveGoodsDialog: ({ disabled }: { disabled?: boolean }) => (
        <button type="button" disabled={disabled}>
            Receive goods
        </button>
    ),
}));

const completeCompany = {
    companyName: 'Pet Products Trading Co., Ltd.',
    registeredAddress: '12 Le Loi, District 1',
    deliveryAddress: '99 Nguyen Trai, District 5',
    taxId: '0312345678',
};

function makeAction(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        actionType: 'payment_sent',
        performedAt: '2026-11-10T03:00:00.000Z',
        performedByUser: { id: 1, username: 'test_admin' },
        ...overrides,
    };
}

function makeOrder(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        orderNumber: 'PO-20261108-6894',
        supplier: { id: 1, name: 'HENGLO INDUSTRIAL LIMITED' },
        createdAt: '2026-11-08T00:00:00.000Z',
        deliveryDate: '2026-11-20T00:00:00.000Z',
        totalAmount: 698000,
        status: 'pending',
        actions: [],
        goodsReceipts: [],
        notes: null,
        items: [
            {
                id: 1,
                product: { id: 11, name: 'Royal Canin Adult', sku: 'RC-1' },
                quantity: 10,
                unitPrice: '69800',
                totalPrice: '698000',
                deliveredQuantity: 0,
            },
        ],
        ...overrides,
    };
}

const json = (data: unknown, ok = true) => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
    text: async () => JSON.stringify(data),
});

function renderPage(
    orders: Record<string, unknown>[],
    options: { details?: Record<string, unknown> | null; onPost?: (url: string, body: unknown) => unknown } = {},
) {
    const stub = vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split('?')[0];
        if (init?.method === 'POST' && options.onPost) {
            return options.onPost(path, init.body ? JSON.parse(String(init.body)) : null);
        }
        if (/^\/api\/purchase-orders\/\d+$/.test(path)) {
            return options.details === null ? json({ message: 'nope' }, false) : json(options.details ?? orders[0]);
        }
        return json(orders);
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
            <PurchaseOrdersPage />
        </QueryClientProvider>,
    );

    return stub;
}

afterEach(() => {
    vi.unstubAllGlobals();
    mocks.toast.mockClear();
    mocks.printPurchaseOrder.mockReset();
    mocks.printPurchaseOrder.mockReturnValue(true);
    mocks.company = null;
});

describe('PurchaseOrdersPage actions', () => {
    it('records "Payment Sent" and announces it', async () => {
        const posts: unknown[] = [];
        renderPage([makeOrder({ actions: [makeAction({ actionType: 'invoice_received' })] })], {
            onPost: (path, body) => {
                posts.push({ path, body });
                return json({});
            },
        });
        const user = userEvent.setup();

        await user.click(await screen.findByTitle('Mark Payment Sent'));

        await waitFor(() => expect(posts).toHaveLength(1));
        expect(posts[0]).toEqual({
            path: '/api/purchase-orders/1/actions',
            body: { actionType: 'payment_sent' },
        });
        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' })),
        );
    });

    it('reports a refused action instead of pretending it worked', async () => {
        renderPage([makeOrder()], { onPost: () => json({ message: 'Order is cancelled' }, false) });
        const user = userEvent.setup();

        await user.click(await screen.findByTitle('Cancel Order'));

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Error', description: 'Order is cancelled' }),
            ),
        );
    });

    it('freezes every action on a cancelled order and closes the receive path', async () => {
        renderPage([makeOrder({ status: 'cancelled', actions: [] })]);

        expect(await screen.findByTitle('Cancel Order')).toBeDisabled();
        expect(screen.getByTitle('Mark Payment Sent')).toBeDisabled();
        expect(screen.getByRole('button', { name: /receive goods/i })).toBeDisabled();
    });

    it('shows the done marker once every unit has arrived', async () => {
        renderPage([
            makeOrder({
                items: [
                    {
                        id: 1,
                        product: { id: 11, name: 'Royal Canin Adult', sku: 'RC-1' },
                        quantity: 10,
                        unitPrice: '69800',
                        totalPrice: '698000',
                        deliveredQuantity: 10,
                    },
                ],
            }),
        ]);

        expect(await screen.findByTitle('Goods received in full')).toBeDisabled();
        expect(screen.queryByRole('button', { name: /receive goods/i })).not.toBeInTheDocument();
    });
});

describe('PurchaseOrdersPage list controls', () => {
    it('narrows the list with the search box', async () => {
        renderPage([
            makeOrder({ id: 1, orderNumber: 'PO-20261108-6894', supplier: { id: 1, name: 'HENGLO' } }),
            makeOrder({ id: 2, orderNumber: 'PO-20261109-1111', supplier: { id: 2, name: 'ACME PETS' } }),
        ]);
        const user = userEvent.setup();

        expect(await screen.findByText('PO-20261108-6894')).toBeInTheDocument();
        await user.type(screen.getByPlaceholderText(/search purchase orders/i), 'acme');

        await waitFor(() => expect(screen.queryByText('PO-20261108-6894')).not.toBeInTheDocument());
        expect(screen.getByText('PO-20261109-1111')).toBeInTheDocument();
    });

    it('sorts by a column header and filters a single column', async () => {
        renderPage([
            makeOrder({ id: 1, orderNumber: 'PO-20261108-0002', totalAmount: 200 }),
            makeOrder({ id: 2, orderNumber: 'PO-20261108-0001', totalAmount: 100 }),
        ]);
        const user = userEvent.setup();

        await screen.findByText('PO-20261108-0002');
        await user.click(screen.getByRole('button', { name: /order number/i }));

        const firstRow = () => screen.getAllByRole('row')[1];
        await waitFor(() => expect(within(firstRow()).getByText('PO-20261108-0001')).toBeInTheDocument());

        await user.type(screen.getByPlaceholderText(/filter order no\./i), '0002');
        await waitFor(() => expect(screen.queryByText('PO-20261108-0001')).not.toBeInTheDocument());
    });

    it('marks a short shipment as partially received', async () => {
        renderPage([
            makeOrder({
                goodsReceipts: [{ id: 1, receiptNumber: 'GRN-1' }],
                items: [
                    {
                        id: 1,
                        product: { id: 11, name: 'Royal Canin Adult', sku: 'RC-1' },
                        quantity: 10,
                        unitPrice: '69800',
                        totalPrice: '698000',
                        deliveredQuantity: 4,
                    },
                ],
            }),
        ]);

        expect(await screen.findByText('Partially received')).toBeInTheDocument();
    });

    it('shows a loading line while the list is on its way', async () => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as unknown as typeof fetch);
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                    queryFn: async ({ queryKey }) => {
                        const response = await fetch(String(queryKey[0]));
                        return response.json();
                    },
                },
            },
        });

        render(
            <QueryClientProvider client={queryClient}>
                <PurchaseOrdersPage />
            </QueryClientProvider>,
        );

        expect(await screen.findByText('Loading purchase orders...')).toBeInTheDocument();
    });
});

describe('PurchaseOrdersPage dialogs and printing', () => {
    it('shows the order details, falling back to the main warehouse', async () => {
        renderPage([makeOrder()], {
            details: makeOrder({ notes: 'Deliver before noon', destinationStore: null }),
        });
        const user = userEvent.setup();

        await user.click(await screen.findByTitle('View Order Details'));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/Purchase Order Details - PO-20261108-6894/)).toBeInTheDocument();
        expect(await within(dialog).findByText(/Deliver before noon/)).toBeInTheDocument();
        // No destination store on the order: the goods go to the main warehouse.
        expect(within(dialog).getByText('Main Warehouse')).toBeInTheDocument();
        expect(within(dialog).getByText('Royal Canin Adult')).toBeInTheDocument();
    });

    it('says so when the order details cannot be loaded', async () => {
        renderPage([makeOrder()], { details: null });
        const user = userEvent.setup();

        await user.click(await screen.findByTitle('View Order Details'));

        expect(await screen.findByText('Failed to load order details')).toBeInTheDocument();
    });

    it('lists the action history newest first, with a fallback for unknown users', async () => {
        renderPage([
            makeOrder({
                actions: [
                    makeAction({ id: 1, actionType: 'payment_sent', performedAt: '2026-11-10T03:00:00.000Z' }),
                    makeAction({
                        id: 2,
                        actionType: 'goods_receipt',
                        performedAt: '2026-11-12T03:00:00.000Z',
                        performedByUser: null,
                    }),
                    makeAction({ id: 3, actionType: 'cancel', performedAt: '2026-11-13T03:00:00.000Z' }),
                ],
            }),
        ]);
        const user = userEvent.setup();

        await user.click(await screen.findByTitle('View Action History'));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Payment Sent')).toBeInTheDocument();
        expect(within(dialog).getByText('Goods Receipt Processed')).toBeInTheDocument();
        expect(within(dialog).getByText('Order Cancelled')).toBeInTheDocument();
        expect(within(dialog).getByText('Unknown user')).toBeInTheDocument();

        const titles = within(dialog)
            .getAllByRole('heading', { level: 4 })
            .map((heading) => heading.textContent);
        expect(titles).toEqual(['Order Cancelled', 'Goods Receipt Processed', 'Payment Sent']);
    });

    it('shows an empty timeline for an order nobody has touched', async () => {
        renderPage([makeOrder()]);
        const user = userEvent.setup();

        await user.click(await screen.findByTitle('View Action History'));

        expect(await screen.findByText('No actions recorded yet')).toBeInTheDocument();
    });

    it('refuses to print while the company letterhead is incomplete', async () => {
        mocks.company = null;
        renderPage([makeOrder()]);
        const user = userEvent.setup();

        await user.click(await screen.findByTitle('Print Order'));

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Company letterhead incomplete' }),
            ),
        );
        expect(mocks.printPurchaseOrder).not.toHaveBeenCalled();
    });

    it('warns when the print window is blocked', async () => {
        mocks.company = completeCompany;
        mocks.printPurchaseOrder.mockReturnValue(false);
        renderPage([makeOrder()]);
        const user = userEvent.setup();

        await user.click(await screen.findByTitle('Print Order'));

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Print Blocked' })),
        );
    });

    it('records the print in the action history once the paper is produced', async () => {
        mocks.company = completeCompany;
        const posts: unknown[] = [];
        renderPage([makeOrder()], {
            onPost: (path, body) => {
                posts.push({ path, body });
                return json({});
            },
        });
        const user = userEvent.setup();

        await user.click(await screen.findByTitle('Print Order'));

        await waitFor(() => expect(posts).toHaveLength(1));
        expect(posts[0]).toEqual({ path: '/api/purchase-orders/1/actions', body: { actionType: 'print' } });
    });
});

