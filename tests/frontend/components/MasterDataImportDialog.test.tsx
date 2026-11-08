import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MasterDataImportDialog } from '@/components/master-data/MasterDataImportDialog';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

type FetchCall = { url: string; method: string; body: any };

const SUPPLIER_CSV = [
    'Supplier Name,Contact Information,Address',
    'Acme Trading,0901234567,"12 Nguyen Hue, HCMC"',
    'Saigon Traders,0909876543,District 7',
].join('\n');

function createFetchMock(calls: FetchCall[]) {
    return vi.fn(async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        const method = (init?.method ?? 'GET').toUpperCase();

        let body: any = undefined;
        if (typeof init?.body === 'string') body = JSON.parse(init.body);
        calls.push({ url, method, body });

        const data = {
            message: 'Import finished: 2 created',
            total: 2,
            created: 2,
            updated: 0,
            skipped: 0,
            createdParents: 0,
            errors: [],
        };

        return {
            ok: true,
            status: 200,
            json: async () => data,
            text: async () => JSON.stringify(data),
        } as Response;
    });
}

describe('MasterDataImportDialog', () => {
    let calls: FetchCall[];

    beforeEach(() => {
        calls = [];
        toastMock.mockClear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('previews the file and posts the rows to the suppliers import endpoint', async () => {
        vi.stubGlobal('fetch', createFetchMock(calls));

        const user = userEvent.setup();
        render(
            <MasterDataImportDialog kind="suppliers" open onOpenChange={() => {}} />
        );

        const input = screen.getByLabelText('supplier spreadsheet file');
        await user.upload(input, new File([SUPPLIER_CSV], 'suppliers.csv', { type: 'text/csv' }));

        expect(await screen.findByText('2 suppliers found')).toBeTruthy();
        expect(screen.getByText('Acme Trading')).toBeTruthy();
        expect(screen.getByText('Saigon Traders')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: /import 2 suppliers/i }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].url).toBe('/api/suppliers/import');
        expect(calls[0].method).toBe('POST');
        expect(calls[0].body.updateExisting).toBe(true);
        expect(calls[0].body.rows).toHaveLength(2);
        expect(calls[0].body.rows[0]).toMatchObject({
            name: 'Acme Trading',
            contactInfo: '0901234567',
            address: '12 Nguyen Hue, HCMC',
        });

        expect(await screen.findByText('Import finished: 2 created')).toBeTruthy();
        expect(toastMock).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Import finished' })
        );
    });

    it('reports the missing required supplier columns instead of importing', async () => {
        vi.stubGlobal('fetch', createFetchMock(calls));

        const user = userEvent.setup();
        render(
            <MasterDataImportDialog kind="suppliers" open onOpenChange={() => {}} />
        );

        await user.upload(
            screen.getByLabelText('supplier spreadsheet file'),
            new File(['Supplier Name\nAcme Trading'], 'suppliers.csv', { type: 'text/csv' })
        );

        expect(
            await screen.findByText(/Missing required columns: Contact Information, Address/i)
        ).toBeTruthy();
        expect(calls).toHaveLength(0);
    });

    it('shows the required columns of the selected screen', () => {
        vi.stubGlobal('fetch', createFetchMock(calls));

        render(<MasterDataImportDialog kind="brands" open onOpenChange={() => {}} />);

        expect(screen.getByText('Import Brands')).toBeTruthy();
        expect(
            screen.getByText(/Required columns: Brand Name\. Optional: Description\./i)
        ).toBeTruthy();
    });
});
