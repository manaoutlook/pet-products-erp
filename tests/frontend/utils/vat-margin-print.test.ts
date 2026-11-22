import { describe, expect, it } from "vitest";
import { buildVatMarginPrintDocument } from "@/utils/vat-margin-print";
import type { VatMarginStatement } from "@/hooks/use-vat-margin";

/**
 * The printed VAT margin statement.
 *
 * The sheet is what leaves the building for a tax company, so two things are pinned here: the
 * Vietnamese descriptions must survive (the reason the page prints instead of using jsPDF with its
 * Latin-only fonts), and nothing from the database may be able to inject markup into the document.
 */

function statement(overrides: Partial<VatMarginStatement> = {}): VatMarginStatement {
  return {
    document: {
      id: 1,
      type: "sales_order",
      typeLabel: "Sales Order",
      reference: "SO-20260101-0001",
      orderNumber: "SO-20260101-0001",
      invoiceNumber: "CI-20260101-0001",
      customerName: "Nguyễn Văn A",
      companyName: "Cửa hàng Thú cưng",
      contactPerson: "Anh A",
      orderDate: "2026-01-01T00:00:00.000Z",
      vatCompanyName: "CÔNG TY TNHH CONQUEROR",
      vatCompanyTaxId: "0312345678",
      vatCompanyAddress: "12 Lê Lợi, Quận 1",
    },
    lines: [
      {
        productCode: "SP-001",
        description: "Thức ăn cho mèo <lớn>",
        landingPrice: 100_000,
        b2bPrice: 150_000,
        quantity: 2,
        marginAmount: 48_500,
        smartLifePrice: 148_500,
        conquerorProfitUnit: 1_500,
        conquerorProfitTotal: 3_000,
        incomeTax: 600,
        paybackToSmartLife: 296_400,
        salesValue: 300_000,
        vatAmount: 24_000,
        invoiceTotal: 324_000,
        hasError: false,
      },
    ],
    totals: {
      quantity: 2,
      conquerorProfitTotal: 3_000,
      incomeTax: 600,
      paybackToSmartLife: 296_400,
      salesValue: 300_000,
      vatAmount: 24_000,
      invoiceTotal: 324_000,
    },
    params: {
      profitMarginRate: 0.97,
      incomeTaxRate: 0.2,
      vatRate: 0.08,
    },
    errors: [],
    ...overrides,
  };
}

describe("VAT margin print document", () => {
  it("lays the statement out on an A4 landscape sheet", () => {
    const html = buildVatMarginPrintDocument(statement());

    expect(html).toContain("size: A4 landscape");
    expect(html).toContain("VAT margin statement");
    expect(html).toContain("SO-20260101-0001");
    expect(html).toContain("CI-20260101-0001");
    expect(html).toContain("CÔNG TY TNHH CONQUEROR");
  });

  it("keeps Vietnamese diacritics and escapes markup from product descriptions", () => {
    const html = buildVatMarginPrintDocument(statement());

    expect(html).toContain("Thức ăn cho mèo");
    // `<lớn>` was typed into a description - it must print as text, never as a tag.
    expect(html).not.toContain("<lớn>");
    expect(html).toContain("&lt;lớn&gt;");
  });

  it("prints the totals row and the rates the statement was calculated with", () => {
    const html = buildVatMarginPrintDocument(statement());

    expect(html).toContain(">Total<");
    expect(html).toContain("Profit margin:");
    expect(html).toContain("Income tax:");
  });

  it("summarises the payback and what the VAT company keeps below the table", () => {
    const html = buildVatMarginPrintDocument(statement());

    // N = O - K - L = 300,000 - 3,000 - 600
    expect(html).toContain("Payback to SmartLife (N)");
    expect(html).toContain("296.400");
    // K + L = 3,000 + 600, the profit and the income tax it holds.
    expect(html).toContain("Profit and Income Tax for VAT company (K + L)");
    expect(html).toContain("3.600");
    // The sales value closes the split, so the reader can add the lines up themselves.
    expect(html).toContain("Sales value (O)");
    expect(html).toContain("300.000");
  });

  it("prints the two transferred amounts in bold, larger than their labels", () => {
    const html = buildVatMarginPrintDocument(statement());

    // The amounts that actually move are set in `.value`: bold and 10px, so they are the first
    // thing read on paper.
    expect(html).toContain(".summary .row .value { font-weight: bold; font-size: 10px; }");
    expect(html).toContain('<span class="value">296.400');
    expect(html).toContain('<span class="value">3.600');
    expect(html).toContain('<span class="value">300.000');
  });

  it("carries the missing-price warnings onto the sheet", () => {
    const html = buildVatMarginPrintDocument(
      statement({
        errors: [
          {
            productCode: "SP-002",
            field: "landingPrice",
            message: "Landing Price is not updated in the Product module for SP-002",
          },
        ],
      })
    );

    expect(html).toContain("Cannot be sent - update the Product module");
    expect(html).toContain("Landing Price is not updated in the Product module for SP-002");
  });
});
