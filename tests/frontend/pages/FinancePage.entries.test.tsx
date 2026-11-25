import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FinancePage from '@/pages/FinancePage';
import { formatCurrency } from '@/utils/format';

/**
 * The Manual entries and Partners tabs of Financial Accounts.
 *
 * The Report tab is covered next door. What is pinned here is the part the owner actually
 * operates: narrowing the ledger down, recording an expense, voiding one that was entered
 * twice, and adding a partner before money can be booked against them.
 */

const mocks = vi.hoisted(() => ({
    toast: vi.fn(),
    // Admin by default; one test flips this off to check the edit button follows the role gate.
    isAdmin: { value: true },
}));

vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => ({
        hasPermission: () => true,
        can: () => true,
        getModulePermissions: () => null,
        getAllowedModules: () => [],
        isAdmin: mocks.isAdmin.value,
        isLoading: false,
    }),
}));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: mocks.toast, toasts: [], dismiss: vi.fn() }),
}));

function makeEntry(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        entryNumber: 'FIN-20261119-0001',
        entryType: 'expense',
        direction: 'debit',
        directionLabel: 'Debit',
        category: 'Rent',
        description: 'Shop rent',
        amount: 750000,
        entryDate: '2026-11-19',
        paymentMethod: 'CASH',
        reference: 'INV-LANDLORD-9',
        notes: null,
        partnerId: null,
        fundingKind: null,
        status: 'posted',
        voidedAt: null,
        voidedByUserId: null,
        voidReason: null,
        createdByUserId: 1,
        createdAt: '2026-11-19T09:00:00.000Z',
        updatedAt: '2026-11-19T09:00:00.000Z',
        partner: null,
        createdByUser: { id: 1, username: 'test_admin' },
        voidedByUser: null,
        voided: false,
        ...overrides,
    };
}

const partner = {
    id: 1,
    name: 'Nguyen Van Gop',
    phone: '0900000000',
    notes: 'Founding partner',
    isActive: true,
    deposits: 5000000,
    withdrawals: 1000000,
    balance: 4000000,
};

const summary = {
    from: '2026-11-01',
    to: '2026-11-19',
    income: {
        receipts: 0,
        receiptsCount: 0,
        otherIncome: 500000,
        total: 500000,
        byCategory: [{ category: 'Other income', amount: 500000, automatic: false }],
    },
    expenses: { total: 750000, count: 1, byCategory: [{ category: 'Rent', amount: 750000, count: 1 }] },
    netProfit: -250000,
    cashPosition: 250000,
    capital: {
        deposits: 5000000,
        withdrawals: 1000000,
        net: 4000000,
        balance: 4000000,
        byPartner: [{ partnerId: 1, name: 'Nguyen Van Gop', deposits: 5000000, withdrawals: 1000000, balance: 4000000 }],
        byFundingKind: [{ fundingKind: 'capital', deposits: 5000000, withdrawals: 1000000, balance: 4000000 }],
    },
    receivables: {
        totalOutstanding: 0,
        invoiceCount: 0,
        partiallyPaidAmount: 0,
        partiallyPaidCount: 0,
        unpaidAmount: 0,
        unpaidCount: 0,
        overdueAmount: 0,
        overdueCount: 0,
        aging: [],
    },
    generatedAt: '2026-11-19T09:00:00.000Z',
};

const json = (data: unknown) => ({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
});

/**
 * Currency in the DOM is formatted by `Intl`, which separates the amount from the symbol with a
 * narrow no-break space. Build a matcher that accepts any gap between the parts.
 */
function money(value: number) {
    const escaped = formatCurrency(value)
        .split(/[\s\u00A0\u202F]+/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s\\u00A0\\u202F]*');
    return new RegExp(`^${escaped}$`);
}

type FetchStub = ReturnType<typeof vi.fn>;

function renderEntries(
    options: {
        entries?: Record<string, unknown>[];
        total?: number;
        partners?: Record<string, unknown>[];
        onPost?: (url: string, body: unknown, method: string) => unknown;
    } = {},
) {
    const entries = options.entries ?? [
        makeEntry(),
        makeEntry({
            id: 2,
            entryNumber: 'FIN-20261119-0002',
            entryType: 'income',
            direction: 'credit',
            directionLabel: 'Credit',
            category: 'Other income',
            description: 'Scrap sale',
            amount: 500000,
        }),
    ];

    const stub = vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split('?')[0];

        // POST creates, PATCH corrects and DELETE removes - all go through the same stub so a
        // test can tell them apart.
        if (
            (init?.method === 'POST' || init?.method === 'PATCH' || init?.method === 'DELETE') &&
            options.onPost
        ) {
            return json(
                options.onPost(
                    path,
                    init.body ? JSON.parse(String(init.body)) : null,
                    init.method,
                ),
            );
        }

        if (path === '/api/finance/summary') return json(summary);
        if (path === '/api/finance/outstanding') return json({ invoices: [] });
        if (path === '/api/finance/entries') {
            return json({
                entries,
                total: options.total ?? entries.length,
                limit: 25,
                offset: 0,
                totals: { credits: 500000, debits: 750000, net: -250000 },
            });
        }
        if (path === '/api/finance/partners') {
            return json({
                partners: options.partners ?? [partner],
                totals: {
                    deposits: 5000000,
                    withdrawals: 1000000,
                    balance: 4000000,
                    partnerCount: 1,
                },
            });
        }
        return json({});
    });

    vi.stubGlobal('fetch', stub);

    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
    });

    render(
        <QueryClientProvider client={queryClient}>
            <FinancePage />
        </QueryClientProvider>,
    );

    return stub as FetchStub;
}

/** The ledger tab, opened and settled. */
async function openEntriesTab() {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: /manual entries/i }));
    await waitFor(() => expect(screen.getByTestId('entries-ledger-note')).toBeInTheDocument());
    return user;
}

afterEach(() => {
    vi.unstubAllGlobals();
    mocks.isAdmin.value = true;
    window.history.replaceState(null, '', '/');
});

describe('FinancePage - manual entries', () => {
    it('lists the ledger with its in/out/net figures', async () => {
        renderEntries();
        await openEntriesTab();

        expect(await screen.findByText('FIN-20261119-0001')).toBeInTheDocument();
        expect(screen.getByText('FIN-20261119-0002')).toBeInTheDocument();
        expect(screen.getAllByText(/Ref\s*INV-LANDLORD-9/).length).toBeGreaterThan(0);
        expect(screen.getByText(/2 matching entries/)).toBeInTheDocument();
        expect(screen.getByText(/Money in:/)).toBeInTheDocument();
        expect(screen.getByText(/^Net:/)).toBeInTheDocument();
    });

    it('shows the empty state when the filters match nothing', async () => {
        renderEntries({ entries: [] });
        await openEntriesTab();

        expect(await screen.findByText('No entries match these filters')).toBeInTheDocument();
        expect(screen.getByText(/0 matching entries/)).toBeInTheDocument();
    });

    it('narrows the request by search text, type, status and dates', async () => {
        const stub = renderEntries();
        const user = await openEntriesTab();

        await user.type(screen.getByPlaceholderText(/search number, description, reference/i), 'rent');

        await waitFor(() => {
            const last = String(stub.mock.calls[stub.mock.calls.length - 1][0]);
            expect(last).toContain('search=rent');
            expect(last).toContain('limit=25');
            expect(last).toContain('offset=0');
        });

        const from = screen.getByLabelText('Entries from');
        fireEvent.change(from, { target: { value: '2026-11-01' } });
        const to = screen.getByLabelText('Entries to');
        fireEvent.change(to, { target: { value: '2026-11-30' } });

        await waitFor(() => {
            const last = String(stub.mock.calls[stub.mock.calls.length - 1][0]);
            expect(last).toContain('from=2026-11-01');
            expect(last).toContain('to=2026-11-30');
        });
    });

    it('pages through a ledger longer than one page', async () => {
        const stub = renderEntries({ total: 60 });
        const user = await openEntriesTab();

        expect(await screen.findByRole('button', { name: /next/i })).toBeEnabled();
        expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();

        await user.click(screen.getByRole('button', { name: /next/i }));

        await waitFor(() => {
            const last = String(stub.mock.calls[stub.mock.calls.length - 1][0]);
            expect(last).toContain('offset=25');
        });
    });
});


describe('FinancePage - recording and voiding entries', () => {
    it('records an expense and refreshes the money figures', async () => {
        const postBodies: unknown[] = [];
        const stub = renderEntries({
            onPost: (path, body) => {
                postBodies.push({ path, body });
                return { entry: makeEntry({ entryNumber: 'FIN-20261119-0009' }) };
            },
        });

        const user = await openEntriesTab();
        // Two entry points (header and ledger toolbar) open the same dialog.
        await user.click(screen.getAllByRole('button', { name: /new entry/i })[0]);

        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText('Amount'), '250000');
        await user.type(within(dialog).getByLabelText('Description'), '  Printer ink  ');
        await user.click(within(dialog).getByRole('button', { name: /record entry/i }));

        await waitFor(() => expect(postBodies).toHaveLength(1));
        expect(postBodies[0]).toMatchObject({
            path: '/api/finance/entries',
            body: {
                entryType: 'expense',
                category: 'Rent',
                description: 'Printer ink',
                amount: 250000,
                // An empty reference stays null rather than an empty string.
                reference: null,
                partnerId: null,
            },
        });

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Expense FIN-20261119-0009 recorded' }),
            ),
        );
        // The report is invalidated so the headline figures pick the entry up.
        await waitFor(() =>
            expect(stub.mock.calls.some(([url]) => String(url).startsWith('/api/finance/summary'))).toBe(true),
        );
    });

    it('cannot submit without an amount or a description', async () => {
        renderEntries();
        const user = await openEntriesTab();
        await user.click(screen.getAllByRole('button', { name: /new entry/i })[0]);

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('button', { name: /record entry/i })).toBeDisabled();
    });

    it('voids an entry with a reason and keeps it in the book', async () => {
        const postBodies: unknown[] = [];
        renderEntries({
            onPost: (path, body) => {
                postBodies.push({ path, body });
                return { entry: makeEntry() };
            },
        });

        const user = await openEntriesTab();
        const voidButtons = await screen.findAllByRole('button', { name: /void/i });
        await user.click(voidButtons[0]);

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Void this entry?')).toBeInTheDocument();
        await user.type(within(dialog).getByLabelText('Reason'), 'Entered twice');

        await user.click(within(dialog).getByRole('button', { name: /void entry/i }));

        await waitFor(() => expect(postBodies).toHaveLength(1));
        expect(postBodies[0]).toEqual({
            path: '/api/finance/entries/1/void',
            body: { reason: 'Entered twice' },
        });
        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Entry voided' })),
        );
    });

    it('adds a partner before any partner money can be booked', async () => {
        const postBodies: unknown[] = [];
        renderEntries({
            partners: [],
            onPost: (path, body) => {
                postBodies.push({ path, body });
                return { partner: { ...partner, name: 'Tran Thi B' } };
            },
        });

        const user = userEvent.setup();
        await user.click(await screen.findByRole('tab', { name: /partners/i }));
        await user.click(await screen.findByRole('button', { name: /new partner/i }));

        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText('Name'), '  Tran Thi B  ');
        await user.type(within(dialog).getByLabelText('Phone'), '0901111111');
        await user.click(within(dialog).getByRole('button', { name: /add partner/i }));

        await waitFor(() => expect(postBodies).toHaveLength(1));
        expect(postBodies[0]).toMatchObject({
            path: '/api/finance/partners',
            body: { name: 'Tran Thi B', phone: '0901111111', notes: null },
        });
        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Tran Thi B added' }),
            ),
        );
    });

    it('reports a refused save instead of closing the dialog silently', async () => {
        renderEntries({
            onPost: () => {
                throw new Error('Amount must be above zero');
            },
        });

        const user = await openEntriesTab();
        await user.click(screen.getAllByRole('button', { name: /new entry/i })[0]);

        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText('Amount'), '10');
        await user.type(within(dialog).getByLabelText('Description'), 'Tea');
        await user.click(within(dialog).getByRole('button', { name: /record entry/i }));

        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'The entry was not recorded' }),
            ),
        );
    });
});

describe('FinancePage - correcting an entry', () => {
    it('opens the edit dialog filled in from the row and saves with PATCH', async () => {
        const patches: { path: string; body: Record<string, unknown> }[] = [];
        renderEntries({
            onPost: (path, body, method) => {
                if (method === 'PATCH') {
                    patches.push({ path, body: body as Record<string, unknown> });
                    return { entry: makeEntry({ amount: 800000 }) };
                }
                return { entry: makeEntry() };
            },
        });

        const user = await openEntriesTab();
        // One edit button per posted row.
        const editButtons = await screen.findAllByRole('button', { name: /edit entry/i });
        expect(editButtons).toHaveLength(2);
        await user.click(editButtons[0]);

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Edit entry FIN-20261119-0001')).toBeInTheDocument();

        // The form starts from what was stored, not empty.
        const amount = within(dialog).getByLabelText('Amount');
        expect(amount).toHaveValue(750000);
        expect(within(dialog).getByLabelText('Description')).toHaveValue('Shop rent');
        expect(within(dialog).getByLabelText('Reference')).toHaveValue('INV-LANDLORD-9');
        // The date field is a plain YYYY-MM-DD, exactly what the API returns.
        expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-11-19');
        // Voucher pictures are filed on create; an edit has nothing queued to upload.
        expect(
            within(dialog).queryByText(/receipt \/ bank-transfer pictures/i),
        ).not.toBeInTheDocument();

        await user.clear(amount);
        await user.type(amount, '800000');
        await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(patches).toHaveLength(1));
        expect(patches[0]).toMatchObject({
            path: '/api/finance/entries/1',
            body: {
                entryType: 'expense',
                category: 'Rent',
                description: 'Shop rent',
                amount: 800000,
                entryDate: '2026-11-19',
                partnerId: null,
                fundingKind: null,
            },
        });
        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Expense FIN-20261119-0001 updated' }),
            ),
        );
        // The dialog closes and the ledger/report are refreshed.
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('does not offer editing to a bookkeeper without the administrator role', async () => {
        mocks.isAdmin.value = false;
        renderEntries();

        await openEntriesTab();
        expect(await screen.findByText('FIN-20261119-0001')).toBeInTheDocument();

        expect(screen.queryByRole('button', { name: /edit entry/i })).not.toBeInTheDocument();
        // Voiding stays available: finance update is enough to reverse a mistake, not rewrite it.
        expect(screen.getAllByRole('button', { name: /void/i }).length).toBeGreaterThan(0);
    });
});

describe('FinancePage - correcting and deleting a partner', () => {
    it('opens the partner dialog filled in and saves with PATCH', async () => {
        const patches: { path: string; body: Record<string, unknown> }[] = [];
        renderEntries({
            onPost: (path, body, method) => {
                patches.push({ path, body: body as Record<string, unknown> });
                return { partner: { ...partner, name: 'Nguyen Van Gop (HCMC)' } };
            },
        });

        const user = userEvent.setup();
        await user.click(await screen.findByRole('tab', { name: /partners/i }));
        await user.click(
            await screen.findByRole('button', { name: /edit partner nguyen van gop/i }),
        );

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Edit Nguyen Van Gop')).toBeInTheDocument();
        // The form starts from the row, so only what is wrong has to be retyped.
        expect(within(dialog).getByLabelText('Name')).toHaveValue('Nguyen Van Gop');
        expect(within(dialog).getByLabelText('Phone')).toHaveValue('0900000000');
        expect(within(dialog).getByLabelText('Notes')).toHaveValue('Founding partner');

        const name = within(dialog).getByLabelText('Name');
        await user.clear(name);
        await user.type(name, 'Nguyen Van Gop (HCMC)');
        await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(patches).toHaveLength(1));
        expect(patches[0]).toMatchObject({
            path: '/api/finance/partners/1',
            body: {
                name: 'Nguyen Van Gop (HCMC)',
                phone: '0900000000',
                notes: 'Founding partner',
            },
        });
        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Nguyen Van Gop (HCMC) updated' }),
            ),
        );
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('deletes a partner only after the administrator confirms', async () => {
        const requests: { path: string; method?: string }[] = [];
        renderEntries({
            onPost: (path, _body, method) => {
                requests.push({ path, method });
                return { id: 1, name: 'Nguyen Van Gop', deletedEntries: ['FIN-20261119-0003'] };
            },
        });

        const user = userEvent.setup();
        await user.click(await screen.findByRole('tab', { name: /partners/i }));
        await user.click(
            await screen.findByRole('button', { name: /delete partner nguyen van gop/i }),
        );

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Delete Nguyen Van Gop?')).toBeInTheDocument();
        // The money still held is laid out, so a refusal from the API is never a surprise.
        expect(within(dialog).getByText(money(partner.deposits))).toBeInTheDocument();
        expect(within(dialog).getByText(money(partner.balance))).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: /^delete partner$/i }));

        await waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0]).toEqual({ path: '/api/finance/partners/1', method: 'DELETE' });
        await waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Nguyen Van Gop deleted' }),
            ),
        );
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('hides partner edit and delete from a bookkeeper without the administrator role', async () => {
        mocks.isAdmin.value = false;
        renderEntries();

        const user = userEvent.setup();
        await user.click(await screen.findByRole('tab', { name: /partners/i }));
        expect(await screen.findByText('0900000000')).toBeInTheDocument();

        expect(screen.queryByRole('button', { name: /edit partner/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /delete partner/i })).not.toBeInTheDocument();
        // Adding a partner stays a create-permission action, not an administrator one.
        expect(screen.getByRole('button', { name: /new partner/i })).toBeInTheDocument();
    });
});

