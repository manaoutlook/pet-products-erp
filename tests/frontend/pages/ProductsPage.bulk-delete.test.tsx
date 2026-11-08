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

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

const now = new Date('2024-01-01T00:00:00.000Z').toISOString();
const category = { id: 3, name: 'Smart Gadgets', description: null };

const makeProduct = (id: number, name: string, sku: string) => ({
    id,
    name,
    description: `${name} description`,
    sku,
    price: '100000.00',
    landingPrice: '80000.00',
    b2bPrice: '90000.00',
    b2cPrice: '100000.00',
    categoryId: category.id,
    category,
    brandId: null,
    brand: null,
    supplierId: 11,
    supplier: { id: 11, name: 'Saigon Traders', contactInfo: '0901234567' },
    minStock: 5,
    weightKg: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    inventory: [{ quantity: 10 }],
    createdAt: now,
    updatedAt: now,
});

const products = [makeProduct(1, 'Product A', 'SKU-A'), makeProduct(2, 'Product B', 'SKU-B')];

type FetchCall = { url: string; method: string; body: any };

type BulkDeleteResult = {
    message: string;
    deletedCount: number;
    failedCount: number;
    deleted: number[];
    failed: { id: number; name: string | null; message: string }[];
};

function createFetchMock(calls: FetchCall[], bulkResult: () => BulkDeleteResult) {
    return vi.fn(async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        const method = (init?.method ?? 'GET').toUpperCase();

        let body: any = undefined;
        if (typeof init?.body === 'string') {
            body = JSON.parse(init.body);
        }
        calls.push({ url, method, body });

        let data: unknown = {};
        if (url.includes('/api/products/bulk-delete')) {
            data = bulkResult();
        } else if (url.includes('/api/products')) {
            data = products;
        } else if (url.includes('/api/brands')) {
            data = [];
        } else if (url.includes('/api/suppliers')) {
            data = [{ id: 11, name: 'Saigon Traders', contactInfo: '0901234567' }];
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

describe('ProductsPage - bulk delete', () => {
    let calls: FetchCall[];
    let bulkResult: () => BulkDeleteResult;

    const bulkCalls = () => calls.filter((call) => call.url.includes('/api/products/bulk-delete'));

    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        calls = [];
        bulkResult = () => ({
            message: 'Deleted 2 products',
            deletedCount: 2,
            failedCount: 0,
            deleted: [1, 2],
            failed: [],
        });
        toastMock.mockClear();
        vi.stubGlobal('fetch', createFetchMock(calls, () => bulkResult()));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('selects rows and deletes them in one request', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Product A');

        await user.click(screen.getByLabelText('Select Product A'));
        await user.click(screen.getByLabelText('Select Product B'));

        expect(screen.getByText('2 selected')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: /^delete selected$/i }));
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText(/Delete 2 selected products\?/i)).toBeTruthy();

        await user.click(within(dialog).getByRole('button', { name: /^delete selected$/i }));

        await waitFor(() => expect(bulkCalls()).toHaveLength(1));
        expect(bulkCalls()[0].method).toBe('POST');
        expect(bulkCalls()[0].body).toEqual({ ids: [1, 2] });

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Success', description: 'Deleted 2 products' })
            );
        });
    });

    it('toggles every visible row with the header checkbox', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Product A');

        await user.click(screen.getByLabelText('Select all products'));
        expect(screen.getByText('2 selected')).toBeTruthy();

        await user.click(screen.getByLabelText('Select all products'));
        expect(screen.queryByText('2 selected')).toBeNull();
    });

    it('reports products that could not be deleted and keeps them selected', async () => {
        bulkResult = () => ({
            message: 'Deleted 1 product · 1 could not be deleted',
            deletedCount: 1,
            failedCount: 1,
            deleted: [1],
            failed: [
                { id: 2, name: 'Product B', message: 'Used in orders - archive the product instead' },
            ],
        });

        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Product A');
        await user.click(screen.getByLabelText('Select Product A'));
        await user.click(screen.getByLabelText('Select Product B'));

        await user.click(screen.getByRole('button', { name: /^delete selected$/i }));
        const dialog = await screen.findByRole('alertdialog');
        await user.click(within(dialog).getByRole('button', { name: /^delete selected$/i }));

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Products deleted',
                    description: expect.stringContaining('Product B: Used in orders'),
                })
            );
        });

        // The skipped product stays selected so it can be retried.
        await waitFor(() => expect(screen.getByText('1 selected')).toBeTruthy());
    });
});

