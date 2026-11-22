import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VatMarginCalculatorPage from '@/pages/VatMarginCalculatorPage';

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

// The calculator's data hooks are mocked so the field can be driven without a server. The saved
// default is the documented 97%, and no document is picked - the Rates card renders either way.
// `vatMarginState.statement` lets a test hand the page a computed statement for the summary block.
const vatMarginState = vi.hoisted(() => ({
    statement: null as null | Record<string, unknown>,
}));

vi.mock('@/hooks/use-vat-margin', () => ({
    useVatMarginSettings: () => ({
        data: { profitMarginRate: 0.97, incomeTaxRate: 0.2 },
        isLoading: false,
        isError: false,
        error: null,
    }),
    useVatMarginDocuments: () => ({
        documents: [],
        isLoading: false,
        isError: false,
        error: null,
    }),
    useVatMarginStatement: () => ({
        data: vatMarginState.statement,
        isLoading: false,
        isError: false,
        error: null,
    }),
    saveVatMarginSettings: vi.fn(),
    VAT_MARGIN_SETTINGS_KEY: ['/api/vat-margin/settings'],
}));

/**
 * VAT Margin Calculator - the Profit margin % field.
 *
 * The field carries a business rule (92%-98%) and two ways to change it: typing a percentage or
 * pressing Up/Down to step by one point. Stepping past either end must leave the typed value on
 * screen and raise the inline error - a silent clamp would let an operator believe 99 was saved.
 */
function renderPage() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <VatMarginCalculatorPage />
        </QueryClientProvider>
    );
}

const marginField = () => screen.getByLabelText('Profit margin %') as HTMLInputElement;
const rangeError = () => screen.queryByRole('alert');

/** A statement with the figures from the operator's example, for the summary block. */
const statementFixture = {
    document: {
        id: 1,
        type: 'sales_order',
        typeLabel: 'Sales Order',
        reference: 'SO-20261122-2374',
        orderNumber: 'SO-20261122-2374',
        invoiceNumber: 'CI-20261122-0008',
        customerName: 'Creative Minds Store',
        companyName: 'Creative Minds Store',
        orderDate: '2026-11-22T00:00:00.000Z',
    },
    lines: [],
    totals: {
        quantity: 16,
        conquerorProfitTotal: 40_540,
        incomeTax: 8_108,
        paybackToSmartLife: 1_561_352,
        salesValue: 1_610_000,
        vatAmount: 128_800,
        invoiceTotal: 1_738_800,
    },
    params: {
        profitMarginRate: 0.96,
        incomeTaxRate: 0.2,
        vatRate: 0.08,
    },
    errors: [],
};

describe('VatMarginCalculatorPage profit margin field', () => {
    it('opens on the saved default and steps up and down with the arrow keys', async () => {
        const user = userEvent.setup();
        renderPage();

        const field = await screen.findByLabelText('Profit margin %');
        expect(field).toHaveValue('97');
        expect(screen.getByText('Use ↑ / ↓ to step by 1%.')).toBeInTheDocument();
        expect(rangeError()).not.toBeInTheDocument();

        await user.click(marginField());
        await user.keyboard('{ArrowUp}');
        expect(marginField()).toHaveValue('98');
        expect(rangeError()).not.toBeInTheDocument();

        await user.keyboard('{ArrowDown}');
        expect(marginField()).toHaveValue('97');
        expect(rangeError()).not.toBeInTheDocument();
    });

    it('shows the range error when the arrow keys push the margin above 98', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByLabelText('Profit margin %');
        await user.click(marginField());
        await user.keyboard('{ArrowUp}'); // 98 - still allowed
        await user.keyboard('{ArrowUp}'); // 99 - one over the top

        expect(marginField()).toHaveValue('99');
        expect(rangeError()).toHaveTextContent('Profit margin must be between 92% and 98%.');
        expect(screen.getByRole('button', { name: /save as defaults/i })).toBeDisabled();
    });

    it('shows the range error when the arrow keys push the margin below 92', async () => {
        const user = userEvent.setup();
        renderPage();

        const field = await screen.findByLabelText('Profit margin %');
        await user.clear(field);
        await user.type(field, '92');
        expect(marginField()).toHaveValue('92');
        expect(rangeError()).not.toBeInTheDocument();

        await user.keyboard('{ArrowDown}'); // 91 - one under the floor

        expect(marginField()).toHaveValue('91');
        expect(rangeError()).toHaveTextContent('Profit margin must be between 92% and 98%.');
    });

    it('clears the error as soon as the field comes back into range', async () => {
        const user = userEvent.setup();
        renderPage();

        const field = await screen.findByLabelText('Profit margin %');
        await user.clear(field);
        await user.type(field, '91');
        expect(rangeError()).toBeInTheDocument();

        await user.clear(field);
        await user.type(field, '95');

        expect(marginField()).toHaveValue('95');
        expect(rangeError()).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /save as defaults/i })).toBeEnabled();
    });
});

describe('VatMarginCalculatorPage summary block', () => {
    afterEach(() => {
        vatMarginState.statement = null;
    });

    it('sets the payback and the VAT company amount in bold under the table', async () => {
        vatMarginState.statement = statementFixture;
        renderPage();

        const paybackRow = screen.getByText('Payback to SmartLife').closest('div')!;
        const paybackAmount = within(paybackRow).getByText(/1\.561\.352/);
        expect(paybackAmount).toHaveClass('text-base', 'font-bold');

        const vatCompanyRow = screen
            .getByText(/Profit and Income Tax for VAT company/)
            .closest('div')!;
        const vatCompanyAmount = within(vatCompanyRow).getByText(/48\.648/);
        expect(vatCompanyAmount).toHaveClass('text-base', 'font-bold');

        // The K + L breakdown stays visible next to the label rather than greyed out.
        expect(within(vatCompanyRow).getByText(/40\.540/)).not.toHaveClass('text-muted-foreground');
    });
});
