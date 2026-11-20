import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DeliveryNoteFormDialog } from '@/components/SalesOrders/DeliveryNoteFormDialog';

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

/**
 * Delivery notes are raised from a sales order and printed immediately.
 *
 * The first print and a later reprint from the Delivery Notes screen must be the same sheet:
 * the customer block and the VAT company letterhead are snapshotted onto the note by the API,
 * so the screen has to print that snapshot - not the shop's Company Profile - the moment the
 * note is issued.
 */
const SHOP_COMPANY = {
    companyName: 'Smart ERP Test Shop',
    registeredAddress: '1 Shop Street',
    deliveryAddress: '1 Shop Street',
    taxId: '0100000000',
};

const VAT_ORDER = {
    id: 7,
    orderNumber: 'SO-20261119-1407',
    customerName: 'Star Stationery',
    status: 'open',
    orderDate: '2026-11-19T00:00:00.000Z',
    companyName: 'Star Stationery',
    contactPerson: 'Do Thi Mai',
    phone: '+84920123456',
    deliveryAddress: '369 Nguyen Thien Thuat, District 3',
    vatCompanyCode: 'CI',
    vatCompanyName: 'Conqueror International',
    vatCompanyTaxId: '0312362838',
    vatCompanyAddress: '1073/63B Duong Cach Mang Thang Tam, HCMC',
    items: [
        {
            id: 1,
            productCode: '112233445566',
            description: 'testProduct',
            quantity: 7,
            deliveredQuantity: 0,
        },
    ],
};

function renderDialog() {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
            const body =
                url.startsWith('/api/delivery-notes') && init?.method === 'POST'
                    ? {
                          message: 'Delivery note DN-20261119-1995 issued',
                          deliveryNote: {
                              deliveryNoteNumber: 'DN-20261119-1995',
                              deliveryDate: '2026-11-19T00:00:00.000Z',
                              customerName: 'Star Stationery',
                              companyName: 'Star Stationery',
                              contactPerson: 'Do Thi Mai',
                              phone: '+84920123456',
                              deliveryAddress: '369 Nguyen Thien Thuat, District 3',
                              vatCompanyCode: 'CI',
                              vatCompanyName: 'Conqueror International',
                              vatCompanyTaxId: '0312362838',
                              vatCompanyAddress: '1073/63B Duong Cach Mang Thang Tam, HCMC',
                          },
                      }
                    : url.startsWith('/api/sales-orders')
                      ? [VAT_ORDER]
                      : [];

            return {
                ok: true,
                status: 200,
                json: async () => body,
                text: async () => JSON.stringify(body),
            };
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
            <DeliveryNoteFormDialog
                open
                onOpenChange={() => undefined}
                initialSalesOrderId={VAT_ORDER.id}
                company={SHOP_COMPANY}
            />
        </QueryClientProvider>
    );
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('DeliveryNoteFormDialog', () => {
    it('prints the issued note under the VAT company snapshot, not the shop letterhead', async () => {
        const written: string[] = [];
        vi.spyOn(window, 'open').mockReturnValue({
            document: {
                write: (html: string) => written.push(html),
                close: () => undefined,
            },
            print: () => undefined,
        } as unknown as Window);

        renderDialog();

        const user = userEvent.setup();
        await user.click(await screen.findByRole('button', { name: /issue delivery note/i }));

        expect(await screen.findByText(/DN-20261119-1995 issued successfully/i)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /print delivery note/i }));

        await waitFor(() => expect(written).toHaveLength(1));
        const sheet = written[0];

        // The issuer is the VAT company whose paperwork the order carries.
        expect(sheet).toContain('Conqueror International');
        expect(sheet).toContain('0312362838');
        expect(sheet).not.toContain('Smart ERP Test Shop');

        // The customer block the note was issued with is on the same sheet.
        expect(sheet).toContain('Star Stationery');
        expect(sheet).toContain('Do Thi Mai');
        expect(sheet).toContain('+84920123456');
        expect(sheet).toContain('369 Nguyen Thien Thuat, District 3');
    });
});
