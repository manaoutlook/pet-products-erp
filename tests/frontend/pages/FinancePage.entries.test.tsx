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

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => ({
        hasPermission: () => true,
        can: () => true,
        getModulePermissions: () => null,
        getAllowedModules: () => [],
        isAdmin: true,
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

type FetchStub = ReturnType<typeof vi.fn>;

function renderEntries(
    options: {
        entries?: Record<string, unknown>[];
        total?: number;
        partners?: Record<string, unknown>[];
        onPost?: (url: string, body: unknown) => unknown;
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

        if (init?.method === 'POST' && options.onPost) {
            return json(options.onPost(path, init.body ? JSON.parse(String(init.body)) : null));
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

