import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Loader2, Printer, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/utils/format";
import { useCompanyInfo } from "@/hooks/use-company";
import { useToast } from "@/hooks/use-toast";
import {
  DocumentHeaderNotice,
  companyHeaderMissingFields,
} from "@/components/company/CompanyHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildLedgerPrintDocument } from "@/lib/ledger-print";
import {
  LEDGER_KINDS,
  LEDGER_KIND_LABELS,
  vietnamDayOf,
  withRunningBalance,
  type LedgerDocument,
  type LedgerKind,
} from "@shared/ledger";
import { companyHeaderProblemMessage } from "@shared/company";
import { readApiError } from "@/lib/apiError";

/**
 * Ledger printing.
 *
 * Paper, not a new book. The sheet is assembled from documents the application already keeps:
 * customer receipts (`invoice_payments`), the manual money book (`finance_entries`) and customer
 * invoices (`invoices`). Nothing is posted, copied or cached, so the figure on paper is the same
 * figure Receivables and Manual entries show, and voiding a document corrects the next print.
 *
 * Two sheets:
 *   Cash book          - money in / money out for a period, with an opening and a closing balance.
 *   Customer statement - one customer's invoices (charged) and receipts (paid), partial payments
 *                        included, closing at what is still outstanding.
 *
 * The running balance is computed by `withRunningBalance` from shared/ledger.ts - the same
 * helper the printed sheet uses, so the screen and the paper can never drift apart.
 *
 * Purchases cannot appear yet: the database has no supplier bills or supplier payments (only
 * purchase orders), so a supplier ledger would have nothing truthful to print. That is a schema
 * change, not a layout change - the page says so instead of faking a supplier statement.
 */

interface LedgerCustomer {
  id: number;
  name: string;
  detail: string | null;
  invoiceCount: number;
}

interface LedgerResponse {
  document: LedgerDocument;
}

interface CustomersResponse {
  customers: LedgerCustomer[];
}

function initialQuery() {
  return new URLSearchParams(window.location.search);
}

export default function LedgerPage() {
  const { toast } = useToast();
  const companyInfo = useCompanyInfo();
  const missingHeaderFields = companyHeaderMissingFields(companyInfo.company);

  const params = initialQuery();
  const today = vietnamDayOf(new Date()) || new Date().toISOString().slice(0, 10);
  const initialKind = params.get("kind");
  const [kind, setKind] = useState<LedgerKind>(
    initialKind === "customer_statement" ? "customer_statement" : "cash_book"
  );
  const [from, setFrom] = useState(params.get("from") || `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(params.get("to") || today);
  const [customerId, setCustomerId] = useState(params.get("customerId") || "");

  const customersQuery = useQuery<CustomersResponse>({
    queryKey: ["/api/finance/ledger/customers"],
    enabled: kind === "customer_statement",
    queryFn: async () => {
      const response = await fetch("/api/finance/ledger/customers", { credentials: "include" });
      if (!response.ok) throw new Error(await readApiError(response));
      return (await response.json()) as CustomersResponse;
    },
  });

  const needsCustomer = kind === "customer_statement";
  const rangeValid = Boolean(from) && Boolean(to) && from <= to;

  const ledgerQuery = useQuery<LedgerResponse>({
    queryKey: ["/api/finance/ledger", kind, from, to, customerId],
    enabled: rangeValid && (!needsCustomer || customerId !== ""),
    queryFn: async () => {
      const search = new URLSearchParams({ kind, from, to });
      if (needsCustomer) search.set("customerProfileId", customerId);

      const response = await fetch(`/api/finance/ledger?${search.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return (await response.json()) as LedgerResponse;
    },
  });

  const document = ledgerQuery.data?.document ?? null;
  const rows = useMemo(
    () => (document ? withRunningBalance(document.lines, document.openingBalance) : []),
    [document]
  );

  const handlePrint = () => {
    if (!document) return;

    if (missingHeaderFields.length > 0) {
      toast({
        title: "Company letterhead incomplete",
        description: companyHeaderProblemMessage(missingHeaderFields),
        variant: "destructive",
      });
      return;
    }

    const company = companyInfo.company;
    if (!company) {
      toast({
        title: "Company profile missing",
        description: "Fill in the company letterhead before printing a statement.",
        variant: "destructive",
      });
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({
        title: "Print blocked",
        description: "Allow pop-ups for this site to print the ledger.",
        variant: "destructive",
      });
      return;
    }

    printWindow.document.write(buildLedgerPrintDocument(document, company));
    printWindow.document.close();
    printWindow.print();
  };

  const error = (ledgerQuery.error as Error | null) ?? null;

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/finance">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Financial Accounts
            </Link>
          </Button>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Ledger printing</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            A printable sheet built from the documents the system already keeps: customer receipts,
            the manual money book and customer invoices. Nothing is re-posted, so the figures on
            paper are the same figures Receivables and Manual entries show today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void ledgerQuery.refetch()}
            disabled={ledgerQuery.isFetching}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${ledgerQuery.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button size="sm" onClick={handlePrint} disabled={!document}>
            <Printer className="mr-2 h-4 w-4" />
            Print ledger
          </Button>
        </div>
      </div>

      <DocumentHeaderNotice missingFields={missingHeaderFields} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What to print</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="ledger-kind" className="text-xs text-muted-foreground">
                Sheet
              </Label>
              <Select value={kind} onValueChange={(value) => setKind(value as LedgerKind)}>
                <SelectTrigger id="ledger-kind" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEDGER_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {LEDGER_KIND_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {needsCustomer ? (
              <div className="space-y-1">
                <Label htmlFor="ledger-customer" className="text-xs text-muted-foreground">
                  Customer
                </Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger id="ledger-customer" className="w-72">
                    <SelectValue
                      placeholder={
                        customersQuery.isLoading ? "Loading customers…" : "Choose a customer"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(customersQuery.data?.customers ?? []).map((customer) => (
                      <SelectItem key={customer.id} value={String(customer.id)}>
                        {customer.name} · {customer.invoiceCount} invoice
                        {customer.invoiceCount === 1 ? "" : "s"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1">
              <Label htmlFor="ledger-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="ledger-from"
                type="date"
                value={from}
                max={to}
                onChange={(event) => setFrom(event.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ledger-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="ledger-to"
                type="date"
                value={to}
                min={from}
                onChange={(event) => setTo(event.target.value)}
                className="w-40"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Purchases are not printable yet: the database has purchase orders but no supplier bills
            or supplier payments, so a supplier ledger would have nothing truthful to show.
          </p>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-sm text-destructive">{error.message}</CardContent>
        </Card>
      ) : null}

      {needsCustomer && !customerId ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Choose the customer whose statement you want to print.
          </CardContent>
        </Card>
      ) : null}

      {ledgerQuery.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Building the sheet…
        </div>
      ) : null}

      {document ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {document.title}
              {document.party ? ` — ${document.party.name}` : ""}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {document.subtitle}
              {document.party?.detail ? ` · ${document.party.detail}` : ""}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead className="w-56">Document</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">{document.columnLabels.debit}</TableHead>
                  <TableHead className="text-right">{document.columnLabels.credit}</TableHead>
                  <TableHead className="text-right">{document.columnLabels.balance}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-muted/40 font-medium">
                  <TableCell colSpan={5} className="text-muted-foreground">
                    {document.openingLabel} (before {document.from})
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(document.openingBalance)}
                  </TableCell>
                </TableRow>
                {rows.map((line) => (
                  <TableRow
                    key={`${line.source}-${line.sourceId}`}
                    className={line.status === "voided" ? "text-muted-foreground" : undefined}
                  >
                    <TableCell className="whitespace-nowrap">{line.date}</TableCell>
                    <TableCell>
                      <div className="font-medium">{line.docNumber}</div>
                      <div className="text-xs text-muted-foreground">
                        {line.docType}
                        {line.status === "voided" ? " · voided" : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{line.description}</div>
                      {line.note ? (
                        <div className="text-xs text-muted-foreground">{line.note}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.debit ? formatCurrency(line.debit) : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.credit ? formatCurrency(line.credit) : ""}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(line.balance)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-semibold">
                  <TableCell colSpan={3}>
                    {document.closingLabel} ({document.totals.count} posted)
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(document.totals.debit)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(document.totals.credit)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(document.totals.closing)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {document.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
