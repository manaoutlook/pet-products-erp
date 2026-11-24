import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreatePurchaseOrderDialog } from '@/components/PurchaseOrders/CreatePurchaseOrderDialog';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

// cmdk and floating-ui measure their panels, and cmdk scrolls the active item into view.
// happy-dom has no layout engine, so both calls have to exist or the popover never renders.
if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    (globalThis as any).ResizeObserver = ResizeObserverStub;
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
}

/**
 * A purchase order line is picked from the whole catalogue, so the picker has to search it -
 * scrolling a native select through 50+ names is what made the dialog unusable. The SKU is
 * searched as well, because several variants share a name prefix.
 */
const products = [
    { id: 1, name: 'SmartLife DreamSpark Pen', sku: 'SL-DS-001', price: '12000' },
    { id: 2, name: 'SmartLife PandaPop Gel Pen', sku: 'SL-PP-002', price: '15000' },
    { id: 3, name: 'Royal Canin Adult 2kg', sku: 'RC-AD-2', price: '250000' },
];

function setup() {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: any) => {
            const url = String(input);
            const body = url.includes('/api/products')
                ? products
                : url.includes('/api/suppliers')
                    ? [{ id: 1, name: 'Langwei Technology (ningbo) Co., Ltd.' }]
                    : url.includes('/api/stores')
                        ? [{ id: 10, name: 'Mana House', type: 'WAREHOUSE' }]
                        : [];

            return {
                ok: true,
                status: 200,
                json: async () => body,
                text: async () => JSON.stringify(body),
            } as Response;
        })
    );

    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                staleTime: Infinity,
                // The app's QueryClient fetches `queryKey[0]` as a URL; the three catalogue
                // queries in this dialog rely on that default.
                queryFn: async ({ queryKey }) => {
                    const response = await fetch(queryKey[0] as string, {
                        credentials: 'include',
                    });
                    return response.json();
                },
            },
            mutations: { retry: false },
        },
    });

    render(
        <QueryClientProvider client={queryClient}>
            <CreatePurchaseOrderDialog />
        </QueryClientProvider>
    );

    return { user: userEvent.setup() };
}

/** Opens the dialog and the first line's product picker, returning the search box. */
async function openProductPicker(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /create purchase order/i }));

    const trigger = await screen.findByRole('combobox', { name: /product 1/i });
    await user.click(trigger);

    const search = await screen.findByPlaceholderText('Search by name or SKU...');
    // The catalogue arrives from /api/products, so the first render of the list is empty.
    // Wait for it before typing, otherwise every query looks like it matched nothing.
    await screen.findByText(products[0].name);

    return { trigger, search };
}

describe('CreatePurchaseOrderDialog product picker', () => {
    afterEach(() => {
        cleanup();
        toastMock.mockClear();
        vi.unstubAllGlobals();
    });

    it('filters the catalogue by product name', async () => {
        const { user } = setup();
        const { search } = await openProductPicker(user);

        await user.type(search, 'PandaPop');

        expect(await screen.findByText('SmartLife PandaPop Gel Pen')).toBeTruthy();
        expect(screen.queryByText('SmartLife DreamSpark Pen')).toBeNull();
        expect(screen.queryByText('Royal Canin Adult 2kg')).toBeNull();
    });

    it('finds a product by SKU and fills the unit price from the catalogue', async () => {
        const { user } = setup();
        const { trigger, search } = await openProductPicker(user);

        await user.type(search, 'RC-AD-2');

        // The SKU comes from the option description, so it is shown next to the name too.
        expect(await screen.findByText('Royal Canin Adult 2kg')).toBeTruthy();
        expect(screen.queryByText('SmartLife PandaPop Gel Pen')).toBeNull();

        await user.click(screen.getByText('Royal Canin Adult 2kg'));

        expect(trigger).toHaveTextContent('Royal Canin Adult 2kg');
        expect(screen.getByPlaceholderText('Unit Price (VND)')).toHaveValue(250000);
    });

    it('shows a "no products" message instead of an empty dropdown', async () => {
        const { user } = setup();
        const { search } = await openProductPicker(user);

        await user.type(search, 'zzzz-no-such-product');

        expect(await screen.findByText('No products found.')).toBeTruthy();
    });
});
