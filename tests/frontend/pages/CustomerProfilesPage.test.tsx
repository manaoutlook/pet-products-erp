import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CustomerProfilesPage from '@/pages/CustomerProfilesPage';

// Permissions are not under test here - always allow read, deny the rest.
vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => ({
        hasPermission: (_module: string, action: string) => action === 'read',
        getModulePermissions: () => null,
        getAllowedModules: () => [],
    }),
}));

// Avoid rendering the real toast provider
vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

const customerProfiles = [
    {
        id: 1,
        mobileNumber: '+84913456789',
        companyName: 'Creative Minds Store',
        contactPerson: 'Tran Van Minh',
        email: 'minh@creativeminds.example',
        address: '12 Le Loi, District 1',
        photo: null,
        landLineNumber: null,
        customerType: 'B2B',
    },
    {
        id: 2,
        mobileNumber: '+84912345678',
        companyName: null,
        contactPerson: 'Nguyen Thi Mai',
        email: 'mai@example.com',
        address: '99 Hai Ba Trung, District 3',
        photo: null,
        landLineNumber: null,
        customerType: 'B2C',
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
            <CustomerProfilesPage />
        </QueryClientProvider>
    );
}

describe('CustomerProfilesPage - company name and contact person', () => {
    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        vi.stubGlobal('fetch', vi.fn(() => jsonResponse(customerProfiles)));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('shows a company name column next to the customer/contact one', async () => {
        renderPage();

        const company = await screen.findByText('Creative Minds Store');
        expect(screen.getByRole('button', { name: /^Company Name:/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^Customer\/Contact:/ })).toBeTruthy();
        // The panel says "Name" nowhere any more.
        expect(screen.queryByRole('button', { name: /^Name:/ })).toBeNull();

        const row = company.closest('tr') as HTMLTableRowElement;
        expect(within(row).getByText('Tran Van Minh')).toBeTruthy();
        expect(within(row).getByText('+84913456789')).toBeTruthy();
    });

    it('leaves the company cell empty for a walk-in consumer', async () => {
        renderPage();

        const contact = await screen.findByText('Nguyen Thi Mai');
        const row = contact.closest('tr') as HTMLTableRowElement;

        // The company cell falls back to a dash, not "null" or an empty string.
        const cells = within(row).getAllByRole('cell');
        expect(cells[0].textContent).toBe('-');
    });

    it('finds a customer by company name in the page search', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Creative Minds Store');

        await user.type(screen.getByPlaceholderText('Search customers...'), 'canvas');

        expect(screen.queryByText('Creative Minds Store')).toBeNull();
        expect(screen.queryByText('Nguyen Thi Mai')).toBeNull();

        await user.clear(screen.getByPlaceholderText('Search customers...'));
        await user.type(screen.getByPlaceholderText('Search customers...'), 'minds');

        expect(screen.getByText('Creative Minds Store')).toBeTruthy();
        expect(screen.queryByText('Nguyen Thi Mai')).toBeNull();
    });
});
