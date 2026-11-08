import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CategoryPage from '@/pages/CategoryPage';
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

const categories = [
    { id: 1, name: 'Dogs', description: 'Dog products', parentId: null, createdAt: now, updatedAt: now },
    { id: 2, name: 'Dog Food', description: 'Dry food', parentId: 1, createdAt: now, updatedAt: now },
    { id: 3, name: 'Cat Food', description: 'Wet food', parentId: null, createdAt: now, updatedAt: now },
];

const suppliers = [
    { id: 1, name: 'Acme Trading', contactInfo: '0901234567', address: 'HCMC', createdAt: now, updatedAt: now },
    { id: 2, name: 'Saigon Traders', contactInfo: '0909876543', address: 'District 7', createdAt: now, updatedAt: now },
];

/** Download spy: keeps the generated Blob so the file content can be asserted. */
let downloads: Blob[] = [];

function stubFetch(rowsByEndpoint: Record<string, unknown>) {
    return vi.fn(async (input: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        const match = Object.keys(rowsByEndpoint).find((endpoint) => url.includes(endpoint));
        const data = match ? rowsByEndpoint[match] : [];

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

async function exportAs(user: ReturnType<typeof userEvent.setup>, format: RegExp) {
    await user.click(screen.getByRole('button', { name: /^export$/i }));
    await user.click(await screen.findByRole('menuitem', { name: format }));
}

describe('Master data pages - export', () => {
    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        downloads = [];
        const createObjectURL = vi.fn((blob: Blob) => {
            downloads.push(blob);
            return 'blob:mock';
        });
        Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
        Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });

        toastMock.mockClear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('exports the listed categories as CSV with their parent category', async () => {
        vi.stubGlobal('fetch', stubFetch({ '/api/categories': categories }));

        const user = userEvent.setup();
        renderPage(<CategoryPage />);
        await screen.findByText('Dog Food');

        await exportAs(user, /csv/i);

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Export ready',
                    description: expect.stringContaining('.csv'),
                    variant: 'success',
                })
            );
        });

        expect(toastMock.mock.calls[0][0].description).toContain('3 categories');

        const csv = (await downloads[0].text()).replace(/^\uFEFF/, '');
        expect(csv.split('\n')[0]).toBe('Category Name,Description,Parent Category');
        expect(csv).toContain('Dog Food,Dry food,Dogs');
    });

    it('exports only the rows matching the search', async () => {
        vi.stubGlobal('fetch', stubFetch({ '/api/categories': categories }));

        const user = userEvent.setup();
        renderPage(<CategoryPage />);
        await screen.findByText('Dog Food');

        await user.type(screen.getByPlaceholderText('Search categories...'), 'Dog Food');
        await exportAs(user, /csv/i);

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Export ready',
                    description: expect.stringContaining('1 category'),
                })
            );
        });

        const csv = (await downloads[0].text()).replace(/^\uFEFF/, '');
        expect(csv).toContain('Dog Food');
        expect(csv).not.toContain('Cat Food');
    });

    it('exports the listed suppliers as Excel', async () => {
        vi.stubGlobal('fetch', stubFetch({ '/api/suppliers': suppliers }));

        const user = userEvent.setup();
        renderPage(<SuppliersPage />);
        await screen.findByText('Acme Trading');

        await exportAs(user, /excel/i);

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Export ready',
                    description: expect.stringContaining('.xlsx'),
                })
            );
        });

        expect(downloads).toHaveLength(1);
        expect(downloads[0].type).toBe(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
    });

    it('tells the user when the search matches nothing', async () => {
        vi.stubGlobal('fetch', stubFetch({ '/api/categories': categories }));

        const user = userEvent.setup();
        renderPage(<CategoryPage />);
        await screen.findByText('Dog Food');

        await user.type(screen.getByPlaceholderText('Search categories...'), 'zzzz');
        await exportAs(user, /csv/i);

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Nothing to export',
                    variant: 'destructive',
                })
            );
        });
        expect(downloads).toHaveLength(0);
    });
});
