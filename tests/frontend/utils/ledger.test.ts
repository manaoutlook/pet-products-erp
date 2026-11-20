import { describe, expect, it } from "vitest";
import {
  endOfVietnamDay,
  isLedgerKind,
  ledgerColumnLabels,
  ledgerTotals,
  lineEffect,
  startOfVietnamDay,
  vietnamDayOf,
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

describe("Vietnamese day boundaries", () => {
  it("puts a 21:30 UTC receipt on the next Vietnamese day", () => {
    // 23:30 UTC on the 3rd is 06:30 on the 4th in Ho Chi Minh City.
    expect(vietnamDayOf("2026-11-03T23:30:00.000Z")).toBe("2026-11-04");
    expect(vietnamDayOf("2026-11-03T00:30:00.000Z")).toBe("2026-11-03");
  });

  it("builds day boundaries at UTC+7, not UTC", () => {
    expect(startOfVietnamDay("2026-11-04").toISOString()).toBe("2026-11-03T17:00:00.000Z");
    expect(endOfVietnamDay("2026-11-04").toISOString()).toBe("2026-11-04T16:59:59.999Z");
  });

  it("returns an empty day for an unparseable value instead of Invalid Date", () => {
    expect(vietnamDayOf("not-a-date")).toBe("");
  });
});
