import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PurchaseOrdersPage from '@/pages/PurchaseOrdersPage';

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

/**
 * The only way into the goods receipt flow from this screen is the action row of a purchase
 * order, so these tests pin down that the row renders its buttons for every state of the
 * workflow: nothing done yet, payment sent (receiving allowed), and fully received.
 */
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

function renderPage(order: Record<string, unknown>) {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => [order],
            text: async () => JSON.stringify([order]),
        })) as unknown as typeof fetch,
    );

    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                staleTime: Infinity,
                queryFn: async ({ queryKey }) => {
                    const res = await fetch(queryKey[0] as string, { credentials: 'include' });
                    return res.json();
                },
            },
            mutations: { retry: false },
        },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <PurchaseOrdersPage />
        </QueryClientProvider>
    );
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('PurchaseOrdersPage goods receipt entry point', () => {
    it('renders the Actions column and the receive button for a pending order', async () => {
        renderPage(makeOrder());

        await waitFor(() => expect(screen.getByText('PO-20261108-6894')).toBeInTheDocument());

        expect(screen.getByRole('columnheader', { name: /actions/i })).toBeInTheDocument();
        // Payment not sent yet, so receiving is blocked but the button must still be there.
        expect(screen.getByTitle("Record 'Payment Sent' first")).toBeDisabled();
    });

    it('scrolls the list horizontally instead of squeezing the action buttons', async () => {
        const { container } = renderPage(makeOrder());

        await waitFor(() => expect(screen.getByText('PO-20261108-6894')).toBeInTheDocument());

        // Wide table: the Table wrapper is a horizontal scroll container
        // (`.table-scroll` in index.css = overflow-x auto + a visible scrollbar) ...
        const scrollWrapper = container.querySelector('.table-scroll');
        expect(scrollWrapper).not.toBeNull();
        expect(scrollWrapper!.className).toContain('table-scroll');

        // ... the table refuses to shrink below a readable width and freezes its
        // last column (`.table-actions-sticky`) ...
        const table = scrollWrapper!.querySelector('table');
        expect(table).not.toBeNull();
        expect(table!.className).toContain('min-w-[1100px]');
        expect(table!.className).toContain('table-actions-sticky');

        // ... so the Actions header is the last column - which is exactly the cell
        // `.table-actions-sticky th:last-child` pins to the right edge.
        const actionsHeader = screen.getByRole('columnheader', { name: /actions/i });
        expect(actionsHeader.className).toContain('text-right');
        const headers = screen.getAllByRole('columnheader');
        expect(headers[headers.length - 1]).toBe(actionsHeader);
    });

    it('enables the receive button once payment is sent and units are outstanding', async () => {
        renderPage(
            makeOrder({ actions: [{ id: 1, actionType: 'payment_sent' }] })
        );

        await waitFor(() => expect(screen.getByText('PO-20261108-6894')).toBeInTheDocument());

        const receiveButton = screen.getByTitle('Receive Goods');
        expect(receiveButton).toBeEnabled();
        expect(screen.queryByText('Partially received')).not.toBeInTheDocument();
    });

    it('shows the partial badge and keeps receiving open after a short shipment', async () => {
        renderPage(
            makeOrder({
                actions: [{ id: 1, actionType: 'payment_sent' }, { id: 2, actionType: 'goods_receipt' }],
                goodsReceipts: [{ id: 1, receiptNumber: 'GRN-20261108-0001' }],
                items: [
                    {
                        id: 1,
                        product: { id: 11, name: 'Royal Canin Adult', sku: 'RC-1' },
                        quantity: 10,
                        unitPrice: '69800',
                        totalPrice: '698000',
                        deliveredQuantity: 6,
                    },
                ],
            })
        );

        await waitFor(() => expect(screen.getByText('PO-20261108-6894')).toBeInTheDocument());

        expect(screen.getByText('Partially received')).toBeInTheDocument();
        expect(screen.getByTitle('Receive Goods')).toBeEnabled();
    });

    it('replaces the receive button with a done marker once every line is in', async () => {
        renderPage(
            makeOrder({
                status: 'delivered',
                actions: [{ id: 1, actionType: 'payment_sent' }, { id: 2, actionType: 'goods_receipt' }],
                goodsReceipts: [{ id: 1, receiptNumber: 'GRN-20261108-0001' }],
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
            })
        );

        await waitFor(() => expect(screen.getByText('PO-20261108-6894')).toBeInTheDocument());

        expect(screen.queryByTitle('Receive Goods')).not.toBeInTheDocument();
        expect(screen.getByTitle('Goods received in full')).toBeInTheDocument();
    });
});
