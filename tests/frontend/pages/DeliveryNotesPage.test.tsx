import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DeliveryNotesPage from '@/pages/DeliveryNotesPage';

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
 * Delivery Notes screen - the goods-out paper trail.
 *
 * Notes are issued from a sales order and never edited, so the screen only lists, filters and
 * reprints them. These tests pin the three things a dispatcher reads off a row: which order it
 * belongs to, how many units physically shipped, and whether the customer signed for them.
 */
function makeNote(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        deliveryNoteNumber: 'DN-20261108-1234',
        deliveryDate: '2026-11-08T00:00:00.000Z',
        customerName: 'Nguyen Van A',
        companyName: 'Pet Shop A',
        contactPerson: 'Mr A',
        phone: '0900000000',
        deliveryAddress: '12 Le Loi, District 1',
        customerConfirmed: false,
        remarks: null,
        status: 'issued',
        salesOrder: { id: 1, orderNumber: 'SO-20261108-1234', customerName: 'Nguyen Van A', status: 'delivered' },
        deliveredByUser: { id: 1, username: 'test_admin' },
        items: [
            {
                id: 1,
                productCode: 'TEST-001',
                description: 'Test Product',
                orderedQuantity: 10,
                deliveredQuantity: 6,
            },
            {
                id: 2,
                productCode: 'TEST-002',
                description: 'Second Product',
                orderedQuantity: 4,
                deliveredQuantity: 4,
            },
        ],
        ...overrides,
    };
}

function renderPage(notes: Record<string, unknown>[]) {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            const body = url.startsWith('/api/delivery-notes')
                ? notes
                : url.startsWith('/api/sales-orders')
                  ? []
                  : [];

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
            <DeliveryNotesPage />
        </QueryClientProvider>
    );
}

function rowFor(noteNumber: string) {
    return screen.getByText(noteNumber).closest('tr') as HTMLTableRowElement;
}

afterEach(() => {
    vi.unstubAllGlobals();
});


describe('DeliveryNotesPage', () => {
    it('lists the note with its sales order and the units that actually shipped', async () => {
        renderPage([makeNote()]);

        await waitFor(() => expect(screen.getByText('DN-20261108-1234')).toBeInTheDocument());

        const row = rowFor('DN-20261108-1234');
        expect(within(row).getByText('SO-20261108-1234')).toBeInTheDocument();
        expect(within(row).getByText('Nguyen Van A')).toBeInTheDocument();
        // 6 + 4 units across two lines, not the 14 that were ordered.
        expect(within(row).getByText('10')).toBeInTheDocument();
    });

    it('flags a note the customer has not signed for yet', async () => {
        renderPage([makeNote({ customerConfirmed: false })]);

        await waitFor(() => expect(screen.getByText('DN-20261108-1234')).toBeInTheDocument());

        expect(screen.getByText('Awaiting signature')).toBeInTheDocument();
        expect(screen.queryByText('Confirmed')).not.toBeInTheDocument();
    });

    it('shows the sign-off once the customer has confirmed receipt', async () => {
        renderPage([makeNote({ customerConfirmed: true })]);

        await waitFor(() => expect(screen.getByText('DN-20261108-1234')).toBeInTheDocument());

        expect(screen.getByText('Confirmed')).toBeInTheDocument();
        expect(screen.queryByText('Awaiting signature')).not.toBeInTheDocument();
    });

    it('hints that the parent order is still short of units', async () => {
        renderPage([
            makeNote({
                salesOrder: {
                    id: 1,
                    orderNumber: 'SO-20261108-1234',
                    customerName: 'Nguyen Van A',
                    status: 'partially_delivered',
                },
            }),
        ]);

        await waitFor(() => expect(screen.getByText('DN-20261108-1234')).toBeInTheDocument());

        const row = rowFor('DN-20261108-1234');
        expect(within(row).getByText('Partially delivered')).toBeInTheDocument();
    });

    it('filters the list by customer and by order number', async () => {
        renderPage([
            makeNote(),
            makeNote({
                id: 2,
                deliveryNoteNumber: 'DN-20261108-9999',
                customerName: 'Tran Thi B',
                salesOrder: {
                    id: 2,
                    orderNumber: 'SO-20261108-9999',
                    customerName: 'Tran Thi B',
                    status: 'delivered',
                },
            }),
        ]);

        await waitFor(() => expect(screen.getByText('DN-20261108-1234')).toBeInTheDocument());

        const user = userEvent.setup();
        const search = screen.getByPlaceholderText(/search note no/i);

        await user.type(search, 'Tran Thi B');
        await waitFor(() => expect(screen.queryByText('DN-20261108-1234')).not.toBeInTheDocument());
        expect(screen.getByText('DN-20261108-9999')).toBeInTheDocument();

        await user.clear(search);
        await user.type(search, 'SO-20261108-1234');
        await waitFor(() => expect(screen.getByText('DN-20261108-1234')).toBeInTheDocument());
        expect(screen.queryByText('DN-20261108-9999')).not.toBeInTheDocument();
    });

    it('offers to issue a note from the empty state and opens the dialog', async () => {
        renderPage([]);

        await waitFor(() => expect(screen.getByText(/No delivery notes yet/i)).toBeInTheDocument());

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: /issue a delivery note/i }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('New Delivery Note')).toBeInTheDocument();
    });

    it('reprints a note from its row', async () => {
        renderPage([makeNote()]);

        await waitFor(() => expect(screen.getByText('DN-20261108-1234')).toBeInTheDocument());

        const user = userEvent.setup();
        await user.click(screen.getByTitle('Print delivery note'));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Delivery Note - DN-20261108-1234')).toBeInTheDocument();
    });
});
