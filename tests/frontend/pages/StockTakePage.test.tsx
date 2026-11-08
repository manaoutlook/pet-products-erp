import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StockTakePage from '@/pages/StockTakePage';

const permissions = { canUpdate: true };

vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => ({
        hasPermission: () => permissions.canUpdate,
        getModulePermissions: () => null,
        getAllowedModules: () => [],
        isAdmin: false,
    }),
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

const countedAt = new Date('2026-02-01T09:30:00.000Z').toISOString();

const rows = [
    {
        inventoryId: 1,
        productId: 10,
        productName: 'Adult Dog Food 10kg',
        sku: 'DOG-10',
        storeId: 2,
        storeName: 'District 1',
        inventoryType: 'STORE',
        systemQuantity: 12,
        lastCountedQuantity: 10,
        lastVariance: -2,
        lastCountedAt: countedAt,
        lastNote: 'two bags torn',
    },
    {
        inventoryId: 2,
        productId: 11,
        productName: 'Cat Litter 5L',
        sku: 'CAT-05',
        storeId: null,
        storeName: null,
        inventoryType: 'DC',
        systemQuantity: 40,
        lastCountedQuantity: null,
        lastVariance: null,
        lastCountedAt: null,
        lastNote: null,
    },
];

type FetchCall = { url: string; method: string; body: any };

function createFetchMock(calls: FetchCall[]) {
    return vi.fn(async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        const method = (init?.method ?? 'GET').toUpperCase();

        let body: any = undefined;
        if (typeof init?.body === 'string') body = JSON.parse(init.body);
        calls.push({ url, method, body });

        let data: unknown = rows;
        if (method === 'POST') {
            data = {
                message: 'Stock adjusted',
                adjustment: {
                    inventoryId: 1,
                    quantityBefore: 12,
                    quantityAfter: 9,
                    delta: -3,
                    movementWritten: true,
                },
            };
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
            <StockTakePage />
        </QueryClientProvider>
    );
}

describe('StockTakePage', () => {
    let calls: FetchCall[];

    beforeEach(() => {
        permissions.canUpdate = true;
        calls = [];
        toastMock.mockClear();
        vi.stubGlobal('fetch', createFetchMock(calls));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

describe('StockTakePage behaviour', () => {
    it('lists the system quantity next to the last count', async () => {
        renderPage();

        expect(await screen.findByText('Adult Dog Food 10kg')).toBeInTheDocument();
        const row = screen.getByText('Adult Dog Food 10kg').closest('tr') as HTMLTableRowElement;

        expect(within(row).getByText('District 1')).toBeInTheDocument();
        expect(within(row).getByText('12')).toBeInTheDocument();
        expect(within(row).getByText('-2')).toBeInTheDocument();
        expect(within(row).getByText('two bags torn')).toBeInTheDocument();

        // DC rows have no store name, so the screen shows the warehouse label.
        expect(screen.getByText('Cat Litter 5L')).toBeInTheDocument();
        expect(screen.getByText('Warehouse (DC)')).toBeInTheDocument();
        expect(screen.getByText('never counted')).toBeInTheDocument();
    });

    it('shows the difference while typing a counted quantity', async () => {
        renderPage();
        await screen.findByText('Adult Dog Food 10kg');

        const input = screen.getByRole('textbox', { name: 'Counted quantity for Adult Dog Food 10kg' });
        await userEvent.type(input, '9');

        const row = screen.getByText('Adult Dog Food 10kg').closest('tr') as HTMLTableRowElement;
        // 9 counted vs 12 in the system
        expect(within(row).getByText('-3')).toBeInTheDocument();
        expect(screen.getByText('1 unsaved count')).toBeInTheDocument();

        // Nothing is sent to the server until the count is saved.
        expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    });

    it('posts countedQuantity with the reason instead of a computed delta', async () => {
        renderPage();
        await screen.findByText('Adult Dog Food 10kg');

        const reason = screen.getByLabelText('Reason recorded with each adjustment');
        await userEvent.clear(reason);
        await userEvent.type(reason, 'stock take february');

        await userEvent.type(
            screen.getByRole('textbox', { name: 'Counted quantity for Adult Dog Food 10kg' }),
            '9'
        );

        const row = screen.getByText('Adult Dog Food 10kg').closest('tr') as HTMLTableRowElement;
        await userEvent.click(within(row).getByRole('button', { name: /save count/i }));

        await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));

        const post = calls.find((call) => call.method === 'POST')!;
        expect(post.url).toBe('/api/inventory/1/adjust');
        // The server derives the delta from the stored quantity - the screen must not send one.
        expect(post.body).toEqual({
            countedQuantity: 9,
            reason: 'stock take february',
            source: 'stock_take',
        });
        expect(post.body).not.toHaveProperty('delta');

        await waitFor(() =>
            expect(screen.getByText('Saved → 9')).toBeInTheDocument()
        );
    });

    it('disables saving without the inventory update permission', async () => {
        permissions.canUpdate = false;
        renderPage();
        await screen.findByText('Adult Dog Food 10kg');

        expect(
            screen.getByText(/need the inventory update permission/i)
        ).toBeInTheDocument();

        const row = screen.getByText('Adult Dog Food 10kg').closest('tr') as HTMLTableRowElement;
        expect(within(row).getByRole('button', { name: /save count/i })).toBeDisabled();
        expect(
            screen.getByRole('textbox', { name: 'Counted quantity for Adult Dog Food 10kg' })
        ).toBeDisabled();
    });
});

});
