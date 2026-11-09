import { Link } from "wouter";
import { AlertTriangle, Building2, CheckCircle2 } from "lucide-react";
import {
  COMPANY_FIELDS,
  companyHeaderPrintLines,
  companyHeaderProblemMessage,
  missingCompanyFields,
  type CompanyHeader as CompanyHeaderValues,
} from "@shared/company";
import { escapeHtml, printValue } from "@/utils/print-document";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * THE company header - one component file for the screen and the paper.
 *
 * The band at the top of every screen (`MainLayout`) and the header of every printed
 * document (`buildDocumentCompanyHeader`) live here, side by side, and both read the same
 * four fields, the same labels and the same completeness rule from `shared/company.ts`.
 * A sales order, a delivery note, a receipt, a purchase order and the screen therefore
 * cannot disagree about what the company is called or which fields are still blank - a
 * change to the letterhead is a change in one file, not eight.
 *
 * The two renderers differ only in medium: React + Tailwind on screen, escaped HTML
 * string on paper (a print window has no stylesheet, see `utils/print-document.ts`).
 */

/** Thrown by `assertCompanyHeader` when a document would print with blanks. */
export class CompanyHeaderError extends Error {
  readonly missingFields: string[];

  constructor(missingFields: string[]) {
    super(companyHeaderProblemMessage(missingFields));
    this.name = "CompanyHeaderError";
    this.missingFields = missingFields;
  }
}

/** Labels of the blank letterhead fields; empty means every document may print. */
export function companyHeaderMissingFields(
  company: CompanyHeaderValues | null | undefined
): string[] {
  return missingCompanyFields(company);
}

/** The letterhead, or a `CompanyHeaderError` naming what must be filled in first. */
export function assertCompanyHeader(
  company: CompanyHeaderValues | null | undefined
): CompanyHeaderValues {
  const missing = missingCompanyFields(company);
  if (missing.length > 0 || !company) {
    throw new CompanyHeaderError(missing);
  }
  return company;
}

/**
 * The letterhead exactly as it appears at the top of every printed document: the company
 * name, the registered address and, labelled, the tax ID - centred, with no application
 * title and no other field labels.
 *
 * The delivery address is not part of the heading (`COMPANY_HEADER_PRINT_FIELDS`): it is
 * still a required field of the company record, it just does not belong on the letterhead.
 * `Tax ID` keeps its label because the digits alone tell a reader nothing.
 *
 * Values are escaped with the same helper the rest of the sheet uses, so a company name
 * containing `&` cannot break the page.
 */
export function buildDocumentCompanyHeader(
  company: CompanyHeaderValues | null | undefined
): string {
  const header = assertCompanyHeader(company);

  const lines = companyHeaderPrintLines(header)
    .map((line) => {
      const body =
        line.label.length > 0
          ? `<span class="company-field-label">${escapeHtml(line.label)}:</span> ${printValue(
              line.value
            )}`
          : printValue(line.value);

      return line.emphasis
        ? `<div class="company-name">${body}</div>`
        : `<div class="company-line">${body}</div>`;
    })
    .join("\n    ");

  return `<div class="company-header">
    ${lines}
  </div>`;
}

interface CompanyHeaderProps {
  /** The trimmed letterhead from `useCompanyInfo()`, or `null` before setup. */
  company: CompanyHeaderValues | null | undefined;
  /** True while the first fetch is in flight - the values are unknown, not blank. */
  isLoading?: boolean;
  /** Set when the fetch failed: the letterhead is unknown, not missing. */
  loadError?: unknown;
  /** Hide the "complete the profile" affordance on read-only screens. */
  editable?: boolean;
  className?: string;
}

/**
 * The screen header, rendered once by `MainLayout` so every route shows it.
 *
 * It reports the same state the print path enforces: complete (green), or incomplete
 * (red, naming the blank fields) with a link straight to the form that fixes it.
 */
export function CompanyHeader({
  company,
  isLoading = false,
  loadError,
  editable = true,
  className,
}: CompanyHeaderProps) {
  const missing = missingCompanyFields(company);
  // "unknown" is not "blank": on a slow or broken fetch the band must not accuse the user
  // of leaving four fields empty (that is exactly how a missing table looked like an empty
  // letterhead and cost a debugging session).
  const unknown = isLoading || Boolean(loadError);

  return (
    <header
      className={cn("border-b border-border bg-card px-6 py-3 text-foreground", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-caption uppercase tracking-wide text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
            Company letterhead
          </p>

          <dl className="mt-1 grid gap-x-6 gap-y-0.5 text-caption sm:grid-cols-2 xl:grid-cols-4">
            {COMPANY_FIELDS.map((field) => (
              <div key={field.key} className="flex min-w-0 gap-1">
                <dt className="shrink-0 font-medium text-foreground">{field.label}:</dt>
                <dd className="min-w-0 truncate text-muted-foreground">
                  {company?.[field.key] || "—"}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex items-center gap-2 text-caption">
          {unknown ? (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                loadError ? "text-destructive" : "text-muted-foreground"
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {loadError ? "Letterhead unavailable" : "Loading letterhead…"}
            </span>
          ) : missing.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-success-strong">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Letterhead complete
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Missing: {missing.join(", ")}
            </span>
          )}
          {(unknown || missing.length > 0) && editable && (
            <Link
              href="/company-profile"
              className="font-medium text-primary underline underline-offset-2 hover:text-primary-hover"
            >
              Complete Company Profile
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

interface DocumentHeaderNoticeProps {
  missingFields: string[];
  className?: string;
  /** Where to send the user; the profile screen by default. */
  href?: string;
}

/**
 * Shown instead of a document preview when the letterhead is incomplete.
 *
 * Every print dialog renders this, so a refusal reads the same on the POS, the receipts
 * screen and the back-office screens.
 */
export function DocumentHeaderNotice({
  missingFields,
  className,
  href = "/company-profile",
}: DocumentHeaderNoticeProps) {
  if (missingFields.length === 0) return null;

  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Company letterhead incomplete</AlertTitle>
      <AlertDescription>
        <p>{companyHeaderProblemMessage(missingFields)}</p>
        <p className="mt-1">
          Missing: {missingFields.join(", ")}.{" "}
          <Link href={href} className="font-medium underline underline-offset-2">
            Open Company Profile
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}

interface CompanyHeaderPreviewProps {
  /** Values currently in the form - not necessarily saved yet. */
  company: Partial<CompanyHeaderValues> | null | undefined;
  className?: string;
}

/**
 * What the printed header will look like, on the Company Profile screen.
 *
 * Mirrors the paper exactly: centred, the same three lines, `Tax ID` labelled, no
 * delivery address and no application title. Blank fields are shown as placeholder text
 * rather than hidden, so the user can see exactly which lines the printer would have
 * refused.
 */
export function CompanyHeaderPreview({ company, className }: CompanyHeaderPreviewProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-4 text-center font-mono text-caption text-foreground shadow-card",
        className
      )}
    >
      {companyHeaderPrintLines(company).map((line) => (
        <div
          key={line.key}
          className={cn("py-0.5 break-words", line.emphasis && "font-semibold")}
        >
          {line.label.length > 0 && <span className="font-semibold">{line.label}: </span>}
          {line.value || <span className="text-muted-foreground">— not set —</span>}
        </div>
      ))}
    </div>
  );
}
