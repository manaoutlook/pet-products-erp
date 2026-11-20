import { describe, expect, it } from "vitest";
import {
  isLedgerKind,
  ledgerColumnLabels,
  ledgerTotals,
  lineEffect,
  withRunningBalance,
  type LedgerLine,
} from "@shared/ledger";

/**
 * The ledger arithmetic - one rule for both sheets:
 *   debit increases the balance (money in / charged), credit decreases it (money out / paid),
 *   and a VOIDED row is printed but moves nothing.
 *
 * These helpers are used by the preview and by the printed sheet, so a regression here would
 * put a wrong closing balance on paper.
 */

function line(overrides: Partial<LedgerLine> = {}): LedgerLine {
  return {
    date: "2026-11-03",
    docType: "Receipt",
    docNumber: "RCPT-1",
    description: "Payment",
    note: null,
    debit: 0,
    credit: 0,
    status: "posted",
    source: "receipt",
    sourceId: 1,
    href: null,
    ...overrides,
  };
}

describe("lineEffect", () => {
  it("adds debits and subtracts credits", () => {
    expect(lineEffect(line({ debit: 500 }))).toBe(500);
    expect(lineEffect(line({ credit: 200 }))).toBe(-200);
  });

  it("ignores a voided row even though the amount is still printed", () => {
    expect(lineEffect(line({ credit: 200, status: "voided" }))).toBe(0);
    expect(lineEffect(line({ debit: 700, status: "voided" }))).toBe(0);
  });
});

describe("withRunningBalance", () => {
  it("carries the opening balance through every line", () => {
    const rows = withRunningBalance(
      [line({ debit: 500 }), line({ credit: 200 }), line({ credit: 50, status: "voided" })],
      1_000
    );

    expect(rows.map((row) => row.balance)).toEqual([1_500, 1_300, 1_300]);
  });

  it("keeps the original rows untouched", () => {
    const original = line({ debit: 10 });
    const rows = withRunningBalance([original], 0);

    expect(rows[0]).not.toBe(original);
    expect(original).not.toHaveProperty("balance");
  });
});

describe("ledgerTotals", () => {
  it("totals only posted rows and closes on opening + debit - credit", () => {
    const totals = ledgerTotals(
      [
        line({ debit: 500 }),
        line({ credit: 200 }),
        line({ debit: 999, status: "voided" }),
        line({ credit: 40 }),
      ],
      1_000
    );

    expect(totals).toEqual({
      debit: 500,
      credit: 240,
      closing: 1_260,
      count: 3,
      printed: 4,
    });
  });

  it("returns the opening balance for an empty period", () => {
    expect(ledgerTotals([], 1_000)).toEqual({
      debit: 0,
      credit: 0,
      closing: 1_000,
      count: 0,
      printed: 0,
    });
  });
});

describe("ledgerColumnLabels", () => {
  it("names the columns for the sheet being printed", () => {
    expect(ledgerColumnLabels("customer_statement")).toEqual({
      debit: "Charged",
      credit: "Paid",
      balance: "Outstanding",
    });
    expect(ledgerColumnLabels("cash_book")).toEqual({
      debit: "Money in",
      credit: "Money out",
      balance: "Balance",
    });
  });
});

describe("isLedgerKind", () => {
  it("accepts the two kinds and rejects anything else", () => {
    expect(isLedgerKind("cash_book")).toBe(true);
    expect(isLedgerKind("customer_statement")).toBe(true);
    expect(isLedgerKind("supplier_statement")).toBe(false);
    expect(isLedgerKind(undefined)).toBe(false);
  });
});

