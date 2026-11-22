import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SalesOrderFormDialog } from '@/components/SalesOrders/SalesOrderFormDialog';

/**
 * The sales-order form.
 *
 * Three things on this screen have bitten before and are pinned here: the totals preview must
 * match the invoice (VAT is added on top at the selected company's rate, never recomputed on
 * save), "No VAT" must send a null company rather than an empty string, and an order that can no
 * longer be edited must say why instead of failing on submit.
 */

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: mocks.toast, toasts: [], dismiss: vi.fn() }),
}));

const vatCompanies = vi.hoisted(() => ({ activeCompanies: [] as unknown[], isLoading: false }));

vi.mock('@/hooks/use-vat-companies', () => ({
    useVatCompanies: () => ({ ...vatCompanies, companies: vatCompanies.activeCompanies, hasUsableCompany: true }),
}));

const products = [
    {
        id: 1,
        name: 'Dog Food',
        sku: 'SKU-1',
        price: '100000',
        landingPrice: '70000',
        b2bPrice: '100000',
        b2cPrice: '120000',
    },
    {
        id: 2,
        name: 'Cat Toy',
        sku: 'SKU-2',
        price: 50000,
        landingPrice: 35000,
        b2bPrice: 50000,
        b2cPrice: 60000,
    },
];

/** A catalogue row whose price columns were never filled in on the product master. */
const unpricedProducts = [
    {
        id: 3,
        name: 'Unpriced Feed',
        sku: 'SKU-3',
        price: '100000',
        landingPrice: null,
        b2bPrice: null,
        b2cPrice: null,
    },
];

const customers = [
    {
        id: 9,
        companyName: 'Pet Shop A',
        contactPerson: 'Ms Lan',
        mobileNumber: '0900000000',
        email: 'lan@petshopa.example',
        address: '99 Le Loi',
        taxId: '0319999999',
        customerType: 'B2B',
    },
];

/** Locations the order can ship from. The Distribution Centre is the null/default option. */
const stores = [
    { id: 4, name: 'Test Store 1', type: 'STORE' },
    { id: 5, name: 'Test Store 2', type: 'STORE' },
];

const json = (data: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
});

function renderDialog(props: Partial<React.ComponentProps<typeof SalesOrderFormDialog>> = {}) {
    const onOpenChange = vi.fn();
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                staleTime: Infinity,
                // The app's QueryClient fetches `queryKey[0]` as a URL; the two catalogue queries
                // in the dialog rely on that default.
                queryFn: async ({ queryKey }) => {
                    const response = await fetch(queryKey[0] as string, { credentials: 'include' });
                    return response.json();
                },
            },
            mutations: { retry: false },
        },
    });

    const utils = render(
        <QueryClientProvider client={queryClient}>
            <SalesOrderFormDialog open onOpenChange={onOpenChange} {...props} />
        </QueryClientProvider>,
    );

    return { ...utils, onOpenChange };
}

/**
 * Opens a labelled dropdown and clicks one of its options.
 *
 * The controls are addressed by their accessible name rather than their position: the form
 * gained a "Deliver From" select, and index-based picking silently started opening the wrong
 * dropdown (the product picker became index 2).
 */
async function pick(
    user: ReturnType<typeof userEvent.setup>,
    name: RegExp,
    optionLabel: string,
) {
    await user.click(screen.getByRole('combobox', { name }));

    // Radix Select keeps a hidden native <select> beside the list, so the same label appears
    // twice. Click the visible option, never the hidden mirror.
    const matches = await screen.findAllByText(optionLabel);
    const option =
        matches.find(
            (element) =>
                element.closest('[role="option"]') && !element.closest('[aria-hidden="true"]'),
        ) ?? matches[0];

    await user.click(option);
}

/**
 * Submit the dialog.
 *
 * AI Agent Note: happy-dom does not perform implicit form submission when a `<button
 * type="submit">` is clicked, so the submit event is fired directly. Clicking first is pointless
 * here - the tests assert the button's `disabled` state separately where it matters.
 */
function submitForm() {
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
}

describe('SalesOrderFormDialog', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        mocks.toast.mockClear();
        vatCompanies.activeCompanies = [];
        vatCompanies.isLoading = false;
        // happy-dom has no pointer capture; Radix Select calls it when its trigger is clicked.
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;
        vi.stubGlobal('fetch', fetchMock);

        fetchMock.mockImplementation(async (url: string) => {
            const path = String(url).split('?')[0];
            if (path === '/api/products') return json(products);
            if (path === '/api/customer-profiles') return json(customers);
            if (path === '/api/stores') return json(stores);
            if (path === '/api/vat-companies') return json({ companies: [] });
            if (path === '/api/sales-orders') return json({ orderNumber: 'SO-20261119-0001' });
            return json({});
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('requires a customer and a product before it can be saved', async () => {
        renderDialog();
        await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));

        submitForm();

        expect(await screen.findByText('Customer name is required')).toBeInTheDocument();
        expect(screen.getByText('Pick a product for every line')).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalledWith(
            '/api/sales-orders',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('refuses a save with no order date', async () => {
        const user = userEvent.setup();
        renderDialog();
        await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));

        const date = screen.getByLabelText(/order date/i);
        await user.clear(date);
        await user.type(screen.getByLabelText(/customer name/i), 'Walk-in');
        submitForm();

        expect(await screen.findByText('Order date is required')).toBeInTheDocument();
    });

    it('prefills the customer block from a saved profile', async () => {
        const user = userEvent.setup();
        renderDialog();
        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith('/api/customer-profiles', expect.anything()),
        );

        await pick(user, /customer profile/i, 'Pet Shop A — Ms Lan');
        // The buyer tax box is part of the VAT invoice block.
        await user.click(screen.getByRole('button', { name: /with vat/i }));

        expect(screen.getByLabelText(/customer name/i)).toHaveValue('Pet Shop A');
        expect(screen.getByLabelText(/^company name$/i)).toHaveValue('Pet Shop A');
        expect(screen.getByLabelText(/contact person/i)).toHaveValue('Ms Lan');
        expect(screen.getByLabelText(/^phone$/i)).toHaveValue('0900000000');
        // The tax code is customer master data, so picking a profile fills it in - read-only.
        const taxInput = screen.getByLabelText(/buyer tax code/i);
        expect(taxInput).toHaveValue('0319999999');
        expect(taxInput).toHaveAttribute('readonly');
    });

    it('saves the Customer Master tax code without ever updating the master record', async () => {
        vatCompanies.activeCompanies = [
            {
                id: 3,
                code: 'CI',
                name: 'Conqueror International',
                taxId: '0312362838',
                address: '12 Nguyen Hue',
                phone: null,
                email: null,
                bankAccount: null,
                vatRate: 0.1,
                isActive: true,
                missingFields: [],
            },
        ];

        const stubFetch = vi.fn(async (url: string, init?: RequestInit) => {
            const path = String(url).split('?')[0];
            if (path === '/api/products') return json(products);
            if (path === '/api/customer-profiles') return json(customers);
            if (path === '/api/stores') return json(stores);
            if (path === '/api/vat-companies') return json({ companies: [] });
            if (path === '/api/customer-profiles/9' && init?.method === 'PUT') {
                return json({
                    customerProfile: { ...customers[0], taxId: '0318888888' },
                });
            }
            if (path === '/api/sales-orders' && init?.method === 'POST') {
                return json({ orderNumber: 'SO-20261119-0002' });
            }
            return json({});
        });
        vi.stubGlobal('fetch', stubFetch);

        const user = userEvent.setup();
        renderDialog();
        await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));

        await pick(user, /customer profile/i, 'Pet Shop A — Ms Lan');
        await pick(user, /product 1/i, 'Dog Food');
        await user.type(screen.getByPlaceholderText('Qty'), '1');
        await user.click(screen.getByRole('button', { name: /with vat/i }));
        await user.click(screen.getByRole('button', { name: /conqueror international/i }));

        // The code is displayed from the profile and cannot be typed over on this screen.
        const taxInput = screen.getByLabelText(/buyer tax code/i);
        expect(taxInput).toHaveValue('0319999999');
        expect(taxInput).toHaveAttribute('readonly');

        await user.click(screen.getByRole('button', { name: /create sales order/i }));
        submitForm();

        await waitFor(() =>
            expect(stubFetch).toHaveBeenCalledWith(
                '/api/sales-orders',
                expect.objectContaining({ method: 'POST' }),
            ),
        );
        const [, postInit] = stubFetch.mock.calls.find(
            ([url, init]) =>
                String(url) === '/api/sales-orders' && (init as RequestInit)?.method === 'POST',
        )!;
        expect(JSON.parse(String((postInit as RequestInit).body)).customerTaxId).toBe('0319999999');

        // Customer Master is never written from sales-order processing.
        expect(stubFetch).not.toHaveBeenCalledWith(
            '/api/customer-profiles/9',
            expect.objectContaining({ method: 'PUT' }),
        );
    });

    it('shows the current Customer Master tax code when editing an order with an older snapshot', async () => {
        renderDialog({
            order: {
                id: 7,
                orderNumber: 'SO-20261115-0001',
                customerProfileId: 9,
                customerName: 'Pet Shop A',
                customerTaxId: '0311111111',
                vatCompanyId: 3,
                items: [{ productId: 1, quantity: 1, unitPrice: '100000' }],
            },
        });

        // The customer list loads after the dialog opens; once it does, the master value wins
        // over the snapshot the old order was saved with.
        await waitFor(() =>
            expect(screen.getByLabelText(/buyer tax code/i)).toHaveValue('0319999999'),
        );
    });

    it('saves a retail order with a null VAT company and the trimmed customer block', async () => {
        const user = userEvent.setup();
        const { onOpenChange } = renderDialog();
        await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));

        await user.type(screen.getByLabelText(/customer name/i), '  Walk-in Buyer  ');
        await user.type(screen.getByLabelText(/delivery address/i), '12 Le Loi');

        await pick(user, /product 1/i, 'Dog Food');
        await user.type(screen.getByPlaceholderText('Qty'), '3');

        // The line amount and the order total both show the same figure.
        await waitFor(() =>
            expect(screen.getAllByText(/^300\.000/).length).toBeGreaterThan(1),
        );

        await user.click(screen.getByRole('button', { name: /create sales order/i }));
        submitForm();

        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/sales-orders',
                expect.objectContaining({ method: 'POST' }),
            ),
        );

        const [, init] = fetchMock.mock.calls.find(([url, options]) => String(url) === '/api/sales-orders' && (options as RequestInit)?.method === 'POST')!;
        const body = JSON.parse(String((init as RequestInit).body));

        expect(body.customerName).toBe('Walk-in Buyer');
        expect(body.deliveryAddress).toBe('12 Le Loi');
        // Nothing picked = NULL = the Distribution Centre (`inventory.store_id IS NULL`).
        expect(body.storeId).toBeNull();
        // "No VAT" is null, never an empty string: the server snapshots the company block.
        expect(body.vatCompanyId).toBeNull();
        expect(body.companyName).toBeNull();
        // Noon local time, so the stored timestamp cannot land on the previous day.
        expect(body.orderDate).toContain('T05:00:00.000Z');
        expect(body.items).toEqual([{ productId: 1, quantity: 3, unitPrice: 100000 }]);

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Sales order created',
                    description: 'SO-20261119-0001 saved',
                }),
            ),
        );
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('ships from the chosen store and sends its id', async () => {
        const user = userEvent.setup();
        renderDialog();

        await user.type(screen.getByLabelText(/customer name/i), 'Pet Shop A');
        await pick(user, /deliver from/i, 'Test Store 1');
        await pick(user, /product 1/i, 'Dog Food');
        await user.type(screen.getByPlaceholderText('Qty'), '2');

        await user.click(screen.getByRole('button', { name: /create sales order/i }));
        submitForm();

        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/sales-orders',
                expect.objectContaining({ method: 'POST' }),
            ),
        );

        const [, init] = fetchMock.mock.calls.find(
            ([url, options]) =>
                String(url) === '/api/sales-orders' && (options as RequestInit)?.method === 'POST',
        )!;
        expect(JSON.parse(String((init as RequestInit).body)).storeId).toBe(4);
    });

    it('keeps the location when an order is edited', async () => {
        const user = userEvent.setup();
        renderDialog({
            order: {
                id: 7,
                orderNumber: 'SO-20261115-0001',
                customerName: 'Pet Shop A',
                storeId: 5,
                items: [{ productId: 1, quantity: 2, unitPrice: '100000' }],
            },
        });

        expect(await screen.findByText('Edit Sales Order SO-20261115-0001')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /save changes/i }));
        submitForm();

        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/sales-orders/7',
                expect.objectContaining({ method: 'PUT' }),
            ),
        );

        const [, init] = fetchMock.mock.calls.find(
            ([url, options]) =>
                String(url) === '/api/sales-orders/7' && (options as RequestInit)?.method === 'PUT',
        )!;
        expect(JSON.parse(String((init as RequestInit).body)).storeId).toBe(5);
    });

    it('adds and removes lines, keeping at least one', async () => {
        const user = userEvent.setup();
        renderDialog();
        await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));

        // The only line cannot be removed.
        expect(screen.getByTitle('Remove line')).toBeDisabled();

        await user.click(screen.getByRole('button', { name: /add/i }));
        expect(screen.getAllByTitle('Remove line')).toHaveLength(2);
        expect(screen.getAllByPlaceholderText('Qty')).toHaveLength(2);

        await user.click(screen.getAllByTitle('Remove line')[1]);
        expect(screen.getAllByTitle('Remove line')).toHaveLength(1);
    });

    it('requires the issuing company once VAT is switched on', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            const path = String(url).split('?')[0];
            if (path === '/api/products') return json(products);
            if (path === '/api/customer-profiles') return json(customers);
            if (path === '/api/stores') return json(stores);
            return json({ companies: [] });
        }));
        vatCompanies.activeCompanies = [
            {
                id: 3,
                code: 'CI',
                name: 'Conqueror International',
                taxId: '0312362838',
                address: '12 Nguyen Hue',
                phone: null,
                email: null,
                bankAccount: null,
                vatRate: 0.08,
                isActive: true,
                missingFields: [],
            },
        ];

        const user = userEvent.setup();
        renderDialog();
        await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));

        await user.type(screen.getByLabelText(/customer name/i), 'Pet Shop A');
        await pick(user, /product 1/i, 'Dog Food');
        await user.type(screen.getByPlaceholderText('Qty'), '3');
        await user.click(screen.getByRole('button', { name: /with vat/i }));

        submitForm();
        expect(
            await screen.findByText('Select the company that issues the VAT documents'),
        ).toBeInTheDocument();

        // Choosing the company switches the preview to the VAT company's own rate.
        await user.click(screen.getByRole('button', { name: /conqueror international/i }));
        expect(await screen.findByText('VAT (8%)')).toBeInTheDocument();
        expect(screen.getAllByText(/^24\.000/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/^324\.000/).length).toBeGreaterThan(0);
    });

    it('sends the chosen VAT company and refuses a company that cannot issue yet', async () => {
        const stubFetch = vi.fn(async (url: string, init?: RequestInit) => {
            const path = String(url).split('?')[0];
            if (path === '/api/products') return json(products);
            if (path === '/api/customer-profiles') return json(customers);
            if (path === '/api/stores') return json(stores);
            if (path === '/api/vat-companies') return json({ companies: [] });
            if (path === '/api/sales-orders' && init?.method === 'POST') return json({ orderNumber: 'SO-9' });
            return json({});
        });
        vi.stubGlobal('fetch', stubFetch);
        vatCompanies.activeCompanies = [
            {
                id: 3,
                code: 'CI',
                name: 'Conqueror International',
                taxId: '0312362838',
                address: '12 Nguyen Hue',
                phone: null,
                email: null,
                bankAccount: null,
                vatRate: 0.1,
                isActive: true,
                missingFields: [],
            },
            {
                id: 4,
                code: 'HI',
                name: 'Household Business',
                taxId: '',
                address: '',
                phone: null,
                email: null,
                bankAccount: null,
                vatRate: 0.1,
                isActive: true,
                missingFields: ['Tax code', 'Address'],
            },
        ];

        const user = userEvent.setup();
        renderDialog();
        await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));

        await pick(user, /customer profile/i, 'Pet Shop A — Ms Lan');
        await pick(user, /product 1/i, 'Dog Food');
        await user.type(screen.getByPlaceholderText('Qty'), '1');
        await user.click(screen.getByRole('button', { name: /with vat/i }));

        // A company without a tax code cannot issue a VAT invoice; the button says why.
        const unusable = screen.getByRole('button', { name: /household business/i });
        expect(unusable).toBeDisabled();
        expect(within(unusable).getByText(/Incomplete: Tax code, Address/)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /conqueror international/i }));
        // The buyer tax code is copied from the selected customer profile, not typed here.
        expect(screen.getByLabelText(/buyer tax code/i)).toHaveValue('0319999999');
        submitForm();

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Sales order created' }),
            ),
        );

        const [, requestInit] = stubFetch.mock.calls.find(
            ([url, init]) => String(url) === '/api/sales-orders' && (init as RequestInit)?.method === 'POST',
        )!;
        const body = JSON.parse(String((requestInit as RequestInit).body));
        expect(body.vatCompanyId).toBe(3);
        expect(body.customerTaxId).toBe('0319999999');
    });

    it('reports a save the server refused', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            const path = String(url).split('?')[0];
            if (path === '/api/products') return json(products);
            if (path === '/api/customer-profiles') return json(customers);
            if (path === '/api/stores') return json(stores);
            if (path === '/api/vat-companies') return json({ companies: [] });
            if (path === '/api/sales-orders' && init?.method === 'POST')
                return json({ message: 'Delivery notes exist' }, false, 409);
            return json({});
        }));

        const user = userEvent.setup();
        renderDialog();
        await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));

        await user.type(screen.getByLabelText(/customer name/i), 'Pet Shop A');
        await pick(user, /product 1/i, 'Dog Food');
        await user.type(screen.getByPlaceholderText('Qty'), '1');
        submitForm();

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Error', description: 'Delivery notes exist' }),
            ),
        );
    });

    it('edits an existing order and saves it back to the same order', async () => {
        const stubFetch = vi.fn(async (url: string, init?: RequestInit) => {
            const path = String(url).split('?')[0];
            if (path === '/api/products') return json(products);
            if (path === '/api/customer-profiles') return json(customers);
            if (path === '/api/stores') return json(stores);
            if (init?.method === 'PUT') return json({ orderNumber: 'SO-20261115-0001' });
            return json({});
        });
        vi.stubGlobal('fetch', stubFetch);

        const user = userEvent.setup();
        renderDialog({
            order: {
                id: 7,
                orderNumber: 'SO-20261115-0001',
                customerName: 'Pet Shop A',
                orderDate: '2026-11-15T05:00:00.000Z',
                items: [{ productId: 1, quantity: 2, unitPrice: '100000' }],
            },
        });

        expect(await screen.findByText('Edit Sales Order SO-20261115-0001')).toBeInTheDocument();
        expect(screen.getByLabelText(/customer name/i)).toHaveValue('Pet Shop A');
        expect(screen.getByPlaceholderText('Qty')).toHaveValue(2);

        await user.click(screen.getByRole('button', { name: /save changes/i }));
        submitForm();

        await waitFor(() =>
            expect(stubFetch).toHaveBeenCalledWith(
                '/api/sales-orders/7',
                expect.objectContaining({ method: 'PUT' }),
            ),
        );
        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Sales order updated' }),
            ),
        );
    });

    it('refuses a product with no Landing / B2B / B2C price and says what to fill in', async () => {
        fetchMock.mockImplementation(async (url: string) => {
            const path = String(url).split('?')[0];
            if (path === '/api/products') return json(unpricedProducts);
            if (path === '/api/customer-profiles') return json(customers);
            if (path === '/api/stores') return json(stores);
            if (path === '/api/vat-companies') return json({ companies: [] });
            return json({});
        });

        const user = userEvent.setup();
        renderDialog();
        await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));

        await user.type(screen.getByLabelText(/customer name/i), 'Pet Shop A');
        await pick(user, /product 1/i, 'Unpriced Feed');
        await user.type(screen.getByPlaceholderText('Qty'), '2');

        // The panel appears as soon as the product is picked, before anything is submitted.
        expect(
            await screen.findByText('Prices are missing in the Product module'),
        ).toBeInTheDocument();
        expect(screen.getByText(/missing Landing Price, B2B Price, B2C Price/)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /create sales order/i }));
        submitForm();

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Prices are missing in the Product module',
                    variant: 'destructive',
                }),
            ),
        );
        expect(mocks.toast.mock.calls[0][0].description).toContain(
            'SKU-3 (Unpriced Feed): Landing Price, B2B Price, B2C Price',
        );
        // Nothing reached the API: the order was never created.
        expect(fetchMock).not.toHaveBeenCalledWith(
            '/api/sales-orders',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('keeps an existing order editable even when its product has no prices', async () => {
        fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
            const path = String(url).split('?')[0];
            if (path === '/api/products') return json(unpricedProducts);
            if (path === '/api/customer-profiles') return json(customers);
            if (path === '/api/stores') return json(stores);
            if (init?.method === 'PUT') return json({ orderNumber: 'SO-20261115-0001' });
            return json({});
        });

        const user = userEvent.setup();
        renderDialog({
            order: {
                id: 7,
                orderNumber: 'SO-20261115-0001',
                customerName: 'Pet Shop A',
                orderDate: '2026-11-15T05:00:00.000Z',
                items: [{ productId: 3, quantity: 2, unitPrice: '100000' }],
            },
        });

        expect(await screen.findByText('Edit Sales Order SO-20261115-0001')).toBeInTheDocument();
        // The warning is a new-order rule: an old order must not be locked by it.
        expect(
            screen.queryByText('Prices are missing in the Product module'),
        ).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /save changes/i }));
        submitForm();

        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/sales-orders/7',
                expect.objectContaining({ method: 'PUT' }),
            ),
        );
    });

    it('locks the form once the order can no longer change, and says why', async () => {
        renderDialog({
            order: {
                id: 7,
                orderNumber: 'SO-20261115-0001',
                customerName: 'Pet Shop A',
                items: [{ productId: 1, quantity: 2, unitPrice: '100000' }],
            },
            disabledReason: 'Four units have already shipped, so the lines cannot change.',
        });

        expect(
            await screen.findByText('Four units have already shipped, so the lines cannot change.'),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    });
});
