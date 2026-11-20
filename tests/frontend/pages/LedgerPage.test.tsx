import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LedgerPage from "@/pages/LedgerPage";
import { formatCurrency } from "@/utils/format";
import type { LedgerDocument } from "@shared/ledger";

/**
 * Ledger printing screen.
 *
 * The sheet is a read model over receipts, invoices and manual entries - these tests pin what a
 * reader sees before printing: the opening balance carried in, the charged/paid columns for a
 * statement, voided rows that do not move the balance, and the closing figure. They also check
 * that Print writes a standalone document (the print window loads no Tailwind, so the markup
 * must be self-contained).
 */

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

vi.mock("@/hooks/use-company", () => ({
  useCompanyInfo: () => ({
    company: {
      companyName: "Pet Products Ltd",
      registeredAddress: "1 Nguyen Hue, Ho Chi Minh City",
      deliveryAddress: "1 Nguyen Hue, Ho Chi Minh City",
      taxId: "0123456789",
    },
    missingFields: [],
    valid: true,
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

/**
 * Currency in the DOM is formatted by `Intl`, which separates the amount from the symbol with a
 * narrow no-break space. Build a matcher that accepts any gap between the parts.
 */
function money(value: number) {
  const escaped = formatCurrency(value)
    .split(/[\s\u00A0\u202F]+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s\\u00A0\\u202F]*");
  return new RegExp(`^${escaped}$`);
}

function makeCashBook(): LedgerDocument {
  return {
    kind: "cash_book",
    title: "Cash book",
    subtitle: "Money in and money out, 2026-11-01 to 2026-11-19",
    party: null,
    from: "2026-11-01",
    to: "2026-11-19",
    openingLabel: "Opening balance",
    openingBalance: 100_000,
    columnLabels: { debit: "Money in", credit: "Money out", balance: "Balance" },
    closingLabel: "Closing balance",
    lines: [
      {
        date: "2026-11-03",
        docType: "Receipt",
        docNumber: "RCPT-20261103-0001",
        description: "Received from Acme Retail for invoice INV-1",
        note: "CASH",
        debit: 50_000,
        credit: 0,
        status: "posted",
        source: "receipt",
        sourceId: 1,
        href: "/receipts?tab=customer",
      },
      {
        date: "2026-11-04",
        docType: "Expense",
        docNumber: "FIN-20261104-0001",
        description: "Rent - November rent",
        note: "BANK_TRANSFER",
        debit: 0,
        credit: 20_000,
        status: "posted",
        source: "finance_entry",
        sourceId: 2,
        href: "/finance?tab=entries&search=FIN-20261104-0001",
      },
      {
        date: "2026-11-05",
        docType: "Receipt",
        docNumber: "RCPT-20261105-0002",
        description: "Received from Acme Retail for invoice INV-2",
        note: "CASH",
        debit: 900_000,
        credit: 0,
        status: "voided",
        source: "receipt",
        sourceId: 3,
        href: "/receipts?tab=customer",
      },
    ],
    totals: { debit: 50_000, credit: 20_000, closing: 130_000, count: 2, printed: 3 },
    notes: [
      "Reads the customer receipt register and the manual entries together.",
      "Voided rows are printed for the audit trail but do not move the balance.",
    ],
    generatedAt: "2026-11-19T09:00:00.000Z",
  };
}

function makeStatement(): LedgerDocument {
  return {
    kind: "customer_statement",
    title: "Customer statement",
    subtitle: "Account activity, 2026-11-01 to 2026-11-19",
    party: { id: 7, name: "Acme Retail", detail: "Ms Lan · 0900000000" },
    from: "2026-11-01",
    to: "2026-11-19",
    openingLabel: "Opening balance",
    openingBalance: 0,
    columnLabels: { debit: "Charged", credit: "Paid", balance: "Outstanding" },
    closingLabel: "Outstanding at end of period",
    lines: [
      {
        date: "2026-11-08",
        docType: "Invoice",
        docNumber: "INV-20261108-0001",
        description: "VAT invoice",
        note: "Due 2026-11-22",
        debit: 220_000,
        credit: 0,
        status: "posted",
        source: "invoice",
        sourceId: 11,
        href: "/receivables",
      },
      {
        date: "2026-11-12",
        docType: "Receipt",
        docNumber: "RCPT-20261112-0003",
        description: "Payment for invoice INV-20261108-0001",
        note: "BANK_TRANSFER",
        debit: 0,
        credit: 100_000,
        status: "posted",
        source: "receipt",
        sourceId: 12,
        href: "/receipts?tab=customer",
      },
    ],
    totals: { debit: 220_000, credit: 100_000, closing: 120_000, count: 2, printed: 2 },
    notes: ["Invoices are the charges and receipts are the payments, including partial payments."],
    generatedAt: "2026-11-19T09:00:00.000Z",
  };
}

function renderPage() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);

    if (url.startsWith("/api/finance/ledger/customers")) {
      return jsonResponse({
        customers: [{ id: 7, name: "Acme Retail", detail: "Ms Lan", invoiceCount: 2 }],
      });
    }
    if (url.startsWith("/api/finance/ledger?")) {
      return jsonResponse({
        document: url.includes("customer_statement") ? makeStatement() : makeCashBook(),
      });
    }
    return jsonResponse({});
  });

  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LedgerPage />
    </QueryClientProvider>
  );
}

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Radix UI primitives rely on these DOM APIs, which happy-dom does not fully implement.
  Element.prototype.hasPointerCapture = vi.fn(() => false) as never;
  Element.prototype.setPointerCapture = vi.fn() as never;
  Element.prototype.releasePointerCapture = vi.fn() as never;
  Element.prototype.scrollIntoView = vi.fn() as never;

  openSpy = vi.spyOn(window, "open").mockReturnValue({
    document: { write: vi.fn(), close: vi.fn() },
    print: vi.fn(),
  } as unknown as Window);
});

afterEach(() => {
  openSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe("LedgerPage", () => {
  it("prints the cash book with the opening balance carried into a closing balance", async () => {
    renderPage();

    expect(await screen.findByText("RCPT-20261103-0001")).toBeInTheDocument();
    expect(screen.getByText(/Opening balance \(before 2026-11-01\)/)).toBeInTheDocument();
    expect(screen.getByText("FIN-20261104-0001")).toBeInTheDocument();

    // Money in / money out are the cash book headings - not the statement's Charged/Paid.
    expect(screen.getByRole("columnheader", { name: "Money in" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Money out" })).toBeInTheDocument();

    // 100.000 opening + 50.000 in - 20.000 out = 130.000: the last running row and the total.
    await waitFor(() => {
      expect(screen.getAllByText(money(130_000)).length).toBeGreaterThanOrEqual(2);
    });

    // The voided receipt is printed but does not move the balance.
    expect(screen.getByText("Receipt · voided")).toBeInTheDocument();
  });

  it("opens a standalone print window with the sheet's own markup", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("RCPT-20261103-0001");
    await user.click(screen.getByRole("button", { name: /print ledger/i }));

    expect(openSpy).toHaveBeenCalled();
    const printWindow = openSpy.mock.results[0].value as unknown as {
      document: { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
      print: ReturnType<typeof vi.fn>;
    };

    const html = printWindow.document.write.mock.calls[0][0] as string;
    expect(html).toContain("CASH BOOK");
    expect(html).toContain("Money in");
    expect(html).toContain("Pet Products Ltd");
    expect(printWindow.print).toHaveBeenCalled();
  });

  it("asks for a customer, then shows the statement's charged and paid columns", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("RCPT-20261103-0001");

    // Switch the sheet to a customer statement.
    await user.click(screen.getByRole("combobox", { name: /sheet/i }));
    await user.click(await screen.findByRole("option", { name: /customer statement/i }));

    expect(
      await screen.findByText("Choose the customer whose statement you want to print.")
    ).toBeInTheDocument();

    await user.click(await screen.findByRole("combobox", { name: /customer/i }));
    await user.click(await screen.findByRole("option", { name: /Acme Retail/i }));

    expect(await screen.findByText("INV-20261108-0001")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Charged" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Outstanding" })).toBeInTheDocument();
    expect(screen.getByText(/Outstanding at end of period \(2 posted\)/)).toBeInTheDocument();
  });
});
