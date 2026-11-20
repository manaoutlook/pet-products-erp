import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReceiptsPage from '@/pages/ReceiptsPage';

vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => ({
        hasPermission: () => true,
        getModulePermissions: () => null,
        getAllowedModules: () => [],
    }),
}));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

vi.mock('@/hooks/use-user', () => ({
    useUser: () => ({ user: { id: 1, username: 'admin', role: 'admin' } }),
}));

// The letterhead is not under test; stub the hook so no company request is made.
vi.mock('@/hooks/use-company', () => ({
    useCompanyInfo: () => ({
        company: null,
        missingFields: [],
        valid: false,
        isLoading: false,
    }),
}));

function jsonResponse(data: unknown) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => JSON.stringify(data),
    } as Response);
}

function renderPage() {
    vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.startsWith('/api/invoice-payments')) {
                return jsonResponse({
                    receipts: [],
                    total: 0,
                    limit: 200,
                    offset: 0,
                    summary: { receiptCount: 0, receivedTotal: 0, voidedCount: 0 },
                });
            }
            if (url.startsWith('/api/sales-transactions')) {
                return jsonResponse([]);
            }
            return jsonResponse({});
        }) as unknown as typeof fetch
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
            <ReceiptsPage />
        </QueryClientProvider>
    );
}

/**
 * Receipts page tabs - the Finance report links here as `/receipts?tab=customer`, so the
 * customer-receipt register (the actual sales income transactions) must open directly, and the
 * address bar must keep saying which register is on screen.
 */
describe('ReceiptsPage - tab deep link', () => {
    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        window.history.replaceState(null, '', '/receipts');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        window.history.replaceState(null, '', '/');
    });

    it('opens on till receipts when the URL says nothing', async () => {
        renderPage();

        expect(await screen.findByText('Transaction Receipts')).toBeInTheDocument();
        expect(screen.queryByText('Customer Receipts')).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /till receipts/i })).toHaveAttribute(
            'aria-selected',
            'true'
        );
    });

    it('opens the customer receipts register straight from ?tab=customer', async () => {
        window.history.replaceState(null, '', '/receipts?tab=customer');
        renderPage();

        expect(await screen.findByText('Customer Receipts')).toBeInTheDocument();
        expect(screen.queryByText('Transaction Receipts')).not.toBeInTheDocument();

        const customerTab = screen.getByRole('tab', { name: /customer receipts/i });
        expect(customerTab).toHaveAttribute('aria-selected', 'true');
        // The register is the place the sales income actually lives, so the page has to say so.
        expect(screen.getByText(/one row per/i)).toBeInTheDocument();
    });

    it('keeps the address bar in step when the tabs are switched', async () => {
        const user = userEvent.setup();
        window.history.replaceState(null, '', '/receipts?tab=customer');
        renderPage();

        await screen.findByText('Customer Receipts');
        await user.click(screen.getByRole('tab', { name: /till receipts/i }));

        await waitFor(() =>
            expect(screen.getByRole('tab', { name: /till receipts/i })).toHaveAttribute(
                'aria-selected',
                'true'
            )
        );
        expect(window.location.search).toBe('');

        await user.click(screen.getByRole('tab', { name: /customer receipts/i }));
        await waitFor(() => expect(window.location.search).toBe('?tab=customer'));

        const panel = screen.getByText('Customer Receipts').closest('div[class*="space-y-6"]');
        expect(panel).not.toBeNull();
        expect(within(panel as HTMLElement).getByText(/received:/i)).toBeInTheDocument();
    });
});
