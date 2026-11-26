import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreatePurchaseOrderDialog } from '@/components/PurchaseOrders/CreatePurchaseOrderDialog';
import {
    BACK_DATED_PURCHASE_ORDER_MESSAGE as BACK_DATED_MESSAGE,
    todayInVietnam,
} from '@shared/purchase-order-dates';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

/**
 * Back-dating a purchase order is administrator-only. The tests run as an administrator unless a
 * test says otherwise - the same convention SalesOrderFormDialog's tests use for its own
 * role-dependent controls.
 */
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
// Radix's Select captures the pointer on open; jsdom/happy-dom do not implement the capture API.
if (typeof Element !== 'undefined') {
    for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
        if (!(Element.prototype as any)[method]) {
            (Element.prototype as any)[method] = () => false;
        }
    }
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

/**
 * Back-dated purchase orders.
 *
 * Orders are routinely typed in after the fact - the paper invoice reaches the office days after
 * the goods do - so a past expected delivery date has to be accepted. The register flags it as
 * overdue; it is not an input error. It is, however, an administrator's call: the expected date is
 * what the register reports as overdue and what every goods receipt is measured against, so the
 * dialog refuses it for everyone else (and `POST /api/purchase-orders` enforces the same rule).
 */
describe('CreatePurchaseOrderDialog back-dated orders', () => {
    afterEach(() => {
        cleanup();
        toastMock.mockClear();
        vi.unstubAllGlobals();
        permissions.isAdmin = true;
    });

    const dialog = () => screen.getByRole('dialog');
    const deliveryDateInput = () =>
        screen.getByLabelText(/expected delivery date/i) as HTMLInputElement;
    const submittedBody = () => {
        const call = vi
            .mocked(fetch)
            .mock.calls.find(
                ([url, init]) =>
                    String(url) === '/api/purchase-orders' &&
                    (init as RequestInit | undefined)?.method === 'POST'
            );
        return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
    };

    /**
     * Picks an entry from one of the Radix selects. The trigger also renders a hidden native
     * `<option>` carrying the same label (form compatibility), so the click is scoped to the
     * listbox rather than matched document-wide.
     */
    async function chooseOption(
        user: ReturnType<typeof userEvent.setup>,
        label: string
    ): Promise<void> {
        const listbox = await screen.findByRole('listbox');
        await user.click(await within(listbox).findByText(label));
    }

    async function fillOrder(user: ReturnType<typeof userEvent.setup>, date: string) {
        await user.click(screen.getByRole('button', { name: /create purchase order/i }));

        await user.click(screen.getByRole('combobox', { name: /supplier/i }));
        await chooseOption(user, 'Langwei Technology (ningbo) Co., Ltd.');

        await user.click(screen.getByRole('combobox', { name: /destination warehouse/i }));
        await chooseOption(user, 'Mana House');

        await user.type(screen.getByPlaceholderText('Quantity'), '3');

        // The product picker is a popover: opening it dismisses anything else that is open, so it
        // is filled last and its search box is only found after the catalogue has rendered.
        await user.click(screen.getByRole('combobox', { name: /product 1/i }));
        const search = await screen.findByPlaceholderText('Search by name or SKU...');
        await screen.findByText(products[0].name);
        await user.type(search, 'RC-AD-2');
        await user.click(await screen.findByText('Royal Canin Adult 2kg'));

        // `datetime-local` inputs are driven with a change event: typing digit by digit leaves
        // the browser's own date mask half-filled.
        fireEvent.change(deliveryDateInput(), { target: { value: date } });
    }

    /**
     * Submits the dialog.
     *
     * AI Agent Note: happy-dom does not perform implicit form submission when a `<button
     * type="submit">` is clicked (the same reason SalesOrderFormDialog fires the event), so the
     * submit event is dispatched directly.
     */
    function submitForm() {
        fireEvent.submit(dialog().querySelector('form') as HTMLFormElement);
    }

    it('submits a purchase order whose expected delivery date is in the past', async () => {
        const { user } = setup();
        await fillOrder(user, '2025-01-15T10:00');

        // An administrator is offered the whole calendar, and the hint says why.
        expect(deliveryDateInput()).not.toHaveAttribute('min');
        expect(screen.getByText(/past dates are allowed/i)).toBeTruthy();

        submitForm();

        await waitFor(() => expect(submittedBody()).toBeTruthy());
        expect(submittedBody().deliveryDate).toBe(
            new Date('2025-01-15T10:00').toISOString()
        );
        expect(screen.queryByText(/must be in the future/i)).toBeNull();
        expect(screen.queryByText('Enter a valid delivery date')).toBeNull();
    });

    it('sends how the supplier is paid, so the expense lands in the right till or bank line', async () => {
        const { user } = setup();
        await fillOrder(user, `${todayInVietnam()}T08:00`);

        // Cash is the default, because that is what every order meant before the field existed.
        await user.click(screen.getByRole('combobox', { name: /paid by/i }));
        await chooseOption(user, 'Bank transfer');

        submitForm();

        await waitFor(() => expect(submittedBody()).toBeTruthy());
        expect(submittedBody().paymentMethod).toBe('BANK_TRANSFER');
    });

    it('sends cash when the method is left at its default', async () => {
        const { user } = setup();
        await fillOrder(user, `${todayInVietnam()}T08:00`);

        submitForm();

        await waitFor(() => expect(submittedBody()).toBeTruthy());
        expect(submittedBody().paymentMethod).toBe('CASH');
    });

    it('refuses a back-dated order from a user who is not an administrator', async () => {
        permissions.isAdmin = false;

        const { user } = setup();
        await fillOrder(user, '2025-01-15T10:00');

        // The picker is limited to today onwards rather than merely rejecting the save.
        expect(deliveryDateInput()).toHaveAttribute('min', `${todayInVietnam()}T00:00`);
        expect(screen.getByText(/only an administrator can back-date/i)).toBeTruthy();

        submitForm();

        expect(await screen.findByText(BACK_DATED_MESSAGE)).toBeTruthy();
        expect(submittedBody()).toBeNull();
    });

    it('lets a user who is not an administrator order for today', async () => {
        permissions.isAdmin = false;

        const { user } = setup();
        await fillOrder(user, `${todayInVietnam()}T08:00`);

        submitForm();

        await waitFor(() => expect(submittedBody()).toBeTruthy());
        expect(screen.queryByText(BACK_DATED_MESSAGE)).toBeNull();
    });

    it('still requires a delivery date', async () => {
        const { user } = setup();
        await user.click(screen.getByRole('button', { name: /create purchase order/i }));

        fireEvent.change(deliveryDateInput(), { target: { value: '' } });
        submitForm();

        expect(await screen.findByText('Delivery date is required')).toBeTruthy();
        expect(submittedBody()).toBeNull();
    });
});
