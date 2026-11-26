import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FinancePage from '@/pages/FinancePage';
import { formatCurrency } from '@/utils/format';

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
  useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

/**
 * Currency in the DOM is formatted by `Intl`, which separates the amount from the currency symbol
 * with a narrow no-break space. Build a matcher that accepts any gap between the parts.
 */
function money(value: number, options: { exact?: boolean } = {}) {
  const { exact = true } = options;
  const escaped = formatCurrency(value)
    .split(/[\s\u00A0\u202F]+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\u00A0\\u202F]*');
  return new RegExp(exact ? `^${escaped}$` : escaped);
}

/**
 * Financial Accounts screen - the owner's money page.
 *
 * The report is the only place invoice receipts and hand-typed entries meet, so these tests pin
 * what the owner reads off it: the four headline figures, the partially paid callout (money that
 * is half-collected must not look like "not paid at all"), the ledger with its voided rows, and
 * the partner balances that deposits/withdrawals are checked against.
 */
function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    from: '2026-11-01',
    to: '2026-11-19',
    income: {
      receipts: 100000,
      receiptsCount: 1,
      otherIncome: 500000,
      total: 600000,
      byCategory: [
        { category: 'Customer receipts', amount: 100000, automatic: true },
        { category: 'Other income', amount: 500000, automatic: false },
      ],
    },
    expenses: {
      total: 750000,
      count: 1,
      byCategory: [{ category: 'Rent', amount: 750000, count: 1 }],
    },
    purchases: {
      total: 15000000,
      count: 1,
      recordedTotal: 15000000,
      unrecordedCount: 0,
      rows: [
        {
          id: 1,
          orderNumber: 'PO-20261110-0001',
          orderDate: '2026-11-10T00:00:00.000Z',
          status: 'pending',
          supplier: 'Langwei Technology Co., Ltd.',
          amount: 15000000,
          expense: { entryNumber: 'FIN-20261110-0001', status: 'posted' },
        },
      ],
    },
    netProfit: -150000,
    cashPosition: 650000,
    cashOnHand: {
      asOf: '2026-11-19',
      total: 4600000,
      moneyIn: 5800000,
      moneyOut: 1200000,
      openingBalance: 1000000,
      byMethod: [
        { method: 'CASH', label: 'Cash', moneyIn: 5500000, moneyOut: 1200000, balance: 4300000 },
        {
          method: 'BANK_TRANSFER',
          label: 'Bank transfer',
          moneyIn: 300000,
          moneyOut: 0,
          balance: 300000,
        },
      ],
    },
    capital: {
      deposits: 5000000,
      withdrawals: 1000000,
      net: 4000000,
      balance: 4000000,
      byPartner: [
        { partnerId: 1, name: 'Nguyen Van Gop', deposits: 5000000, withdrawals: 1000000, balance: 4000000 },
      ],
      byFundingKind: [
        { fundingKind: 'capital', deposits: 5000000, withdrawals: 1000000, balance: 4000000 },
      ],
      period: { deposits: 5000000, withdrawals: 1000000, net: 4000000 },
    },
    receivables: {
      totalOutstanding: 220000,
      invoiceCount: 2,
      partiallyPaidAmount: 120000,
      partiallyPaidCount: 1,
      unpaidAmount: 100000,
      unpaidCount: 1,
      overdueAmount: 100000,
      overdueCount: 1,
      aging: [
        { key: 'current', label: 'Not due yet', amount: 120000, count: 1 },
        { key: '1_30', label: '1-30 days overdue', amount: 100000, count: 1 },
      ],
    },
    generatedAt: '2026-11-19T09:00:00.000Z',
    ...overrides,
  };
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    invoiceNumber: 'INV-20261108-0001',
    buyerName: 'Beta Buyer Co.',
    status: 'partially_paid',
    issuedAt: '2026-11-08T00:00:00.000Z',
    dueDate: '2026-11-22T00:00:00.000Z',
    totalAmount: 220000,
    amountPaid: 100000,
    balanceDue: 120000,
    daysPastDue: 0,
    statusLabel: 'Partially paid',
    agingBucket: 'current',
    store: { id: 1, name: 'Test Store 1' },
    ...overrides,
  };
}

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


function renderPage(
  data: {
    summary?: Record<string, unknown>;
    invoices?: Record<string, unknown>[];
    entries?: { entries: Record<string, unknown>[]; total?: number; totals?: Record<string, number> };
    partners?: Record<string, unknown>[];
  } = {}
) {
  const summary = data.summary ?? makeSummary();
  const invoices = data.invoices ?? [makeInvoice()];
  const entryRows = data.entries?.entries ?? [
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
  const entriesBody = {
    entries: entryRows,
    total: data.entries?.total ?? entryRows.length,
    limit: 25,
    offset: 0,
    totals: data.entries?.totals ?? { credits: 500000, debits: 750000, net: -250000 },
  };
  const partnerRows = data.partners ?? [
    {
      id: 1,
      name: 'Nguyen Van Gop',
      phone: '0900000000',
      notes: 'Founding partner',
      isActive: true,
      deposits: 5000000,
      withdrawals: 1000000,
      balance: 4000000,
    },
  ];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split('?')[0];
      const body =
        init?.method === 'POST' || init?.method === 'PATCH'
          ? { entry: entryRows[0], partner: partnerRows[0] }
          : path === '/api/finance/summary'
            ? summary
            : path === '/api/finance/outstanding'
              ? { invoices }
              : path === '/api/finance/entries'
                ? entriesBody
                : path === '/api/finance/partners'
                  ? {
                      partners: partnerRows,
                      totals: {
                        deposits: 5000000,
                        withdrawals: 1000000,
                        balance: 4000000,
                        partnerCount: partnerRows.length,
                      },
                    }
                  : {};

      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }) as unknown as typeof fetch
  );

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <FinancePage />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  // The drill-down test follows a link, which changes the address bar; start each test at the page.
  window.history.replaceState(null, '', '/');
});

describe('FinancePage', () => {
  it('shows the four headline figures and where the money came from', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Money in')).toBeInTheDocument());

    expect(screen.getByText('Money out')).toBeInTheDocument();
    expect(screen.getByText('Net profit')).toBeInTheDocument();
    expect(screen.getByText('Partner money held')).toBeInTheDocument();
    // The card is a balance, so its hint must say so - the range does not narrow it.
    expect(screen.getByText(/out · all time$/)).toBeInTheDocument();
    expect(screen.getAllByText(/does not narrow it/).length).toBeGreaterThan(0);

    // Receipts and hand-typed income are added for the headline, but still shown apart.
    expect(screen.getAllByText(money(600000)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(money(750000)).length).toBeGreaterThan(0);
    expect(screen.getByText('Customer receipts')).toBeInTheDocument();
    expect(screen.getByText('from invoices')).toBeInTheDocument();
    expect(screen.getByText('Other income')).toBeInTheDocument();
    expect(screen.getByText('Total money in')).toBeInTheDocument();
    expect(screen.getByText('Total expenses')).toBeInTheDocument();
  });

  it('shows the money still on hand, split by how it was paid', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId('money-on-hand-card')).toBeInTheDocument());

    const card = screen.getByTestId('money-on-hand-card');
    // The headline is cash plus bank, and it is a balance: the dates above do not narrow it.
    expect(within(card).getByTestId('money-on-hand-total')).toHaveTextContent(money(4600000));
    expect(within(card).getByText(/does not narrow it/)).toBeInTheDocument();

    const cash = within(card).getByTestId('money-on-hand-cash');
    expect(within(cash).getByText('Cash')).toBeInTheDocument();
    expect(within(cash).getByText(money(4300000))).toBeInTheDocument();

    const bank = within(card).getByTestId('money-on-hand-bank_transfer');
    expect(within(bank).getByText('Bank transfer')).toBeInTheDocument();
    expect(within(bank).getByText(money(300000))).toBeInTheDocument();

    // Money the shop already had when the books opened is named, so the balance is not read as
    // profit earned since.
    const opening = within(card).getByTestId('money-on-hand-opening');
    expect(opening).toHaveTextContent(/opening balance/i);
    // The figure is Intl-formatted (its own spacing), so compare on the digits alone.
    expect((opening.textContent ?? '').replace(/[^\d]/g, '')).toContain('1000000');
  });

  it('calls out partially paid invoices instead of lumping them in with unpaid ones', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Money in')).toBeInTheDocument());

    const page = document.body.textContent ?? '';
    expect(page).toMatch(/1 invoices still owe part of\s+their total/);
    expect(page).toMatch(money(120000, { exact: false }));
    expect(page).toMatch(/Not paid at all/);
    expect(page).toMatch(money(100000, { exact: false }));
    // Overdue money is a separate figure, not hidden inside the outstanding total.
    expect(page).toMatch(/2 open invoices/);
    expect(page).toMatch(/overdue/);
  });

  it('highlights the partially paid row in the outstanding invoice table', async () => {
    renderPage({
      invoices: [
        makeInvoice(),
        makeInvoice({
          id: 2,
          invoiceNumber: 'INV-20261108-0002',
          buyerName: 'Alpha Buyer Co.',
          status: 'issued',
          statusLabel: 'Issued',
          amountPaid: 0,
          balanceDue: 220000,
        }),
      ],
    });

    await waitFor(() => expect(screen.getByText('INV-20261108-0001')).toBeInTheDocument());

    const partialRow = screen.getByText('INV-20261108-0001').closest('tr') as HTMLTableRowElement;
    const issuedRow = screen.getByText('INV-20261108-0002').closest('tr') as HTMLTableRowElement;

    expect(partialRow.className).toContain('bg-warning-subtle/60');
    expect(issuedRow.className).not.toContain('bg-warning-subtle/60');
    expect(within(partialRow).getByText('Partially paid')).toBeInTheDocument();
    // Paid-to-date and still-owed sit side by side so the shortfall is obvious.
    expect(within(partialRow).getByText(money(100000))).toBeInTheDocument();
    expect(within(partialRow).getByText(money(120000))).toBeInTheDocument();
  });

  it('keeps voided entries visible in the ledger but out of the totals', async () => {
    const user = userEvent.setup();
    renderPage({
      entries: {
        entries: [
          makeEntry(),
          makeEntry({
            id: 3,
            entryNumber: 'FIN-20261118-0003',
            entryType: 'expense',
            description: 'Duplicate rent entry',
            amount: 1000000,
            status: 'voided',
            voided: true,
            voidReason: 'Entered twice',
            voidedAt: '2026-11-18T10:00:00.000Z',
            voidedByUser: { id: 1, username: 'test_admin' },
          }),
        ],
      },
    });

    await waitFor(() => expect(screen.getByText('Money in')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /entries/i }));

    await waitFor(() => expect(screen.getByText('FIN-20261118-0003')).toBeInTheDocument());

    const voidedRow = screen.getByText('FIN-20261118-0003').closest('tr') as HTMLTableRowElement;
    expect(within(voidedRow).getByText('Voided')).toBeInTheDocument();
    expect(within(voidedRow).getByText('Entered twice')).toBeInTheDocument();
    // A voided entry is history: no Void button left to press.
    expect(within(voidedRow).queryByRole('button', { name: /void/i })).not.toBeInTheDocument();

    const postedRow = screen.getByText('FIN-20261119-0001').closest('tr') as HTMLTableRowElement;
    expect(within(postedRow).getByText('Posted')).toBeInTheDocument();
    expect(within(postedRow).getByRole('button', { name: /void/i })).toBeInTheDocument();

    // Totals come from the server's posted-only figures.
    const ledgerText = document.body.textContent ?? '';
    expect(ledgerText).toMatch(money(500000, { exact: false }));
    expect(ledgerText).toMatch(money(750000, { exact: false }));
  });

  it('asks for a partner only when the entry moves partner money', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('Money in')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /entries/i }));
    const newEntryButtons = await screen.findAllByRole('button', { name: /new entry/i });
    await user.click(newEntryButtons[newEntryButtons.length - 1]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Record an entry')).toBeInTheDocument();
    // Defaults to an expense: a category is needed, no partner involved.
    expect(within(dialog).getByLabelText('Category')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Partner')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /record entry/i })).toBeDisabled();
  });

  it('shows what each partner has left in the business', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('Money in')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /partners/i }));

    await waitFor(() => expect(screen.getByText('Nguyen Van Gop')).toBeInTheDocument());

    const row = screen.getByText('Nguyen Van Gop').closest('tr') as HTMLTableRowElement;
    expect(within(row).getByText(money(5000000))).toBeInTheDocument();
    expect(within(row).getByText(money(1000000))).toBeInTheDocument();
    expect(within(row).getByText(money(4000000))).toBeInTheDocument();
  });

  it('drills from the money-in figures to the register that holds the receipts', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Money in')).toBeInTheDocument());

    // The headline figure links to the customer-receipt register, not to a list of entries.
    expect(screen.getByTestId('money-in-receipts-link')).toHaveAttribute(
      'href',
      '/receipts?tab=customer'
    );
    expect(screen.getByTestId('money-in-receipts-link')).toHaveTextContent(
      /view customer receipts/i
    );

    // The automatic income row is a transaction the owner can open; hand-typed income is not.
    const receiptsRow = screen.getByTestId('income-receipts-link');
    expect(receiptsRow).toHaveAttribute('href', '/receipts?tab=customer');
    expect(within(receiptsRow).getByText('Customer receipts')).toBeInTheDocument();
    expect(within(receiptsRow).getByText('from invoices')).toBeInTheDocument();

    const otherIncome = screen.getByText('Other income');
    expect(otherIncome.closest('a')).toBeNull();
  });

  it('labels the ledger as manual and says where till sales are recorded', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('Money in')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /manual entries/i }));

    const note = await screen.findByTestId('entries-ledger-note');
    expect(note).toHaveTextContent(/manual/i);
    expect(note).toHaveTextContent(/receipted in Receivables/i);
    expect(note).toHaveTextContent(/counted twice/i);
    expect(
      within(note).getByRole('link', { name: /customer receipts register/i })
    ).toHaveAttribute('href', '/receipts?tab=customer');
  });

  it('drills from the money-out figure to the ledger already narrowed to expenses', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('Money out')).toBeInTheDocument());

    // Expense entries live on this same page, so the link carries the tab and the type filter.
    const link = screen.getByTestId('money-out-entries-link');
    expect(link).toHaveAttribute('href', '/finance?tab=entries&type=expense');
    expect(link).toHaveTextContent(/view expense entries/i);

    await user.click(link);

    // Following it must open the ledger instead of leaving the owner on the report.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /manual entries/i })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );
    expect(await screen.findByTestId('entries-ledger-note')).toBeInTheDocument();

    // The ledger asks the server for expenses only, so the rows match the figure that was clicked.
    const urls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url]) =>
      String(url)
    );
    expect(
      urls.some(
        (url) => url.includes('/api/finance/entries') && url.includes('entryType=expense')
      )
    ).toBe(true);
  });

  it('drills from net profit to the two totals it is subtracted from', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Net profit')).toBeInTheDocument());

    // Profit is derived, so the drill-down is the sum itself, not a register.
    const link = screen.getByTestId('net-profit-breakdown-link');
    expect(link).toHaveAttribute('href', '#profit-breakdown');
    expect(link).toHaveTextContent(/how it is worked out/i);

    const breakdown = document.getElementById('profit-breakdown');
    expect(breakdown).not.toBeNull();
    expect(within(breakdown as HTMLElement).getByText('Total money in')).toBeInTheDocument();
    expect(within(breakdown as HTMLElement).getByText('Total expenses')).toBeInTheDocument();
    // Both halves stay visible, so the figure can be checked by reading it off.
    expect(within(breakdown as HTMLElement).getAllByText(money(600000)).length).toBeGreaterThan(0);
    expect(within(breakdown as HTMLElement).getAllByText(money(750000)).length).toBeGreaterThan(0);
  });

  it('drills from partner money held to the partner balances', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('Partner money held')).toBeInTheDocument());

    const link = screen.getByTestId('partner-balances-link');
    expect(link).toHaveAttribute('href', '/finance?tab=partners');
    expect(link).toHaveTextContent(/view partner balances/i);

    await user.click(link);

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /partners/i })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );
    expect(await screen.findByText('Nguyen Van Gop')).toBeInTheDocument();
  });

  it('shows the purchase orders behind the Supplier purchases expense', async () => {
    renderPage();

    // Wait for the row, not just the card: the card exists while the report is still loading.
    await waitFor(() => expect(screen.getByTestId('purchase-row-1')).toBeInTheDocument());

    // The order is named by number and supplier, so the expense heading is traceable to a document.
    expect(screen.getByText('Purchases (purchase orders)')).toBeInTheDocument();
    expect(screen.getByText('PO-20261110-0001')).toBeInTheDocument();
    expect(screen.getByText('Langwei Technology Co., Ltd.')).toBeInTheDocument();

    // The entry the order posted is shown next to it, proving it is inside "Money out".
    expect(screen.getByText('FIN-20261110-0001')).toBeInTheDocument();
    expect(screen.getByText(/recorded as expenses/i)).toBeInTheDocument();
    expect(screen.getAllByText(money(15000000)).length).toBeGreaterThan(0);
    // No warning badge when every order has a posted expense.
    expect(screen.queryByText(/not in expenses/i)).not.toBeInTheDocument();
  });

  it('flags purchase orders that never posted an expense', async () => {
    renderPage({
      summary: makeSummary({
        purchases: {
          total: 2500000,
          count: 1,
          recordedTotal: 0,
          unrecordedCount: 1,
          rows: [
            {
              id: 7,
              orderNumber: 'PO-20261101-0007',
              orderDate: '2026-11-01T00:00:00.000Z',
              status: 'pending',
              supplier: 'Old Supplier Co.',
              amount: 2500000,
              expense: null,
            },
          ],
        },
      }),
    });

    await waitFor(() => expect(screen.getByTestId('purchase-row-7')).toBeInTheDocument());

    expect(screen.getByText('1 not in expenses')).toBeInTheDocument();
    expect(screen.getByText('Not in expenses')).toBeInTheDocument();
    expect(screen.getByText('PO-20261101-0007')).toBeInTheDocument();
  });
});

