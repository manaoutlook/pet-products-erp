import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductsPage from '@/pages/ProductsPage';

// Permissions are not under test here - always allow everything
vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => ({
        hasPermission: () => true,
        getModulePermissions: () => null,
        getAllowedModules: () => [],
        isAdmin: false,
    }),
}));

// Avoid rendering the real toast provider, but keep a handle on the calls so
// the success/error messaging can be asserted.
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

const now = new Date('2024-01-01T00:00:00.000Z').toISOString();

const category = { id: 3, name: 'Smart Gadgets', description: null };

// Brand is optional in the DB, so the API may return `brandId: null` (and no
// related `brand` object) for products that were created without one.
const products = [
    {
        id: 1,
        name: 'Auto Disconnectors',
        description: null,
        sku: 'MP-AD-26A001',
        price: '592000.00',
        landingPrice: null,
        b2bPrice: null,
        b2cPrice: null,
        categoryId: category.id,
        category,
        brandId: null,
        supplierId: null,
        supplier: null,
        minStock: 10,
        inventory: [{ quantity: 25 }],
        createdAt: now,
        updatedAt: now,
    },
    {
        id: 2,
        name: 'USB-C Fast Charger',
        description: '65W GaN charger',
        sku: 'MP-UC-0002',
        price: '350000.00',
        landingPrice: '300000.00',
        b2bPrice: '320000.00',
        b2cPrice: '350000.00',
        categoryId: category.id,
        category,
        brandId: 7,
        brand: { id: 7, name: 'Anker' },
        supplierId: 11,
        supplier: { id: 11, name: 'Saigon Traders', contactInfo: '0901234567' },
        minStock: 5,
        inventory: [{ quantity: 2 }],
        createdAt: now,
        updatedAt: now,
    },
];

const brands = [{ id: 7, name: 'Anker' }];

const suppliers = [
    { id: 11, name: 'Saigon Traders', contactInfo: '0901234567', address: 'Ho Chi Minh City' },
    { id: 12, name: 'Hanoi Imports', contactInfo: '0907654321', address: 'Hanoi' },
];

type FetchCall = { url: string; method: string; body: any };

function createFetchMock(calls: FetchCall[]) {
    return vi.fn(async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        const method = (init?.method ?? 'GET').toUpperCase();

        let body: any = undefined;
        if (typeof init?.body === 'string') {
            body = JSON.parse(init.body);
        }
        calls.push({ url, method, body });

        let data: unknown = {};
        if (url.includes('/api/products')) {
            data = method === 'GET' ? products : { ...products[0], ...(body ?? {}) };
        } else if (url.includes('/api/brands')) {
            data = brands;
        } else if (url.includes('/api/suppliers')) {
            data = suppliers;
        } else if (url.includes('/api/categories')) {

            data = [category];
        }

        return {
            ok: true,
            status: 200,
            json: async () => data,
            text: async () => JSON.stringify(data),
        } as Response;
    });
}

function renderPage() {
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
            <ProductsPage />
        </QueryClientProvider>
    );
}

async function openEditDialogFor(productName: string) {
    const user = userEvent.setup();
    const row = screen.getByText(productName).closest('tr') as HTMLTableRowElement;
    // Row actions: view (eye), edit (pencil), delete (trash)
    const editButton = within(row)
        .getAllByRole('button')
        .find((button) => button.querySelector('svg.lucide-pencil'));
    if (!editButton) throw new Error('Edit button not found in row');

    await user.click(editButton);
    const dialog = await screen.findByRole('dialog');

    // happy-dom's native constraint validation wrongly rejects large values for a
    // `step="0.01"` number input, which blocks implicit form submission on click.
    // Real browsers accept them, so relax the step here to exercise the submit path.
    within(dialog)
        .getAllByRole('spinbutton')
        .forEach((input) => input.setAttribute('step', 'any'));

    return { user, dialog };
}

// Supplier is mandatory, so editing a product that has no supplier requires
// picking one before the form can be submitted.
async function selectSupplier(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    supplierName: string
) {
    await user.click(within(dialog).getByRole('combobox', { name: /supplier/i }));
    await user.click(await screen.findByText(supplierName));
}

describe('ProductsPage - optional brand', () => {
    let calls: FetchCall[];

    beforeEach(() => {
        // Radix UI primitives rely on these DOM APIs which happy-dom does not fully implement
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        calls = [];
        vi.stubGlobal('fetch', createFetchMock(calls));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('opens the edit dialog for a product that has no brand', async () => {
        renderPage();
        await screen.findByText('Auto Disconnectors');

        const { dialog } = await openEditDialogFor('Auto Disconnectors');

        expect(within(dialog).getByText('Edit Product')).toBeInTheDocument();
        expect(within(dialog).getByDisplayValue('Auto Disconnectors')).toBeInTheDocument();

        // `brandId: null` and `description: null` must be accepted by the form schema
        expect(screen.queryByText(/expected number, received null/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/expected string, received null/i)).not.toBeInTheDocument();

        // The brand select falls back to the explicit "No brand" option
        // (the trigger text plus the hidden native <option> Radix renders)
        expect(within(dialog).getAllByText('No brand').length).toBeGreaterThan(0);
        expect(within(dialog).queryByText('Select a brand')).not.toBeInTheDocument();
    });

    it('saves a brand-less product as brandId: null', async () => {
        renderPage();
        await screen.findByText('Auto Disconnectors');

        const { user, dialog } = await openEditDialogFor('Auto Disconnectors');

        // The supplier is mandatory, so pick one before saving.
        await selectSupplier(user, dialog, 'Saigon Traders');

        // B2C price is mandatory, so it must be provided before saving.
        await user.type(within(dialog).getByRole('spinbutton', { name: 'B2C Price' }), '592000');

        await user.click(within(dialog).getByRole('button', { name: /update product/i }));

        await waitFor(() => {
            expect(calls.some((call) => call.method === 'PUT')).toBe(true);
        });

        const put = calls.find((call) => call.method === 'PUT')!;
        expect(put.url).toBe('/api/products/1');
        expect(put.body.brandId).toBeNull();
        expect(put.body.name).toBe('Auto Disconnectors');
        expect(put.body.categoryId).toBe(category.id);
    });

    it('allows clearing the brand of a product that has one', async () => {
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const { user, dialog } = await openEditDialogFor('USB-C Fast Charger');

        const brandSelect = within(dialog).getAllByRole('combobox')[1];
        await user.click(brandSelect);
        await user.click(await screen.findByRole('option', { name: 'No brand' }));

        await user.click(within(dialog).getByRole('button', { name: /update product/i }));

        await waitFor(() => {
            expect(calls.some((call) => call.method === 'PUT')).toBe(true);
        });

        const put = calls.find((call) => call.method === 'PUT')!;
        expect(put.url).toBe('/api/products/2');
        expect(put.body.brandId).toBeNull();
    });
});

describe('ProductsPage - price tiers', () => {
    let calls: FetchCall[];

    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        calls = [];
        vi.stubGlobal('fetch', createFetchMock(calls));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('shows Landing/B2B/B2C price fields in the edit dialog', async () => {
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const { dialog } = await openEditDialogFor('USB-C Fast Charger');

        expect(within(dialog).getByRole('spinbutton', { name: 'Landing Price' })).toBeInTheDocument();
        expect(within(dialog).getByRole('spinbutton', { name: 'B2B Price' })).toBeInTheDocument();
        expect(within(dialog).getByRole('spinbutton', { name: 'B2C Price' })).toBeInTheDocument();
        // The legacy single "Price" field was removed from the form.
        expect(within(dialog).queryByRole('spinbutton', { name: 'Price' })).not.toBeInTheDocument();
    });

    it('pre-fills the price tiers of an existing product', async () => {
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const { dialog } = await openEditDialogFor('USB-C Fast Charger');

        expect(within(dialog).getByRole('spinbutton', { name: 'Landing Price' })).toHaveValue(300000);
        expect(within(dialog).getByRole('spinbutton', { name: 'B2B Price' })).toHaveValue(320000);
        expect(within(dialog).getByRole('spinbutton', { name: 'B2C Price' })).toHaveValue(350000);
    });

    it('sends the price tiers when saving an edit', async () => {
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const { user, dialog } = await openEditDialogFor('USB-C Fast Charger');

        const b2bInput = within(dialog).getByRole('spinbutton', { name: 'B2B Price' });
        await user.clear(b2bInput);
        await user.type(b2bInput, '310000');

        await user.click(within(dialog).getByRole('button', { name: /update product/i }));

        await waitFor(() => {
            expect(calls.some((call) => call.method === 'PUT')).toBe(true);
        });

        const put = calls.find((call) => call.method === 'PUT')!;
        expect(put.body.landingPrice).toBe(300000);
        expect(put.body.b2bPrice).toBe(310000);
        expect(put.body.b2cPrice).toBe(350000);
    });

    it('sends null for price tiers that are left empty', async () => {
        renderPage();
        await screen.findByText('Auto Disconnectors');

        const { user, dialog } = await openEditDialogFor('Auto Disconnectors');

        // The supplier is mandatory for new/edit saves, so pick one.
        await selectSupplier(user, dialog, 'Saigon Traders');

        // B2C is mandatory, so it has to be filled in before saving.
        const b2cInput = within(dialog).getByRole('spinbutton', { name: 'B2C Price' });
        await user.type(b2cInput, '592000');

        await user.click(within(dialog).getByRole('button', { name: /update product/i }));

        await waitFor(() => {
            expect(calls.some((call) => call.method === 'PUT')).toBe(true);
        });

        const put = calls.find((call) => call.method === 'PUT')!;
        expect(put.body.landingPrice).toBeNull();
        expect(put.body.b2bPrice).toBeNull();
        expect(put.body.b2cPrice).toBe(592000);
    });

    it('blocks saving when the B2C price is missing', async () => {
        renderPage();
        await screen.findByText('Auto Disconnectors');

        const { user, dialog } = await openEditDialogFor('Auto Disconnectors');

        // B2C price is null for this product, so submitting must fail.
        const b2cInput = within(dialog).getByRole('spinbutton', { name: 'B2C Price' });
        expect(b2cInput).toHaveValue(null);

        await user.click(within(dialog).getByRole('button', { name: /update product/i }));

        expect(await within(dialog).findByText('B2C price is required')).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'PUT')).toBe(false);
    });
});

describe('ProductsPage - supplier', () => {
    let calls: FetchCall[];

    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        calls = [];
        vi.stubGlobal('fetch', createFetchMock(calls));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('lists every supplier in a searchable dropdown', async () => {
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const { user, dialog } = await openEditDialogFor('USB-C Fast Charger');

        // The supplier of this product is pre-selected in the trigger
        const supplierSelect = within(dialog).getByRole('combobox', { name: /supplier/i });
        expect(supplierSelect).toHaveTextContent('Saigon Traders');

        await user.click(supplierSelect);

        const searchBox = await screen.findByPlaceholderText('Search suppliers...');
        const listbox = await screen.findByRole('listbox');
        // Both suppliers are listed
        expect(within(listbox).getByText('Saigon Traders')).toBeInTheDocument();
        expect(within(listbox).getByText('Hanoi Imports')).toBeInTheDocument();

        // Typing filters the list down to the matching supplier
        await user.type(searchBox, 'hanoi');

        await waitFor(() => {
            expect(within(listbox).queryByText('Saigon Traders')).not.toBeInTheDocument();
        });
        expect(within(listbox).getByText('Hanoi Imports')).toBeInTheDocument();

        // Supplier is mandatory, so there is no entry to clear the selection.
        expect(within(listbox).queryByText('No supplier')).not.toBeInTheDocument();
    });

    it('pre-fills the supplier of the product being edited', async () => {
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const { dialog } = await openEditDialogFor('USB-C Fast Charger');

        expect(within(dialog).getByRole('combobox', { name: /supplier/i })).toHaveTextContent(
            'Saigon Traders'
        );
        expect(within(dialog).queryByText('Select a supplier')).not.toBeInTheDocument();
    });

    it('shows the placeholder for a product without a supplier', async () => {
        renderPage();
        await screen.findByText('Auto Disconnectors');

        const { dialog } = await openEditDialogFor('Auto Disconnectors');

        expect(within(dialog).getByRole('combobox', { name: /supplier/i })).toHaveTextContent(
            'Select a supplier'
        );
    });

    it('saves the supplier selected from the dropdown', async () => {
        renderPage();
        await screen.findByText('Auto Disconnectors');

        const { user, dialog } = await openEditDialogFor('Auto Disconnectors');

        await user.click(within(dialog).getByRole('combobox', { name: /supplier/i }));
        await user.click(await screen.findByText('Hanoi Imports'));

        // B2C price is mandatory, so it must be provided before saving.
        await user.type(within(dialog).getByRole('spinbutton', { name: 'B2C Price' }), '592000');

        await user.click(within(dialog).getByRole('button', { name: /update product/i }));

        await waitFor(() => {
            expect(calls.some((call) => call.method === 'PUT')).toBe(true);
        });

        const put = calls.find((call) => call.method === 'PUT')!;
        expect(put.url).toBe('/api/products/1');
        expect(put.body.supplierId).toBe(12);
    });

    it('blocks saving when no supplier is selected', async () => {
        renderPage();
        await screen.findByText('Auto Disconnectors');

        const { user, dialog } = await openEditDialogFor('Auto Disconnectors');

        // Provide a valid B2C price so the missing supplier is the only error.
        await user.type(within(dialog).getByRole('spinbutton', { name: 'B2C Price' }), '592000');

        await user.click(within(dialog).getByRole('button', { name: /update product/i }));

        expect(await within(dialog).findByText('Supplier is required')).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'PUT')).toBe(false);
    });

    it('marks Name, SKU, Category, Supplier and B2C Price with a red asterisk', async () => {
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const { dialog } = await openEditDialogFor('USB-C Fast Charger');

        const labelText = (element: Element | null) =>
            element?.tagName === 'LABEL' ? element.textContent?.trim() : undefined;

        const mandatory = ['Name', 'SKU', 'Category', 'Supplier', 'B2C Price'];
        for (const field of mandatory) {
            const label = within(dialog).getByText((_, element) => labelText(element) === `${field}*`);
            const star = label.querySelector('span');

            expect(star).not.toBeNull();
            expect(star).toHaveTextContent('*');
            // The asterisk must be red and decorative only.
            expect(star).toHaveClass('text-red-500');
            expect(star).toHaveAttribute('aria-hidden', 'true');
        }

        // Optional fields keep a plain label without an asterisk.
        const optional = ['Description', 'Brand', 'Minimum Stock', 'Landing Price', 'B2B Price'];
        for (const field of optional) {
            const label = within(dialog).getByText((_, element) => labelText(element) === field);
            expect(label.querySelector('span')).toBeNull();
        }
    });
});

describe('ProductsPage - save confirmation toasts', () => {
    let calls: FetchCall[];

    beforeEach(() => {
        // Radix UI primitives rely on these DOM APIs which happy-dom does not fully implement
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        calls = [];
        toastMock.mockClear();
        vi.stubGlobal('fetch', createFetchMock(calls));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('names the modified product and uses the green success style when an edit is saved', async () => {
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const { user, dialog } = await openEditDialogFor('USB-C Fast Charger');

        await user.click(within(dialog).getByRole('button', { name: /update product/i }));

        await waitFor(() => {
            expect(calls.some((call) => call.method === 'PUT')).toBe(true);
        });

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Success',
                    description: 'Product "USB-C Fast Charger" updated successfully',
                    // `success` renders the toast with a green background and white text.
                    variant: 'success',
                })
            );
        });
    });

    it('names the new product on the green success toast when a product is created', async () => {
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: /add product/i }));

        const dialog = await screen.findByRole('dialog');
        within(dialog)
            .getAllByRole('spinbutton')
            .forEach((input) => input.setAttribute('step', 'any'));

        await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'New Leash');
        await user.type(within(dialog).getByRole('textbox', { name: /^sku/i }), 'MP-NL-0003');

        // Category and supplier are mandatory: pick both before saving.
        await user.click(within(dialog).getByRole('combobox', { name: /category/i }));
        await user.click(await screen.findByRole('option', { name: 'Smart Gadgets' }));
        await selectSupplier(user, dialog, 'Saigon Traders');

        await user.type(within(dialog).getByRole('spinbutton', { name: /b2c price/i }), '120000');

        await user.click(within(dialog).getByRole('button', { name: /create product/i }));

        await waitFor(() => {
            expect(calls.some((call) => call.method === 'POST')).toBe(true);
        });

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Success',
                    description: 'Product "New Leash" created successfully',
                    variant: 'success',
                })
            );
        });
    });
});

