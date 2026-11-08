import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CategoryPage from '@/pages/CategoryPage';
import BrandsPage from '@/pages/BrandsPage';
import SuppliersPage from '@/pages/SuppliersPage';

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

type FetchCall = { url: string; method: string; body: any };

type BulkDeleteResult = {
    message: string;
    deletedCount: number;
    failedCount: number;
    deleted: number[];
    failed: { id: number; name: string | null; message: string }[];
};

/**
 * Bulk delete of the master data screens (Categories / Brands / Suppliers).
 * The checkbox selection and the AlertDialog behave like the Products page.
 */
function createFetchMock(
    endpoint: string,
    rows: unknown,
    calls: FetchCall[],
    bulkResult: () => BulkDeleteResult
) {
    return vi.fn(async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        const method = (init?.method ?? 'GET').toUpperCase();

        let body: any = undefined;
        if (typeof init?.body === 'string') body = JSON.parse(init.body);
        calls.push({ url, method, body });

        let data: unknown = [];
        if (url.includes(`${endpoint}/bulk-delete`)) {
            data = bulkResult();
        } else if (url.includes(endpoint)) {
            data = rows;
        }

        return {
            ok: true,
            status: 200,
            json: async () => data,
            text: async () => JSON.stringify(data),
        } as Response;
    });
}

function renderPage(component: React.ReactElement) {
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

    return render(<QueryClientProvider client={queryClient}>{component}</QueryClientProvider>);
}

describe('Master data pages - bulk delete', () => {
    let calls: FetchCall[];

    const bulkCalls = (endpoint: string) =>
        calls.filter((call) => call.url.includes(`${endpoint}/bulk-delete`));

    const successResult = (count: number, plural: string): BulkDeleteResult => ({
        message: `Deleted ${count} ${plural}`,
        deletedCount: count,
        failedCount: 0,
        deleted: [1, 2],
        failed: [],
    });

    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        calls = [];
        toastMock.mockClear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('deletes the selected categories in one request', async () => {
        vi.stubGlobal(
            'fetch',
            createFetchMock(
                '/api/categories',
                [
                    { id: 1, name: 'Dogs', description: 'Dog products', parentId: null, createdAt: now, updatedAt: now },
                    { id: 2, name: 'Food', description: 'Food products', parentId: null, createdAt: now, updatedAt: now },
                ],
                calls,
                () => successResult(2, 'categories')
            )
        );

        const user = userEvent.setup();
        renderPage(<CategoryPage />);

        await screen.findByText('Dogs');

        await user.click(screen.getByLabelText('Select Dogs'));
        await user.click(screen.getByLabelText('Select Food'));
        expect(screen.getByText('2 selected')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: /delete selected categories/i }));
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText(/Delete 2 selected categories\?/i)).toBeTruthy();

        await user.click(within(dialog).getByRole('button', { name: /^delete selected$/i }));

        await waitFor(() => expect(bulkCalls('/api/categories')).toHaveLength(1));
        expect(bulkCalls('/api/categories')[0].method).toBe('POST');
        expect(bulkCalls('/api/categories')[0].body).toEqual({ ids: [1, 2] });

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Success',
                    description: 'Deleted 2 categories',
                    variant: 'success',
                })
            );
        });
    });

    it('toggles every visible brand with the header checkbox', async () => {
        vi.stubGlobal(
            'fetch',
            createFetchMock(
                '/api/brands',
                [
                    { id: 1, name: 'Pedigree', description: 'Dog food', createdAt: now, updatedAt: now },
                    { id: 2, name: 'Whiskas', description: 'Cat food', createdAt: now, updatedAt: now },
                ],
                calls,
                () => successResult(2, 'brands')
            )
        );

        const user = userEvent.setup();
        renderPage(<BrandsPage />);

        await screen.findByText('Pedigree');

        await user.click(screen.getByLabelText('Select all brands'));
        expect(screen.getByText('2 selected')).toBeTruthy();

        await user.click(screen.getByLabelText('Select all brands'));
        expect(screen.queryByText('2 selected')).toBeNull();
    });

    it('reports suppliers that could not be deleted and keeps them selected', async () => {
        vi.stubGlobal(
            'fetch',
            createFetchMock(
                '/api/suppliers',
                [
                    { id: 1, name: 'Acme Trading', contactInfo: '0901', address: 'HCMC', createdAt: now, updatedAt: now },
                    { id: 2, name: 'Saigon Traders', contactInfo: '0902', address: 'HCMC', createdAt: now, updatedAt: now },
                ],
                calls,
                () => ({
                    message: 'Deleted 1 supplier · 1 could not be deleted',
                    deletedCount: 1,
                    failedCount: 1,
                    deleted: [1],
                    failed: [
                        {
                            id: 2,
                            name: 'Saigon Traders',
                            message: 'Has 2 inventory records - remove the inventory first',
                        },
                    ],
                })
            )
        );

        const user = userEvent.setup();
        renderPage(<SuppliersPage />);

        await screen.findByText('Acme Trading');

        await user.click(screen.getByLabelText('Select all suppliers'));
        await user.click(screen.getByRole('button', { name: /delete selected suppliers/i }));

        const dialog = await screen.findByRole('alertdialog');
        await user.click(within(dialog).getByRole('button', { name: /^delete selected$/i }));

        await waitFor(() => expect(bulkCalls('/api/suppliers')).toHaveLength(1));

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'suppliers deleted' })
            );
        });
        expect(toastMock.mock.calls[0][0].description).toContain('Saigon Traders');

        // The supplier that could not be deleted stays selected for a retry.
        expect(screen.getByText('1 selected')).toBeTruthy();
    });
});
