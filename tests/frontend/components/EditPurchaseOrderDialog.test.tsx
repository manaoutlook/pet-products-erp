import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EditPurchaseOrderDialog } from '@/components/PurchaseOrders/EditPurchaseOrderDialog';
import { BACK_DATED_PURCHASE_ORDER_MESSAGE } from '@shared/purchase-order-dates';

/**
 * Correcting the dates of a purchase order.
 *
 * The order date is not decoration: it is the day the order's "Supplier purchases" expense sits
 * on in Finance, and the expected delivery date is what the overdue report counts from. These
 * tests pin the two promises the dialog makes: the request carries only what actually changed,
 * and back-dating is refused for everyone who is not an administrator (the server enforces the
 * same rule on PUT /api/purchase-orders/:id).
 */

const mocks = vi.hoisted(() => ({
    toast: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: mocks.toast, toasts: [], dismiss: vi.fn() }),
}));

/** The tests run as an administrator unless a test says otherwise. */
const permissions = vi.hoisted(() => ({ isAdmin: true }));

vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => ({
        isAdmin: permissions.isAdmin,
        hasPermission: () => true,
        can: () => true,
        getModulePermissions: () => null,
        getAllowedModules: () => [],
        role: undefined,
        isLoading: false,
    }),
}));

/** Local datetime string for `datetime-local` inputs - the same shape the dialog reads. */
function toInputValue(date: Date): string {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function makeOrder(overrides: Record<string, unknown> = {}) {
    return {
        id: 7,
        orderNumber: 'PO-20261125-7651',
        createdAt: '2026-11-25T02:00:00.000Z',
        orderDate: '2026-11-25T02:00:00.000Z',
        deliveryDate: '2026-12-09T02:00:00.000Z',
        notes: 'Call before delivery',
        ...overrides,
    };
}

const okResponse = (data: unknown) => ({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
});

function renderDialog(order = makeOrder()) {
    const stub = vi.fn(async () => okResponse({ message: 'Purchase order updated' }));
    vi.stubGlobal('fetch', stub);

    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
        <QueryClientProvider client={queryClient}>
            <EditPurchaseOrderDialog order={order} />
        </QueryClientProvider>,
    );

    return stub;
}

/** Opens the dialog and returns the user plus the two date inputs. */
async function openDialog() {
    const user = userEvent.setup();
    await user.click(screen.getByTitle('Edit order dates'));
    expect(await screen.findByText(/Edit Purchase Order PO-20261125-7651/)).toBeInTheDocument();

    return {
        user,
        orderDate: screen.getByLabelText('Order Date'),
        deliveryDate: screen.getByLabelText('Expected Delivery Date'),
    };
}

afterEach(() => {
    vi.unstubAllGlobals();

describe('EditPurchaseOrderDialog', () => {
    it('sends only the order date that changed and announces the update', async () => {
        const stub = renderDialog();
        const { user, orderDate } = await openDialog();

        const nextDay = new Date(2026, 11, 5, 9, 0);
        fireEvent.change(orderDate, { target: { value: toInputValue(nextDay) } });
        await user.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(stub).toHaveBeenCalledTimes(1));

        const [url, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/purchase-orders/7');
        expect(init.method).toBe('PUT');
        // The delivery date and the note were untouched, so they stay out of the request.
        expect(JSON.parse(String(init.body))).toEqual({ orderDate: nextDay.toISOString() });

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' })),
        );
    });

    it('sends a note on its own when only the note changed', async () => {
        const stub = renderDialog();
        const { user } = await openDialog();

        fireEvent.change(screen.getByLabelText('Notes'), {
            target: { value: 'Invoice arrived by email' },
        });
        await user.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(stub).toHaveBeenCalledTimes(1));

        const [, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(String(init.body))).toEqual({ notes: 'Invoice arrived by email' });
    });

    it('does not call the API when nothing was changed', async () => {
        const stub = renderDialog();
        const { user } = await openDialog();

        await user.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Nothing to save' }),
            ),
        );
        expect(stub).not.toHaveBeenCalled();
    });

    it('refuses a back-dated order date for a non-administrator without calling the API', async () => {
        permissions.isAdmin = false;
        const stub = renderDialog();
        const { user, orderDate } = await openDialog();

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        fireEvent.change(orderDate, { target: { value: toInputValue(yesterday) } });
        await user.click(screen.getByRole('button', { name: /save changes/i }));

        expect(await screen.findByText(BACK_DATED_PURCHASE_ORDER_MESSAGE)).toBeInTheDocument();
        expect(stub).not.toHaveBeenCalled();
    });

    it('tells the user that moving the order date moves the expense in Finance', async () => {
        renderDialog();
        const { orderDate } = await openDialog();

        expect(
            screen.queryByText(/expense in Finance will move to this order date/i),
        ).not.toBeInTheDocument();

        const nextDay = new Date(2026, 11, 5, 9, 0);
        fireEvent.change(orderDate, { target: { value: toInputValue(nextDay) } });

        expect(
            await screen.findByText(/expense in Finance will move to this order date/i),
        ).toBeInTheDocument();
    });
});

    mocks.toast.mockClear();
    permissions.isAdmin = true;
});
