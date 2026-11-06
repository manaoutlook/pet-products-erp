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

// The toast is the only way the export/import helpers report what happened, so
// the mock is hoisted and asserted on below.
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

const now = new Date('2024-01-01T00:00:00.000Z').toISOString();
const category = { id: 3, name: 'Smart Gadgets', description: null };

const products = [
    {
        id: 1,
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

type FetchCall = { url: string; method: string; body: any };

type ImportApiResult = {
    message: string;
    total: number;
    created: number;
    updated: number;
    skipped: number;
    createdCategories: number;
    createdBrands: number;
    createdSuppliers: number;
    errors: { row: number; sku?: string; name?: string; message: string }[];
};

function createImportResult(overrides: Partial<ImportApiResult> = {}): ImportApiResult {
    return {
        message: 'Import finished: 2 created',
        total: 2,
        created: 2,
        updated: 0,
        skipped: 0,
        createdCategories: 0,
        createdBrands: 0,
        createdSuppliers: 0,
        errors: [],
        ...overrides,
    };
}

function createFetchMock(calls: FetchCall[], importResult: () => ImportApiResult) {
    return vi.fn(async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        const method = (init?.method ?? 'GET').toUpperCase();

        let body: any = undefined;
        if (typeof init?.body === 'string') {
            body = JSON.parse(init.body);
        }
        calls.push({ url, method, body });

        let data: unknown = {};
        if (url.includes('/api/products/import')) {
            data = importResult();
        } else if (url.includes('/api/products')) {
            data = method === 'GET' ? products : products[0];
        } else if (url.includes('/api/brands')) {
            data = [{ id: 7, name: 'Anker' }];
        } else if (url.includes('/api/suppliers')) {
            data = [{ id: 11, name: 'Saigon Traders', contactInfo: '0901234567', address: 'HCMC' }];
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

const CSV_CONTENT = [
    'Name,SKU,Category,Supplier,B2B Price,B2C Price',
    'Gel Pen,GEL-1,Stationery,Saigon Traders,12000,15000',
    'Notebook,NB-1,Stationery,Saigon Traders,20000,25000',
].join('\n');

async function openImportDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /^import$/i }));
    return screen.findByRole('dialog');
}

describe('ProductsPage - import products', () => {
    let calls: FetchCall[];
    let importResult: () => ImportApiResult;

    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        // happy-dom implements neither of these download helpers
        URL.createObjectURL = vi.fn(() => 'blob:mock') as any;
        URL.revokeObjectURL = vi.fn() as any;

        calls = [];
        importResult = () => createImportResult();
        toastMock.mockClear();
        vi.stubGlobal('fetch', createFetchMock(calls, () => importResult()));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('opens the import popup with an upload field and both template buttons', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const dialog = await openImportDialog(user);

        expect(within(dialog).getByText('Import Products')).toBeInTheDocument();
        expect(within(dialog).getByLabelText('Product spreadsheet file')).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /csv format/i })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /excel format/i })).toBeInTheDocument();
    });

    it('downloads the CSV and Excel templates', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const dialog = await openImportDialog(user);

        await user.click(within(dialog).getByRole('button', { name: /csv format/i }));
        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({ description: 'product-import-template.csv' })
            );
        });

        await user.click(within(dialog).getByRole('button', { name: /excel format/i }));
        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({ description: 'product-import-template.xlsx' })
            );
        });
    });

    it('previews a CSV file and posts its rows to the import API', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const dialog = await openImportDialog(user);

        const file = new File([CSV_CONTENT], 'products.csv', { type: 'text/csv' });
        await user.upload(within(dialog).getByLabelText('Product spreadsheet file'), file);

        expect(await within(dialog).findByText('2 products found')).toBeInTheDocument();
        expect(within(dialog).getByText('Gel Pen')).toBeInTheDocument();
        expect(within(dialog).getByText('Notebook')).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: /import 2 products/i }));

        await waitFor(() => {
            expect(calls.some((call) => call.url === '/api/products/import')).toBe(true);
        });

        const post = calls.find((call) => call.url === '/api/products/import')!;
        expect(post.method).toBe('POST');
        expect(post.body.updateExisting).toBe(true);
        expect(post.body.rows).toHaveLength(2);
        expect(post.body.rows[0]).toMatchObject({
            name: 'Gel Pen',
            sku: 'GEL-1',
            category: 'Stationery',
            b2cPrice: 15000,
        });

        expect(await within(dialog).findByText('Import finished: 2 created')).toBeInTheDocument();
        expect(
            within(dialog).getByRole('button', { name: /import another file/i })
        ).toBeInTheDocument();
    });

    it('lists the rows the server rejected', async () => {
        importResult = () =>
            createImportResult({
                message: 'Import finished: 1 created, 1 failed',
                total: 2,
                created: 1,
                errors: [{ row: 3, sku: 'NB-1', message: 'B2C price must be a positive number' }],
            });

        const user = userEvent.setup();
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const dialog = await openImportDialog(user);

        const file = new File([CSV_CONTENT], 'products.csv', { type: 'text/csv' });
        await user.upload(within(dialog).getByLabelText('Product spreadsheet file'), file);
        await within(dialog).findByText('2 products found');

        await user.click(within(dialog).getByRole('button', { name: /import 2 products/i }));

        expect(await within(dialog).findByText('1 row could not be imported')).toBeInTheDocument();
        expect(within(dialog).getByText(/B2C price must be a positive number/)).toBeInTheDocument();
        expect(within(dialog).getByText('Row 3')).toBeInTheDocument();
    });

    it('reports a missing required column instead of importing the file', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        const dialog = await openImportDialog(user);

        const badFile = new File(['Name,SKU\nGel Pen,GEL-1'], 'bad.csv', { type: 'text/csv' });
        await user.upload(within(dialog).getByLabelText('Product spreadsheet file'), badFile);

        expect(await within(dialog).findByText(/Missing required columns/i)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /^import$/i })).toBeDisabled();
        expect(calls.some((call) => call.url === '/api/products/import')).toBe(false);
    });
});

describe('ProductsPage - export products', () => {
    let calls: FetchCall[];

    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        URL.createObjectURL = vi.fn(() => 'blob:mock') as any;
        URL.revokeObjectURL = vi.fn() as any;

        calls = [];
        toastMock.mockClear();
        vi.stubGlobal('fetch', createFetchMock(calls, () => createImportResult()));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('exports the listed products as CSV from the Export dropdown', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        await user.click(screen.getByRole('button', { name: /export/i }));
        await user.click(await screen.findByRole('menuitem', { name: /csv/i }));

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Export ready',
                    description: expect.stringContaining('.csv'),
                })
            );
        });
    });

    it('exports the listed products as Excel from the Export dropdown', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByText('USB-C Fast Charger');

        await user.click(screen.getByRole('button', { name: /export/i }));
        await user.click(await screen.findByRole('menuitem', { name: /excel/i }));

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Export ready',
                    description: expect.stringContaining('.xlsx'),
                })
            );
        });
    });
});
