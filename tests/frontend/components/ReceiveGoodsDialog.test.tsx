import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReceiveGoodsDialog, type ReceivableItem } from '@/components/PurchaseOrders/ReceiveGoodsDialog';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

/**
 * The dialog's quantity grid is the only place a short delivery can be expressed, so it owns
 * the client-side guard rails: it must pre-fill what is still owed, refuse more than that,
 * refuse an empty shipment, and only send the lines that actually arrived.
 *
 * Line 2 arrived in full, so it is already closed and must not be receivable again.
 */
const items: ReceivableItem[] = [
    {
        id: 1,
        product: { id: 11, name: 'Royal Canin Adult', sku: 'RC-1' },
        quantity: 10,
        unitPrice: '100000',
        deliveredQuantity: 6,
    },
    {
        id: 2,
        product: { id: 12, name: 'Cat Litter', sku: 'CL-1' },
        quantity: 5,
        unitPrice: '50000',
        deliveredQuantity: 5,
    },
];

type FetchCall = { url: string; method: string; body: any };

function setup() {
    const calls: FetchCall[] = [];

    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: any, init?: any) => {
            calls.push({
                url: String(input),
                method: (init?.method ?? 'GET').toUpperCase(),
                body: init?.body ? JSON.parse(init.body) : undefined,
            });

            const data = {
                fullyReceived: false,
                outstandingQuantity: 2,
                receipt: { id: 1, receiptNumber: 'GRN-20261108-0001' },
            };

            return {
                ok: true,
                status: 200,
                json: async () => data,
                text: async () => JSON.stringify(data),
            } as Response;
        })
    );

    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    const user = userEvent.setup();

    render(
        <QueryClientProvider client={queryClient}>
            <ReceiveGoodsDialog
                purchaseOrderId={7}
                orderNumber="PO-20261108-0001"
                expectedDeliveryDate="2026-11-10T09:00:00.000Z"
                items={items}
            />
        </QueryClientProvider>
    );

    return { calls, user };
}

/** The per-line "Receiving Now" boxes are the only inputs carrying a max limit. */
function quantityInputs(): HTMLInputElement[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"][max]'));
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTitle('Receive Goods'));
    await screen.findByText(/Receive Goods - PO-20261108-0001/);
}

/** happy-dom does not propagate a click on a submit button into a form submit event. */
function submit() {
    const button = screen.getByRole('button', { name: /Receive Goods$/ });
    const form = button.closest('form');
    if (!form) throw new Error('Receive Goods button is not inside a form');
    return fireEvent.submit(form);
}

describe('ReceiveGoodsDialog', () => {
    afterEach(() => {
        cleanup();
        toastMock.mockClear();
        vi.unstubAllGlobals();
    });

    it('pre-fills what is still outstanding and locks the lines already complete', async () => {
        const { user } = setup();
        await openDialog(user);

        const [partLine, closedLine] = quantityInputs();

        // 10 ordered, 6 already booked in -> 4 outstanding, so 4 is the default.
        expect(partLine).toHaveValue(4);
        expect(partLine).toBeEnabled();

        // 5 of 5 already received: nothing left to book in on this line.
        expect(closedLine).toHaveValue(0);
        expect(closedLine).toBeDisabled();

        expect(screen.getByText('4 of 4 outstanding unit(s) on this receipt')).toBeTruthy();
        expect(screen.getByText('Completes the order')).toBeTruthy();
    });

    it('refuses to receive more units than are outstanding', async () => {
        const { user, calls } = setup();
        await openDialog(user);

        const [partLine] = quantityInputs();
        await user.clear(partLine);
        await user.type(partLine, '5');

        await submit();

        await screen.findByText('Only 4 outstanding');
        expect(calls).toHaveLength(0);
    });

    it('refuses a receipt with no units on it', async () => {
        const { user, calls } = setup();
        await openDialog(user);

        const [partLine] = quantityInputs();
        await user.clear(partLine);
        await user.type(partLine, '0');

        await submit();

        await screen.findByText('Enter at least one received unit');
        expect(calls).toHaveLength(0);
    });

    it('posts only the lines that arrived and reports the order as still open', async () => {
        const { user, calls } = setup();
        await openDialog(user);

        const [partLine] = quantityInputs();
        await user.clear(partLine);
        await user.type(partLine, '2');

        // A fee on this shipment must be sent too - it is what makes the landed cost true.
        await user.type(screen.getByLabelText('Shipping Fee (VND)'), '40000');

        await submit();

        await waitFor(() => expect(calls).toHaveLength(1));

        expect(calls[0].url).toBe('/api/purchase-orders/7/goods-receipt');
        expect(calls[0].method).toBe('POST');
        expect(calls[0].body.shippingFee).toBe(40000);
        // Line 2 is complete, so it is not part of this receipt.
        expect(calls[0].body.items).toEqual([{ itemId: 1, quantity: 2 }]);

        await waitFor(() =>
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Partially received' })
            )
        );
    });
});
