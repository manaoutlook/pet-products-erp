import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateCustomerProfileDialog } from '@/components/CustomerProfiles/CreateCustomerProfileDialog';
import { EditCustomerProfileDialog } from '@/components/CustomerProfiles/EditCustomerProfileDialog';

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

const b2bProfile = {
    id: 7,
    mobileNumber: '+84913456789',
    companyName: 'Creative Minds Store',
    contactPerson: 'Tran Van Minh',
    email: 'minh@creativeminds.example',
    address: '12 Le Loi, District 1',
    photo: undefined,
    landLineNumber: null,
    customerType: 'B2B' as const,
};

function jsonResponse(data: unknown) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => JSON.stringify(data),
    } as Response);
}

function wrap(children: ReactNode) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

/** Labels in DOM order - the field order the cashier actually sees. */
function labelOrder(dialog: HTMLElement) {
    return Array.from(dialog.querySelectorAll('label')).map((label) => label.textContent);
}

describe('Customer profile dialogs - customer type drives the company name', () => {
    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ id: 1 })));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('asks for the customer type first and hides the company name until B2B', async () => {
        const user = userEvent.setup();
        wrap(<CreateCustomerProfileDialog />);

        await user.click(screen.getByRole('button', { name: /add customer profile/i }));
        const dialog = await screen.findByRole('dialog');

        expect(labelOrder(dialog)[0]).toBe('Customer Type');
        // Nothing is selected yet, so a company name would be asking about a type we do not know.
        expect(within(dialog).queryByText('Company Name (Optional)')).toBeNull();

        await user.click(within(dialog).getByRole('combobox'));
        await user.click(await screen.findByRole('option', { name: 'B2C - Consumer' }));
        expect(within(dialog).queryByText('Company Name (Optional)')).toBeNull();

        await user.click(within(dialog).getByRole('combobox'));
        await user.click(await screen.findByRole('option', { name: 'B2B - Business' }));
        expect(within(dialog).getByText('Company Name (Optional)')).toBeTruthy();
    });

    it('sends no company name when a consumer is created', async () => {
        const user = userEvent.setup();
        wrap(<CreateCustomerProfileDialog />);

        await user.click(screen.getByRole('button', { name: /add customer profile/i }));
        const dialog = await screen.findByRole('dialog');

        await user.click(within(dialog).getByRole('combobox'));
        await user.click(await screen.findByRole('option', { name: 'B2C - Consumer' }));

        await user.type(within(dialog).getByLabelText('Mobile Number'), '0912345678');
        await user.type(within(dialog).getByLabelText('Contact Person'), 'Nguyen Thi Mai');
        await user.type(within(dialog).getByLabelText('Email'), 'mai@example.com');
        await user.type(within(dialog).getByLabelText('Address'), '99 Hai Ba Trung, District 3');

        await user.click(within(dialog).getByRole('button', { name: /create customer profile/i }));

        await waitFor(() => {
            expect(vi.mocked(fetch)).toHaveBeenCalledWith(
                '/api/customer-profiles',
                expect.objectContaining({ method: 'POST' })
            );
        });

        const postCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST');
        const body = JSON.parse(postCall![1]!.body as string);
        expect(body.contactPerson).toBe('Nguyen Thi Mai');
        expect(body.customerType).toBe('B2C');
        expect(body.companyName).toBeNull();
    });

    it('keeps a business company name, and drops it when the account becomes a consumer', async () => {
        const user = userEvent.setup();
        const onOpenChange = vi.fn();
        wrap(<EditCustomerProfileDialog profile={b2bProfile} open onOpenChange={onOpenChange} />);

        const dialog = await screen.findByRole('dialog');

        expect(labelOrder(dialog)[0]).toBe('Customer Type');
        const companyInput = within(dialog).getByLabelText('Company Name (Optional)') as HTMLInputElement;
        expect(companyInput.value).toBe('Creative Minds Store');

        // Switching the account to a consumer hides the box, and nothing stale is sent with it.
        await user.click(within(dialog).getByRole('combobox'));
        await user.click(await screen.findByRole('option', { name: 'B2C - Consumer' }));
        expect(within(dialog).queryByText('Company Name (Optional)')).toBeNull();

        await user.click(within(dialog).getByRole('button', { name: /update customer profile/i }));

        await waitFor(() => {
            expect(vi.mocked(fetch)).toHaveBeenCalled();
        });

        const putCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT');
        expect(putCall![0]).toBe('/api/customer-profiles/7');
        const body = JSON.parse(putCall![1]!.body as string);
        expect(body.customerType).toBe('B2C');
        expect(body.companyName).toBeNull();
    });
});
