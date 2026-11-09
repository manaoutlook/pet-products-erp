import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductsPage from '@/pages/ProductsPage';

vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => ({
        hasPermission: () => true,
        getModulePermissions: () => null,
        getAllowedModules: () => [],
        isAdmin: false,
    }),
}));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

const now = new Date('2024-01-01T00:00:00.000Z').toISOString();

const category = { id: 3, name: 'Smart Gadgets', description: null };

const baseProduct = {
    description: null,
    price: '592000.00',
    landingPrice: null,
    b2bPrice: null,
    b2cPrice: '592000.00',
    categoryId: category.id,
    category,
    brandId: null,
    brand: null,
    supplierId: null,
    supplier: null,
    minStock: 1,
    inventory: [{ quantity: 5 }],
    createdAt: now,
    updatedAt: now,
};

/**
 * The product grid shows exactly one picture per row: the featured one. The extra
 * gallery pictures are stored with the product but must not clutter the list.
 */
const products = [
    {
        ...baseProduct,
        id: 1,
        name: 'Featured Product',
        sku: 'IMG-001',
        imageUrl: '/uploads/products/featured.png',
        galleryImages: ['/uploads/products/g1.png', '/uploads/products/g2.png'],
    },
    {
        ...baseProduct,
        id: 2,
        name: 'Plain Product',
        sku: 'IMG-002',
        imageUrl: null,
        galleryImages: [],
    },
];

function renderPage() {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: any) => {
            const url = typeof input === 'string' ? input : String(input?.url ?? input);

            let data: unknown = {};
            if (url.includes('/api/products')) data = products;
            else if (url.includes('/api/brands')) data = [];
            else if (url.includes('/api/suppliers')) data = [];
            else if (url.includes('/api/categories')) data = [category];

            return {
                ok: true,
                status: 200,
                json: async () => data,
                text: async () => JSON.stringify(data),
            } as Response;
        })
    );

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

describe('ProductsPage - featured picture', () => {
    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders the featured picture in the row and a placeholder when there is none', async () => {
        renderPage();

        await screen.findByText('Featured Product');

        const featuredRow = screen.getByText('Featured Product').closest('tr') as HTMLTableRowElement;
        const image = within(featuredRow).getByRole('img', { name: 'Featured Product' });
        expect(image).toHaveAttribute('src', '/uploads/products/featured.png');

        // Only the featured picture is shown - the gallery stays out of the grid.
        expect(within(featuredRow).getAllByRole('img')).toHaveLength(1);

        const plainRow = screen.getByText('Plain Product').closest('tr') as HTMLTableRowElement;
        expect(within(plainRow).queryByRole('img')).not.toBeInTheDocument();
        expect(within(plainRow).getByTitle('No featured picture')).toBeInTheDocument();
    });
});
