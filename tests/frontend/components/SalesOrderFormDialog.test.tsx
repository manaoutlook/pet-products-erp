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
    { id: 1, name: 'Dog Food', sku: 'SKU-1', price: '100000' },
    { id: 2, name: 'Cat Toy', sku: 'SKU-2', price: 50000 },
];

const customers = [
    {
        id: 9,
        companyName: 'Pet Shop A',
        contactPerson: 'Ms Lan',
        mobileNumber: '0900000000',
        address: '99 Le Loi',
        taxId: '0319999999',
    },
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

/** Opens a searchable select and clicks one of its options. */
async function pick(user: ReturnType<typeof userEvent.setup>, comboboxIndex: number, optionLabel: string) {
    const combos = screen.getAllByRole('combobox');
    await user.click(combos[comboboxIndex]);
    const option = await screen.findByText(optionLabel);
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
        vi.stubGlobal('fetch', fetchMock);

        fetchMock.mockImplementation(async (url: string) => {
            const path = String(url).split('?')[0];
            if (path === '/api/products') return json(products);
            if (path === '/api/customer-profiles') return json(customers);
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

        await pick(user, 0, 'Pet Shop A — Ms Lan');

        expect(screen.getByLabelText(/customer name/i)).toHaveValue('Pet Shop A');
        expect(screen.getByLabelText(/^company name$/i)).toHaveValue('Pet Shop A');
        expect(screen.getByLabelText(/contact person/i)).toHaveValue('Ms Lan');
        expect(screen.getByLabelText(/^phone$/i)).toHaveValue('0900000000');
    });

    it('saves a retail order with a null VAT company and the trimmed customer block', async () => {
        const user = userEvent.setup();
        const { onOpenChange } = renderDialog();
        await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));

        await user.type(screen.getByLabelText(/customer name/i), '  Walk-in Buyer  ');
        await user.type(screen.getByLabelText(/delivery address/i), '12 Le Loi');

        await pick(user, 1, 'Dog Food');
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
        await pick(user, 1, 'Dog Food');
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

        await user.type(screen.getByLabelText(/customer name/i), 'Pet Shop A');
        await pick(user, 1, 'Dog Food');
        await user.type(screen.getByPlaceholderText('Qty'), '1');
        await user.click(screen.getByRole('button', { name: /with vat/i }));

        // A company without a tax code cannot issue a VAT invoice; the button says why.
        const unusable = screen.getByRole('button', { name: /household business/i });
        expect(unusable).toBeDisabled();
        expect(within(unusable).getByText(/Incomplete: Tax code, Address/)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /conqueror international/i }));
        await user.type(screen.getByLabelText(/buyer tax code/i), '0319999999');
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
            if (path === '/api/vat-companies') return json({ companies: [] });
            if (path === '/api/sales-orders' && init?.method === 'POST')
                return json({ message: 'Delivery notes exist' }, false, 409);
            return json({});
        }));

        const user = userEvent.setup();
        renderDialog();
        await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));

        await user.type(screen.getByLabelText(/customer name/i), 'Pet Shop A');
        await pick(user, 1, 'Dog Food');
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
