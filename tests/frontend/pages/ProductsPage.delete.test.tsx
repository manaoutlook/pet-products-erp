import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductsPage from '@/pages/ProductsPage';

// Permissions are not under test here - always allow everything.
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

const product = {
    id: 1,
    name: 'Products With Stock',
    description: 'Blocked product',
    sku: 'SKU-STOCK',
    price: '100000.00',
    landingPrice: '80000.00',
    b2bPrice: '90000.00',
    b2cPrice: '100000.00',
    categoryId: category.id,
    category,
    brandId: null,
    brand: null,
    supplierId: null,
    supplier: null,
    minStock: 0,
    weightKg: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    inventory: [{ quantity: 4 }],
    createdAt: now,
    updatedAt: now,
};

// Exactly what DELETE /api/products/1 returns once the backend guard finds stock.
const blockedBody = {
    message: 'Cannot delete product "Products With Stock" because it is still linked to 1 inventory record(s).',
    suggestion: 'Please remove or transfer the inventory first.',
};

const expectedToastText = `${blockedBody.message} ${blockedBody.suggestion}`;

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

describe('ProductsPage - delete blocked by inventory', () => {
    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        toastMock.mockClear();
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: any, init?: any) => {
                const url = typeof input === 'string' ? input : String(input?.url ?? input);
                const method = (init?.method ?? 'GET').toUpperCase();

                if (method === 'DELETE' && url.includes('/api/products/')) {
                    return {
                        ok: false,
                        status: 400,
                        json: async () => blockedBody,
                        text: async () => JSON.stringify(blockedBody),
                    } as Response;
                }

                const data = url.includes('/api/products')
                    ? [product]
                    : url.includes('/api/categories')
                        ? [category]
                        : [];

                return {
                    ok: true,
                    status: 200,
                    json: async () => data,
                    text: async () => JSON.stringify(data),
                } as Response;
            })
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('shows the API message and suggestion in a toast instead of an overlay', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Products With Stock');

        // Last icon button in the row is the trash/delete action.
        const row = screen.getByText('Products With Stock').closest('tr') as HTMLTableRowElement;
        const buttons = within(row).getAllByRole('button');
        await user.click(buttons[buttons.length - 1]);

        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText(/cannot be deleted/i)).toBeTruthy();

        await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Error',
                    description: expectedToastText,
                    variant: 'destructive',
                })
            );
        });

        // The mutation's onError closes the dialog, so the user is not stuck on it.
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    });
});
