import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

const now = new Date('2024-01-01T00:00:00.000Z').toISOString();

const suppliers = [
    {
        id: 1,
        name: 'Tonglu Haoerge Stationery Co., Ltd.',
        contactInfo: 'Thomas zhang',
        address: 'CN,Zhejiang,Hangzhou,No. 896, Academian Road, Fenshui Town',
        createdAt: now,
        updatedAt: now,
    },
    {
        id: 2,
        name: 'Shanghai Haxin',
        contactInfo: 'haxin20@163.com',
        address: '55555',
        createdAt: now,
        updatedAt: now,
    },
];

function jsonResponse(data: unknown) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => JSON.stringify(data),
    } as Response);
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
            <SuppliersPage />
        </QueryClientProvider>
    );
}

describe('SuppliersPage - View Supplier', () => {
    beforeEach(() => {
        // Radix UI primitives rely on these DOM APIs which happy-dom does not fully implement
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        vi.stubGlobal(
            'fetch',
            vi.fn(() => jsonResponse(suppliers))
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('shows the supplier details in a dialog instead of inline on the page', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Tonglu Haoerge Stationery Co., Ltd.');

        // The details block must not be rendered on the page before opening the dialog
        expect(screen.queryByText('Supplier Details')).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        // Click the "view" (eye) icon of the first row
        const firstRow = screen
            .getByText('Tonglu Haoerge Stationery Co., Ltd.')
            .closest('tr') as HTMLTableRowElement;
        await user.click(within(firstRow).getAllByRole('button')[0]);

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Supplier Details')).toBeInTheDocument();
        expect(within(dialog).getByText('Thomas zhang')).toBeInTheDocument();
        expect(
            within(dialog).getByText('CN,Zhejiang,Hangzhou,No. 896, Academian Road, Fenshui Town')
        ).toBeInTheDocument();

        // Rendered exactly once - only inside the dialog
        expect(screen.getAllByText('Supplier Details')).toHaveLength(1);
    });

    it('closes the details dialog again', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Shanghai Haxin');

        const secondRow = screen.getByText('Shanghai Haxin').closest('tr') as HTMLTableRowElement;
        await user.click(within(secondRow).getAllByRole('button')[0]);

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('haxin20@163.com')).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: /close/i }));

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
        expect(screen.queryByText('Supplier Details')).not.toBeInTheDocument();
    });
});
