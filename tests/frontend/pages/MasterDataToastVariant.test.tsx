import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import CategoryPage from '@/pages/CategoryPage';
import BrandsPage from '@/pages/BrandsPage';
import SuppliersPage from '@/pages/SuppliersPage';

// Permissions are not under test here - always allow everything
vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => ({
        hasPermission: () => true,
        getModulePermissions: () => null,
        getAllowedModules: () => [],
    }),
}));

// Avoid rendering the real toast provider
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

const now = new Date('2024-01-01T00:00:00.000Z').toISOString();

const categories = [
    {
        id: 1,
        name: 'Dogs',
        description: 'Dog products',
        parentId: null,
        createdAt: now,
        updatedAt: now,
    },
];

const brands = [
    {
        id: 1,
        name: 'Pedigree',
        description: 'Dog food brand',
        createdAt: now,
        updatedAt: now,
    },
];

const suppliers = [
    {
        id: 1,
        name: 'Acme Pet Supplies',
        contactInfo: 'acme@example.com',
        address: '123 Main St',
        createdAt: now,
        updatedAt: now,
    },
];

type Row = (typeof categories)[number] | (typeof brands)[number] | (typeof suppliers)[number];

function jsonResponse(data: unknown) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => JSON.stringify(data),
    } as Response);
}

function renderPage(ui: ReactElement) {
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

    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/**
 * Deletes the only row on the page through the row's trash button and returns
 * the toast payload the page produced. Every master-data screen must show the
 * same green "success" toast as the products screen.
 */
async function deleteFirstRow(
    ui: ReactElement,
    list: Row[],
    endpoint: string,
    rowLabel: string,
    confirmMessage: string
) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
            return jsonResponse({ message: 'deleted' });
        }
        return jsonResponse(list);
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderPage(ui);

    await screen.findByText(rowLabel);

    const row = screen.getByText(rowLabel).closest('tr') as HTMLTableRowElement;
    const rowButtons = within(row).getAllByRole('button');
    await user.click(rowButtons[rowButtons.length - 1]);

    await waitFor(() => {
        expect(globalThis.confirm).toHaveBeenCalledWith(confirmMessage);
    });

    await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
            `${endpoint}/1`,
            expect.objectContaining({ method: 'DELETE' })
        );
    });

    await waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Success',
                variant: 'success',
            })
        );
    });

    return toastMock.mock.calls[0][0];
}

describe('Master data pages - success toast styling', () => {
    beforeEach(() => {
        // Radix UI primitives rely on these DOM APIs which happy-dom does not fully implement
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        toastMock.mockClear();
        vi.stubGlobal('confirm', vi.fn(() => true));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('uses the green success variant on the categories screen', async () => {
        const payload = await deleteFirstRow(
            <CategoryPage />,
            categories,
            '/api/categories',
            'Dogs',
            'Are you sure you want to delete this category?'
        );

        expect(payload).toMatchObject({
            title: 'Success',
            description: 'Category deleted successfully',
            variant: 'success',
        });
    });

    it('uses the green success variant on the brands screen', async () => {
        const payload = await deleteFirstRow(
            <BrandsPage />,
            brands,
            '/api/brands',
            'Pedigree',
            'Are you sure you want to delete this brand?'
        );

        expect(payload).toMatchObject({
            title: 'Success',
            description: 'Brand deleted successfully',
            variant: 'success',
        });
    });

    it('uses the green success variant on the suppliers screen', async () => {
        const payload = await deleteFirstRow(
            <SuppliersPage />,
            suppliers,
            '/api/suppliers',
            'Acme Pet Supplies',
            'Are you sure you want to delete this supplier?'
        );

        expect(payload).toMatchObject({
            title: 'Success',
            description: 'Supplier deleted successfully',
            variant: 'success',
        });
    });
});
