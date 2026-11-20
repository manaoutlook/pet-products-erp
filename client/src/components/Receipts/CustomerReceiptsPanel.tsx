import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDateTime } from "@/utils/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { SearchInput } from "@/components/ui/search-input";
import { Ban, Loader2, Printer, Receipt, RefreshCw, Wallet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PAYMENT_METHODS } from "@shared/invoice-payment";
import type { CompanyHeader } from "@shared/company";
import {
  printPaymentReceipt,
  type CustomerReceipt,
} from "@/components/Receipts/PaymentReceiptPrint";

/**
 * The customer-receipt register - the second half of the Receipts page.
 *
 * AI Agent Note - the other tab lists till SALES (`DC-/STR…`, printed under the shop letterhead).
 * This table lists money RECEIVED against an invoice (`RCPT-…`, printed under the letterhead of
 * the VAT company that issued it). The two sequences are independent counters, so a
 * `DC-…-0004` and a `RCPT-…-0004` are NOT "the same number done twice" - the prefix is the
 * document type, and it is shown on every row.
 *
 * Nothing here edits money: a wrong receipt is voided in Receivables and stays visible here with
 * a Voided badge, so the paper trail remains complete.
 */

interface ReceiptListResponse {
  receipts: CustomerReceipt[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    receiptCount: number;
    receivedTotal: number;
    voidedCount: number;
  };
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  DIGITAL_WALLET: "Digital wallet",
  OTHER: "Other",
};

type StatusFilter = "all" | "active" | "voided";

interface CustomerReceiptsPanelProps {
  /** The Company Profile letterhead - the fallback for a receipt of a retail invoice. */
  company?: CompanyHeader | null;
}

export function CustomerReceiptsPanel({ company }: CustomerReceiptsPanelProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [method, setMethod] = useState<string>("all");

  const receiptsQuery = useQuery({
    queryKey: ["/api/invoice-payments", search, status, method],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search.trim()) params.append("search", search.trim());
      if (status !== "all") params.append("status", status);
      if (method !== "all") params.append("method", method);
      params.append("limit", "200");

      const response = await fetch(`/api/invoice-payments?${params.toString()}`, {
        credentials: "include",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load customer receipts");
      }

      return (await response.json()) as ReceiptListResponse;
    },
  });

  const receipts = useMemo(() => receiptsQuery.data?.receipts ?? [], [receiptsQuery.data]);
  const summary = receiptsQuery.data?.summary;

  const handlePrint = (receipt: CustomerReceipt) => {
    try {
      // Throws (CompanyHeaderError) when the issuing letterhead is incomplete - the receipt is
      // then blocked instead of printed with blanks where the company name should be.
      if (!printPaymentReceipt(receipt, company)) {
        toast({
          title: "Pop-up blocked",
          description: "Allow pop-ups for this site, then print the receipt again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Cannot print this receipt",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Customer Receipts
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Money received against invoices - one row per <code>RCPT-</code> document, printed
            under the company that issued the invoice.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="flex-1">
              <SearchInput
                placeholder="Search receipt no., invoice no., customer or reference..."
                value={search}
                onValueChange={setSearch}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All receipts</SelectItem>
                  <SelectItem value="active">Active only</SelectItem>
                  <SelectItem value="voided">Voided only</SelectItem>
                </SelectContent>
              </Select>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue placeholder="Payment method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All methods</SelectItem>
                  {PAYMENT_METHODS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PAYMENT_METHOD_LABELS[value] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => receiptsQuery.refetch()}
                disabled={receiptsQuery.isFetching}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${receiptsQuery.isFetching ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{summary?.receiptCount ?? 0}</span>{" "}
              receipt{(summary?.receiptCount ?? 0) === 1 ? "" : "s"}
            </span>
            <span>
              Received:{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(summary?.receivedTotal ?? 0)}
              </span>
            </span>
            <span>
              Voided:{" "}
              <span className="font-medium text-foreground">{summary?.voidedCount ?? 0}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {receiptsQuery.isLoading ? (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">Loading customer receipts...</p>
            </div>
          ) : receiptsQuery.isError ? (
            <div className="text-center py-8">
              <Ban className="h-10 w-10 mx-auto mb-3 text-destructive" />
              <p className="font-medium">Customer receipts could not be loaded</p>
              <p className="text-sm text-muted-foreground">
                {receiptsQuery.error instanceof Error
                  ? receiptsQuery.error.message
                  : "Unknown error"}
              </p>
            </div>
          ) : receipts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Wallet className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No customer receipts found</p>
              <p className="text-sm">
                Record a payment on an invoice in Receivables and its <code>RCPT-</code> document
                appears here.
              </p>
            </div>
          ) : (
            <>
              <Table className="table-actions-sticky min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Issued by</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((receipt) => (
                  <TableRow key={receipt.id} className={receipt.voided ? "opacity-70" : ""}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {receipt.receiptNumber}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(receipt.paidAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="font-medium">{receipt.invoice.invoiceNumber}</div>
                      <div className="text-xs text-muted-foreground">
                        {receipt.invoice.source === "SALES_ORDER"
                          ? `Sales order · ${receipt.invoice.orderNumber ?? "—"}`
                          : "Till sale"}
                      </div>
                    </TableCell>
                    <TableCell>{receipt.invoice.buyerName || "Walk-in customer"}</TableCell>
                    <TableCell>
                      {receipt.invoice.vatCompany ? (
                        <div>
                          <div>{receipt.invoice.vatCompany.name}</div>
                          <div className="text-xs text-muted-foreground">
                            Tax ID {receipt.invoice.vatCompany.taxId}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Shop (retail)</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {PAYMENT_METHOD_LABELS[receipt.paymentMethod] ?? receipt.paymentMethod}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <span className={receipt.voided ? "line-through" : "font-medium"}>
                        {formatCurrency(receipt.amount)}
                      </span>
                      <div className="text-xs text-muted-foreground">
                        Balance {formatCurrency(receipt.balanceAfter)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {receipt.voided ? (
                        <Badge variant="secondary" className="gap-1">
                          <Ban className="h-3 w-3" /> Voided
                        </Badge>
                      ) : (
                        <Badge variant="success" className="gap-1">
                          <Receipt className="h-3 w-3" /> Received
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePrint(receipt)}
                        title="Print this receipt"
                      >
                        <Printer className="h-4 w-4" />
                        <span className="sr-only">Print {receipt.receiptNumber}</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              </Table>

              {/* The register is paged at 200 rows; say so rather than silently dropping the rest. */}
              {(receiptsQuery.data?.total ?? 0) > receipts.length && (
                <p className="pt-3 text-xs text-muted-foreground">
                  Showing the {receipts.length} most recent of {receiptsQuery.data?.total} receipts
                  - narrow the search to see the rest.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default CustomerReceiptsPanel;
