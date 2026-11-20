import { companyHeaderPrintLines, type CompanyHeader } from "@shared/company";
import { formatCurrency, formatDateTime } from "@/utils/format";
import { withRunningBalance, type LedgerDocument } from "@shared/ledger";

/**
 * Build the printable ledger as a standalone A4 document.
 *
 * AI Agent Note: same rule as the POS receipt (`components/POS/ReceiptPrinter.tsx`) - the print
 * window loads no Tailwind, so every style the sheet needs is written here, on white paper with
 * black ink. Values are escaped, and the running balance comes from `withRunningBalance`
 * (shared/ledger.ts), the same helper the on-screen preview uses, so the paper and the screen
 * cannot disagree about the arithmetic.
 */

function escapeHtml(value: unknown): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (char) => map[char]);
}

/** `2026-11-19` -> `19/11/2026`, without going through a time zone. */
function printedDay(day: string): string {
  const [year, month, date] = day.split("-");
  return year && month && date ? `${date}/${month}/${year}` : day || "—";
}

function buildLetterhead(company: CompanyHeader): string {
  return companyHeaderPrintLines(company)
    .map((line) => {
      const body =
        line.label.length > 0
          ? `<span class="bold">${escapeHtml(line.label)}:</span> ${escapeHtml(line.value)}`
          : escapeHtml(line.value);
      return `<div class="${line.emphasis ? "bold title" : "small"}">${body}</div>`;
    })
    .join("");
}

function signAmount(value: number): string {
  return value === 0 ? "" : formatCurrency(value);
}

const PRINT_STYLES = `
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5px;
    line-height: 1.4;
    color: #000;
    background: #fff;
    margin: 0;
  }
  .center { text-align: center; }
  .title { font-size: 18px; }
  .small { font-size: 10px; }
  .tiny { font-size: 8.5px; }
  .muted { color: #444; }
  .bold { font-weight: bold; }
  .head { margin-bottom: 10px; }
  h1 { font-size: 16px; margin: 10px 0 2px; letter-spacing: 0.5px; }
  h2 { font-size: 11px; margin: 0 0 8px; font-weight: normal; color: #333; }
  .meta {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    padding: 6px 0;
    margin-bottom: 8px;
  }
  .meta .label { color: #555; font-size: 9px; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    text-align: left;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    border-bottom: 1px solid #000;
    padding: 4px 4px;
  }
  thead th.num, tbody td.num { text-align: right; white-space: nowrap; }
  tbody td {
    border-bottom: 1px solid #ddd;
    padding: 4px 4px;
    vertical-align: top;
  }
  tbody tr.voided td { color: #777; text-decoration: line-through; }
  tbody tr.voided div.tiny { text-decoration: none; }
  tr.opening td, tr.totals td {
    border-top: 1px solid #000;
    border-bottom: 2px solid #000;
    font-weight: bold;
    padding: 5px 4px;
  }
  tr.opening td { border-bottom: 1px solid #ddd; }
  .nowrap { white-space: nowrap; }
  .notes { margin-top: 10px; font-size: 9px; color: #333; }
  .notes ul { margin: 4px 0 0; padding-left: 16px; }
  .footer {
    margin-top: 14px;
    display: flex;
    justify-content: space-between;
    font-size: 8.5px;
    color: #555;
  }
  .signatures {
    margin-top: 26px;
    display: flex;
    justify-content: space-between;
    gap: 40px;
    font-size: 9.5px;
    text-align: center;
  }
  .signatures div { flex: 1; }
  .signature-line { margin-top: 42px; border-top: 1px solid #000; padding-top: 4px; }
`;

function printedRange(document: LedgerDocument): string {
  return `${printedDay(document.from)} - ${printedDay(document.to)}`;
}

function buildRows(document: LedgerDocument): string {
  return withRunningBalance(document.lines, document.openingBalance)
    .map((line) => {
      const voided = line.status === "voided";
      return `
        <tr class="${voided ? "voided" : ""}">
          <td class="nowrap">${escapeHtml(printedDay(line.date))}</td>
          <td>
            <div>${escapeHtml(line.docNumber)}</div>
            <div class="muted tiny">${escapeHtml(line.docType)}${voided ? " · VOIDED" : ""}</div>
          </td>
          <td>
            <div>${escapeHtml(line.description)}</div>
            ${line.note ? `<div class="muted tiny">${escapeHtml(line.note)}</div>` : ""}
          </td>
          <td class="num">${escapeHtml(signAmount(line.debit))}</td>
          <td class="num">${escapeHtml(signAmount(line.credit))}</td>
          <td class="num bold">${escapeHtml(formatCurrency(line.balance))}</td>
        </tr>`;
    })
    .join("");
}

export function buildLedgerPrintDocument(
  document: LedgerDocument,
  company: CompanyHeader
): string {
  const { debit: debitLabel, credit: creditLabel, balance: balanceLabel } =
    document.columnLabels;
  const lineWord = document.totals.count === 1 ? "line" : "lines";

  return `<!doctype html>
    <html>
      <head>
        <title>${escapeHtml(document.title)} - ${escapeHtml(
          document.party?.name ?? printedRange(document)
        )}</title>
        <style>${PRINT_STYLES}</style>
      </head>
      <body>
        <div class="center head">${buildLetterhead(company)}</div>

        <div class="center">
          <h1>${escapeHtml(document.title.toUpperCase())}</h1>
          <h2>${escapeHtml(document.subtitle)}</h2>
        </div>

        <div class="meta">
          <div>
            <div class="label">${document.party ? "Customer" : "Book"}</div>
            <div class="bold">${escapeHtml(document.party?.name ?? "All cash movements")}</div>
            ${
              document.party?.detail
                ? `<div class="small">${escapeHtml(document.party.detail)}</div>`
                : ""
            }
          </div>
          <div>
            <div class="label">Period</div>
            <div>${escapeHtml(printedRange(document))}</div>
          </div>
          <div>
            <div class="label">Printed</div>
            <div>${escapeHtml(formatDateTime(document.generatedAt))}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Document</th>
              <th>Description</th>
              <th class="num">${escapeHtml(debitLabel)}</th>
              <th class="num">${escapeHtml(creditLabel)}</th>
              <th class="num">${escapeHtml(balanceLabel)}</th>
            </tr>
          </thead>
          <tbody>
            <tr class="opening">
              <td colspan="5">${escapeHtml(document.openingLabel)} (before ${escapeHtml(
                printedDay(document.from)
              )})</td>
              <td class="num">${escapeHtml(formatCurrency(document.openingBalance))}</td>
            </tr>
            ${buildRows(document)}
            <tr class="totals">
              <td colspan="3">${escapeHtml(document.closingLabel)} (${
                document.totals.count
              } posted ${lineWord})</td>
              <td class="num">${escapeHtml(formatCurrency(document.totals.debit))}</td>
              <td class="num">${escapeHtml(formatCurrency(document.totals.credit))}</td>
              <td class="num">${escapeHtml(formatCurrency(document.totals.closing))}</td>
            </tr>
          </tbody>
        </table>

        <div class="notes">
          <div class="bold">How to read this sheet</div>
          <ul>${document.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
        </div>

        <div class="signatures">
          <div><div class="signature-line">Prepared by</div></div>
          <div><div class="signature-line">Checked by</div></div>
          <div><div class="signature-line">${escapeHtml(
            document.party ? "Customer" : "Director"
          )}</div></div>
        </div>

        <div class="footer">
          <span>${escapeHtml(document.title)} · ${escapeHtml(printedRange(document))}</span>
          <span>Figures are read live from the receipt register and the manual entries</span>
        </div>
      </body>
    </html>`;
}

