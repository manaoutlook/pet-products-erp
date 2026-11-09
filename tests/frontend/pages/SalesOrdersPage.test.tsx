import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SalesOrdersPage from '@/pages/SalesOrdersPage';

// Permissions are not the subject here - always allow, so every action button renders.
vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => ({
        hasPermission: () => true,
        getModulePermissions: () => null,
        getAllowedModules: () => [],
        isAdmin: true,
    }),
}));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

/**
 * Sales Orders screen: status badges, shipping progress, and the frozen-state rules.
 *
 * The screen never writes a status - only cancelling is a user action - so what matters is that
 * the status the API derived is shown, and that actions the API would reject are disabled with a
 * reason instead of failing after the click.
 */
function makeOrder(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        orderNumber: 'SO-20261108-1234',
        customerName: 'Nguyen Van A',
        companyName: 'Pet Shop A',
        contactPerson: 'Mr A',
        phone: '0900000000',
        deliveryAddress: '12 Le Loi, District 1',
        orderDate: '2026-11-08T00:00:00.000Z',
        totalAmount: '1000.00',
        specialInstructions: null,
        status: 'open',
        preparedByUser: { username: 'test_admin' },
        deliveryNotes: [],
        items: [
            {
                id: 1,
                productId: 11,
                productCode: 'TEST-001',
                description: 'Test Product',
                quantity: 10,
                unitPrice: '100.00',
                totalPrice: '1000.00',
                deliveredQuantity: 0,
            },
        ],
        ...overrides,
    };
}

function makeLine(deliveredQuantity: number) {
    return [
        {
            id: 1,
            productId: 11,
            productCode: 'TEST-001',
            description: 'Test Product',
            quantity: 10,
            unitPrice: '100.00',
            totalPrice: '1000.00',
            deliveredQuantity,
        },
    ];
}

function renderPage(orders: Record<string, unknown>[]) {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            // The dialogs mount closed but still ask for their pick lists.
            const body = url.startsWith('/api/sales-orders') ? orders : [];

            return {
                ok: true,
                status: 200,
                json: async () => body,
                text: async () => JSON.stringify(body),
            };
        }) as unknown as typeof fetch
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
            <SalesOrdersPage />
        </QueryClientProvider>
    );
}

function rowFor(orderNumber: string) {
    return screen.getByText(orderNumber).closest('tr') as HTMLTableRowElement;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('SalesOrdersPage', () => {
    it('lists the order with its derived status and shipping progress', async () => {
        renderPage([makeOrder()]);

        await waitFor(() => expect(screen.getByText('SO-20261108-1234')).toBeInTheDocument());

        const row = rowFor('SO-20261108-1234');
        expect(within(row).getByText('Pet Shop A')).toBeInTheDocument();
        expect(within(row).getByText('Open')).toBeInTheDocument();
        expect(within(row).getByText('10 units')).toBeInTheDocument();
    });

    it('shows the partial shipment instead of re-deriving it on the client', async () => {
        renderPage([
            makeOrder({
                status: 'partially_delivered',
                deliveryNotes: [
                    {
                        id: 1,
                        deliveryNoteNumber: 'DN-20261108-1234',
                        deliveryDate: '2026-11-08T00:00:00.000Z',
                    },
                ],
                items: makeLine(6),
            }),
        ]);

        await waitFor(() => expect(screen.getByText('SO-20261108-1234')).toBeInTheDocument());

        const row = rowFor('SO-20261108-1234');
        expect(within(row).getByText('Partially delivered')).toBeInTheDocument();
        expect(within(row).getByText('1 delivery note')).toBeInTheDocument();
        expect(screen.getByTitle('Issue a delivery note')).toBeEnabled();
    });

    it('freezes editing once units have shipped but keeps delivering', async () => {
        renderPage([makeOrder({ status: 'partially_delivered', items: makeLine(4) })]);

        await waitFor(() => expect(screen.getByText('SO-20261108-1234')).toBeInTheDocument());

        expect(screen.getByTitle(/already been delivered/)).toBeDisabled();
        expect(screen.getByTitle('Issue a delivery note')).toBeEnabled();
    });

    it('closes the delivery path once every unit has shipped', async () => {
        renderPage([makeOrder({ status: 'delivered', items: makeLine(10) })]);

        await waitFor(() => expect(screen.getByText('SO-20261108-1234')).toBeInTheDocument());

        expect(screen.getByText('Delivered')).toBeInTheDocument();
        expect(screen.getByTitle('Nothing left to deliver')).toBeDisabled();
    });

    it('refuses to cancel or delete an order that already has delivery notes', async () => {
        renderPage([
            makeOrder({
                status: 'partially_delivered',
                items: makeLine(2),
                deliveryNotes: [
                    {
                        id: 1,
                        deliveryNoteNumber: 'DN-20261108-1234',
                        deliveryDate: '2026-11-08T00:00:00.000Z',
                    },
                ],
            }),
        ]);

        await waitFor(() => expect(screen.getByText('SO-20261108-1234')).toBeInTheDocument());

        expect(screen.getByTitle('An order with delivery notes cannot be cancelled')).toBeDisabled();
        expect(screen.getByTitle('An order with delivery notes cannot be deleted')).toBeDisabled();
    });

    it('cancels an open order after confirmation', async () => {
        renderPage([makeOrder()]);

        await waitFor(() => expect(screen.getByText('SO-20261108-1234')).toBeInTheDocument());

        const user = userEvent.setup();
        await user.click(screen.getByTitle('Cancel sales order'));

        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText('Cancel this sales order?')).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: 'Cancel order' }));

        await waitFor(() =>
            expect(fetch).toHaveBeenCalledWith(
                '/api/sales-orders/1/cancel',
                expect.objectContaining({ method: 'POST' })
            )
        );
    });

    it('renders an empty state when there are no orders', async () => {
        renderPage([]);

        await waitFor(() => expect(screen.getByText('No sales orders yet.')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /raise the first order/i })).toBeInTheDocument();
    });
});
