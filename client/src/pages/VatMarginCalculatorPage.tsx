import { useEffect, useMemo, useState } from "react";
import { Calculator, FileText, Loader2, Printer, Save } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import {
  saveVatMarginSettings,
  useVatMarginDocuments,
  useVatMarginSettings,
  useVatMarginStatement,
  VAT_MARGIN_SETTINGS_KEY,
  type VatMarginDocumentType,
} from "@/hooks/use-vat-margin";
import { printVatMarginStatement } from "@/utils/vat-margin-print";
import { formatCurrency, formatDate, formatPercent, formatQuantity } from "@/utils/format";
import { useQueryClient } from "@tanstack/react-query";
import { percentToRate } from "@shared/tax";
import {
  DEFAULT_INCOME_TAX_RATE,
  DEFAULT_PROFIT_MARGIN_RATE,
  DEFAULT_SERVICE_FEE_RATE,
  normaliseProfitMarginRate,
  normaliseRate,
  vatCompanyProfitAndTax,
} from "@shared/vat-margin";

/**
 * VAT Margin Calculator.
 *
 * A VAT company issues the invoice for a sales order; this screen works out how the invoice's
 * value is split between SmartLife and that company, exactly as the partners' worksheet does.
 * One row per order line, with the totals row the tax company checks against.
 *
 * The source is a document, not a typed price list: Sales Order, Delivery Note or Invoice. A
 * delivery note resolves to its whole order, because the split is agreed per order - a partly
 * delivered note must not print a different statement from the order it came from.
 *
 * AI Agent Note: landing price and B2B price are read LIVE from the Product module (`products`),
 * not from snapshots on the order. That is the point of the reconciliation: what the catalogue
 * says the goods cost today against what was invoiced. A product with either price still blank
 * therefore blocks the print (the server returns one named error per SKU, shown verbatim) - a
 * statement with an invented zero is worse than no statement.
 *
 * The PDF is produced with the browser's own print dialog ("Save as PDF") on an A4 landscape
 * sheet, so Vietnamese diacritics survive; see `client/src/utils/vat-margin-print.ts`.
 */

const DOCUMENT_TYPE_LABELS: Record<VatMarginDocumentType, string> = {
  sales_order: "Sales Order",
  delivery_note: "Delivery Note",
  invoice: "Invoice",
};

const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as VatMarginDocumentType[];

/** A percentage typed in the form ("97") as the fraction the API expects (0.97). */
function percentInputToRate(value: string, fallback: number): number {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return fallback;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? percentToRate(numeric) : fallback;
}

const money = (value: number) => formatCurrency(value);
const quantity = (value: number) => formatQuantity(value);
const percent = (value: number) => formatPercent(value, { maximumFractionDigits: 2 });

function VatMarginCalculatorPage() {
  const { hasPermission } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canSaveDefaults = hasPermission("orders", "update");

  const [type, setType] = useState<VatMarginDocumentType>("sales_order");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [profitMargin, setProfitMargin] = useState("");
  const [incomeTax, setIncomeTax] = useState("");
  const [serviceFee, setServiceFee] = useState("");
  /** True once the saved defaults have filled the fields; later refetches must not overwrite typing. */
  const [ratesReady, setRatesReady] = useState(false);
  const [saving, setSaving] = useState(false);

  const settingsQuery = useVatMarginSettings();
  const documentsQuery = useVatMarginDocuments(type);

  useEffect(() => {
    if (ratesReady || !settingsQuery.data) return;
    setProfitMargin(String(Math.round(settingsQuery.data.profitMarginRate * 1000) / 10));
    setIncomeTax(String(Math.round(settingsQuery.data.incomeTaxRate * 1000) / 10));
    setServiceFee(String(Math.round(settingsQuery.data.serviceFeeRate * 1000) / 10));
    setRatesReady(true);
  }, [settingsQuery.data, ratesReady]);

  // Changing the document type invalidates the picked id - ids are only unique within a type.
  useEffect(() => {
    setDocumentId(null);
  }, [type]);

  const rates = useMemo(
    () => ({
      profitMarginRate: normaliseProfitMarginRate(
        percentInputToRate(profitMargin, DEFAULT_PROFIT_MARGIN_RATE)
      ),
      incomeTaxRate: normaliseRate(percentInputToRate(incomeTax, DEFAULT_INCOME_TAX_RATE)),
      serviceFeeRate: normaliseRate(percentInputToRate(serviceFee, DEFAULT_SERVICE_FEE_RATE)),
    }),
    [profitMargin, incomeTax, serviceFee]
  );

  const statementQuery = useVatMarginStatement(
    type,
    documentId === null ? null : Number(documentId),
    rates
  );

  const statement = statementQuery.data ?? null;
  const hasBlockingErrors = (statement?.errors.length ?? 0) > 0;

  const documentOptions = documentsQuery.documents.map((document) => ({
    value: String(document.id),
    label: document.reference,
    description: [document.description, document.date ? formatDate(document.date) : ""]
      .filter(Boolean)
      .join(" · "),
  }));

  const saveDefaults = async () => {
    setSaving(true);
    try {
      await saveVatMarginSettings(rates);
      queryClient.invalidateQueries({ queryKey: VAT_MARGIN_SETTINGS_KEY });
      toast({
        title: "Defaults saved",
        description: "The calculator now opens with these rates.",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Could not save the defaults",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const print = () => {
    if (!statement) return;
    const opened = printVatMarginStatement(statement);
    if (!opened) {
      toast({
        title: "Allow pop-ups to print",
        description:
          "The statement opens in a new window. Allow pop-ups for this site, then try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">VAT Margin Calculator</h1>
          <p className="text-sm text-muted-foreground">
            Split a VAT invoice between SmartLife and the company that issued it, then send the
            statement as a PDF.
          </p>
        </div>
        <Button onClick={print} disabled={!statement || hasBlockingErrors}>
          <Printer className="mr-1 h-4 w-4" />
          Print / Save as PDF
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Document
          </CardTitle>
          <CardDescription>
            Pick the document the VAT invoice was issued for. A delivery note always calculates the
            whole sales order it came from.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {DOCUMENT_TYPES.map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={type === option ? "default" : "outline"}
                onClick={() => setType(option)}
              >
                {DOCUMENT_TYPE_LABELS[option]}
              </Button>
            ))}
          </div>

          <div className="max-w-xl space-y-2">
            <Label>Document</Label>
            <SearchableSelect
              value={documentId}
              onChange={setDocumentId}
              options={documentOptions}
              placeholder={
                documentsQuery.isLoading
                  ? "Loading documents..."
                  : `Select a ${DOCUMENT_TYPE_LABELS[type].toLowerCase()}`
              }
              searchPlaceholder="Search by number or customer..."
              emptyMessage={`No ${DOCUMENT_TYPE_LABELS[type].toLowerCase()} found.`}
              disabled={documentsQuery.isLoading}
            />
            {documentsQuery.isError && (
              <p className="text-sm text-destructive">
                {documentsQuery.error instanceof Error
                  ? documentsQuery.error.message
                  : "Could not load the documents."}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            Rates
          </CardTitle>
          <CardDescription>
            Profit margin is clamped to 95%-99%. The VAT rate comes from the order, never from this
            screen - an issued invoice keeps the rate it was issued at.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="profit-margin">Profit margin %</Label>
            <Input
              id="profit-margin"
              inputMode="decimal"
              value={profitMargin}
              onChange={(event) => setProfitMargin(event.target.value)}
              placeholder="97"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="income-tax">Income tax %</Label>
            <Input
              id="income-tax"
              inputMode="decimal"
              value={incomeTax}
              onChange={(event) => setIncomeTax(event.target.value)}
              placeholder="20"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="service-fee">VAT invoice service fee %</Label>
            <Input
              id="service-fee"
              inputMode="decimal"
              value={serviceFee}
              onChange={(event) => setServiceFee(event.target.value)}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">Share of the sales value.</p>
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              onClick={saveDefaults}
              disabled={!canSaveDefaults || saving}
              className="w-full"
            >
              {saving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              Save as defaults
            </Button>
          </div>
        </CardContent>
      </Card>

      {documentId && statementQuery.isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Calculating the statement...
          </CardContent>
        </Card>
      )}

      {documentId && statementQuery.isError && (
        <Alert variant="destructive">
          <AlertTitle>Could not calculate the statement</AlertTitle>
          <AlertDescription>
            {statementQuery.error instanceof Error
              ? statementQuery.error.message
              : "Please try again."}
          </AlertDescription>
        </Alert>
      )}

      {!documentId && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Pick a document above to calculate its VAT margin statement.
          </CardContent>
        </Card>
      )}

      {statement && (
        <>
          {hasBlockingErrors && (
            <Alert variant="destructive">
              <AlertTitle>Prices are missing in the Product module</AlertTitle>
              <AlertDescription>
                <p>
                  The statement cannot be sent until these are filled in. Open each product and
                  enter the field named below, then reload this page.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {statement.errors.map((issue) => (
                    <li key={`${issue.productCode}-${issue.field}`}>{issue.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>
                {statement.document.typeLabel} {statement.document.reference}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{statement.document.companyName || statement.document.customerName}</span>
                <Badge variant="outline">
                  Order {statement.document.orderNumber}
                </Badge>
                {statement.document.invoiceNumber && (
                  <Badge variant="outline">Invoice {statement.document.invoiceNumber}</Badge>
                )}
                <Badge variant="outline">VAT {percent(statement.params.vatRate)}</Badge>
                <Badge variant="outline">
                  Margin {percent(statement.params.profitMarginRate)}
                </Badge>
                <Badge variant="outline">Income tax {percent(statement.params.incomeTaxRate)}</Badge>
                {statement.params.serviceFeeRate > 0 && (
                  <Badge variant="outline">
                    Service fee {percent(statement.params.serviceFeeRate)}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table className="min-w-[1240px] text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="min-w-[180px]">Description</TableHead>
                    <TableHead className="text-right">Qty (G)</TableHead>
                    <TableHead className="text-right">Landing (E)</TableHead>
                    <TableHead className="text-right">B2B (F)</TableHead>
                    <TableHead className="text-right">Margin (H)</TableHead>
                    <TableHead className="text-right">SmartLife (I)</TableHead>
                    <TableHead className="text-right">VAT co. / unit (J)</TableHead>
                    <TableHead className="text-right">VAT co. profit (K)</TableHead>
                    <TableHead className="text-right">Income tax (L)</TableHead>
                    <TableHead className="text-right">Service fee (M)</TableHead>
                    <TableHead className="text-right">Payback (N)</TableHead>
                    <TableHead className="text-right">Sales value (O)</TableHead>
                    <TableHead className="text-right">VAT (P)</TableHead>
                    <TableHead className="text-right">Invoice total (Q)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statement.lines.map((line, index) => (
                    <TableRow
                      key={`${line.productCode}-${index}`}
                      className={line.hasError ? "bg-destructive/5" : undefined}
                    >
                      <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                      <TableCell className="font-medium">{line.productCode}</TableCell>
                      <TableCell>{line.description}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {quantity(line.quantity)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(line.landingPrice)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(line.b2bPrice)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(line.marginAmount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(line.smartLifePrice)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(line.conquerorProfitUnit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(line.conquerorProfitTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(line.incomeTax)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(line.serviceFee)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(line.paybackToSmartLife)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(line.salesValue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(line.vatAmount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(line.invoiceTotal)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="font-semibold">
                      Total
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {quantity(statement.totals.quantity)}
                    </TableCell>
                    <TableCell colSpan={5} />
                    <TableCell className="text-right tabular-nums">
                      {money(statement.totals.conquerorProfitTotal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(statement.totals.incomeTax)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(statement.totals.serviceFee)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(statement.totals.paybackToSmartLife)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(statement.totals.salesValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(statement.totals.vatAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(statement.totals.invoiceTotal)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>

              {/* The two amounts that actually move: what SmartLife is paid back, and what the
                  VAT company keeps (its profit plus the income tax on it). They add up with the
                  service fee to the sales value - that is the whole point of the split. */}
              <div className="mt-4 space-y-2 rounded-lg border bg-muted/30 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">Payback to SmartLife</span>
                  <span className="font-semibold tabular-nums">
                    {money(statement.totals.paybackToSmartLife)}
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">
                    Profit and Income Tax for VAT company
                    <span className="ml-2 text-caption font-normal text-muted-foreground">
                      {money(statement.totals.conquerorProfitTotal)} +{" "}
                      {money(statement.totals.incomeTax)}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {money(vatCompanyProfitAndTax(statement.totals))}
                  </span>
                </div>
                {statement.totals.serviceFee > 0 && (
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">VAT invoice service fee</span>
                    <span className="font-semibold tabular-nums">
                      {money(statement.totals.serviceFee)}
                    </span>
                  </div>
                )}
                <p className="border-t pt-2 text-caption text-muted-foreground">
                  Payback + Profit and Income Tax
                  {statement.totals.serviceFee > 0 ? " + Service fee" : ""} = Sales value{" "}
                  {money(statement.totals.salesValue)}. VAT {money(statement.totals.vatAmount)} is
                  paid to the tax office and is not part of the split.
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

    </div>
  );
}

export default VatMarginCalculatorPage;



