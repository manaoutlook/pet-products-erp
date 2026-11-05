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

// Avoid rendering the real toast provider
vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
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
        categoryId: category.id,
        category,
        brandId: null,
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
        categoryId: category.id,
        category,
        brandId: 7,
        brand: { id: 7, name: 'Anker' },
        minStock: 5,
        inventory: [{ quantity: 2 }],
        createdAt: now,
        updatedAt: now,
    },
];

const brands = [{ id: 7, name: 'Anker' }];

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
        .getByRole('spinbutton', { name: 'Price' })
        .setAttribute('step', 'any');

    return { user, dialog };
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
