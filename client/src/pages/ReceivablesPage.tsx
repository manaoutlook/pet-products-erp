import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatDate, formatDateTime } from "@/utils/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { SearchInput } from "@/components/ui/search-input";
import { vietnamDayOf } from "@shared/vietnam-day";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  Ban,
  Banknote,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  Receipt,
  RefreshCw,
  Wallet,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { PendingAttachmentPicker } from "@/components/attachments/AttachmentUploader";
import { AttachmentsButton } from "@/components/attachments/AttachmentsDialog";
import { uploadAttachmentFiles } from "@/components/attachments/attachment-api";
import { PAYMENT_METHODS, type PaymentMethod } from "@shared/invoice-payment";
import type { InvoiceKind, InvoiceSource, InvoiceStatus } from "@shared/invoice-payment";

/**
 * Receivables - what customers still owe us.
 *
 * AI Agent Note - one invoice is one sale (or one Sales Order VAT invoice), and it may be settled
 * by several receipts. This page reads the register written by `server/invoices.ts` and only ever
 * adds money or voids it: an amount, a date or a buyer on an issued invoice is a snapshot and is
 * never edited here. A mistake is a void (receipt) or a cancel (invoice), both of which keep the
 * who/when/why so a tax inspector can still follow the paper trail.
 */

interface InvoicePaymentRow {
  id: number;
  receiptNumber: string;
  amount: number;
  paymentMethod: string;
  reference: string | null;
  notes: string | null;
  paidAt: string;
  voided: boolean;
  voidReason: string | null;
  voidedAt: string | null;
  receivedByUser?: { id: number; username: string } | null;
}

interface InvoiceRow {
  id: number;
  invoiceNumber: string;
  kind: InvoiceKind;
  source: InvoiceSource;
  buyerName: string;
  storeId: number | null;
  issuedAt: string;
  dueDate: string;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  status: InvoiceStatus;
  statusLabel: string;
  daysPastDue: number;
  agingBucket: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  payments: InvoicePaymentRow[];
  store?: { id: number; name: string } | null;
  customerProfile?: { id: number; companyName: string | null } | null;
  salesTransaction?: { id: number; invoiceNumber: string } | null;
  salesOrder?: { id: number; orderNumber: string } | null;
}

interface InvoiceListResponse {
  invoices: InvoiceRow[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    invoiceCount: number;
    totalInvoiced: number;
    totalPaid: number;
    totalOutstanding: number;
    overdueAmount: number;
    counts: Record<InvoiceStatus, number>;
  };
  aging: Array<{ key: string; label: string; amount: number; count: number }>;
}

const STATUS_BADGE: Record<InvoiceStatus, { variant: "success" | "info" | "warning" | "destructive" | "secondary"; icon: typeof Clock }> = {
  issued: { variant: "info", icon: Clock },
  partially_paid: { variant: "warning", icon: Wallet },
  paid: { variant: "success", icon: CheckCircle2 },
  overdue: { variant: "destructive", icon: AlertCircle },
  cancelled: { variant: "secondary", icon: Ban },
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  DIGITAL_WALLET: "Digital wallet",
  OTHER: "Other",
};

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || "Request failed") as Error & { suggestion?: string };
    error.suggestion = body.suggestion;
    throw error;
  }
  return body;
}

/**
 * The Vietnamese day to prefill in "paid on".
 *
 * A receipt typed at 06:30 must default to today in Vietnam, not to the UTC day, which is still
 * yesterday until 07:00 - otherwise the cashier posts the money into the previous day's takings.
 */
function todayIso() {
  return vietnamDayOf(new Date()) || new Date().toISOString().slice(0, 10);
}

function StatusBadge({ status, label }: { status: InvoiceStatus; label: string }) {
  const { variant, icon: Icon } = STATUS_BADGE[status] ?? STATUS_BADGE.issued;
  return (
    <Badge variant={variant} className="gap-1 whitespace-nowrap">
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function ReceivablesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canRecordMoney = hasPermission("receipts", "update");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("outstanding");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const [detailId, setDetailId] = useState<number | null>(null);
  const [recordPaymentFor, setRecordPaymentFor] = useState<InvoiceRow | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(todayIso());
  const [notes, setNotes] = useState("");
  // Bank-transfer screenshots / photos of the signed receipt, picked before the receipt exists.
  const [paymentDocuments, setPaymentDocuments] = useState<File[]>([]);

  // A void and a cancel both need a written reason, so they share one little dialog.
  const [reasonAction, setReasonAction] = useState<
    | { kind: "void"; paymentId: number; receiptNumber: string }
    | { kind: "cancel"; invoiceId: number; invoiceNumber: string }
    | null
  >(null);
  const [reason, setReason] = useState("");

  const listQuery = useQuery<InvoiceListResponse>({
    queryKey: ["/api/invoices", statusFilter, search, offset],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      params.set("limit", String(limit));
      params.set("offset", String(offset));

      const response = await fetch(`/api/invoices?${params}`, { credentials: "include" });
      return readJson(response);
    },
    enabled: hasPermission("receipts", "read"),
  });

  const detailQuery = useQuery<{ invoice: InvoiceRow }>({
    queryKey: ["/api/invoices", detailId],
    queryFn: async () => {
      const response = await fetch(`/api/invoices/${detailId}`, { credentials: "include" });
      return readJson(response);
    },
    enabled: detailId != null,
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
  };

  const recordPayment = useMutation({
    mutationFn: async () => {
      if (!recordPaymentFor) throw new Error("Choose an invoice");
      const response = await fetch(`/api/invoices/${recordPaymentFor.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          amount: Number(amount),
          paymentMethod: method,
          reference: reference.trim() || undefined,
          paidAt,
          notes: notes.trim() || undefined,
        }),
      });
      return readJson(response);
    },
    onSuccess: async (result: { receiptNumber: string; invoice: InvoiceRow; payment: { id: number } }) => {
      // The receipt exists now, so the proof of payment can be filed against it. A failed upload
      // does not void the receipt - the pictures can be added from the invoice's receipt list.
      const uploaded =
        paymentDocuments.length > 0
          ? await uploadAttachmentFiles("invoice_payment", result.payment.id, paymentDocuments)
          : null;

      toast({
        title: `Receipt ${result.receiptNumber} recorded`,
        description:
          result.invoice.balanceDue > 0
            ? `Balance still due: ${formatCurrency(result.invoice.balanceDue)}`
            : "The invoice is now fully paid.",
        variant: "success",
      });

      if (uploaded && uploaded.failures.length > 0) {
        toast({
          title: `${uploaded.failures.length} payment picture(s) were not saved`,
          description: uploaded.failures.join(" "),
          variant: "destructive",
        });
      }

      setRecordPaymentFor(null);
      setAmount("");
      setReference("");
      setNotes("");
      setPaymentDocuments([]);
      setMethod("BANK_TRANSFER");
      refreshAll();
    },
    onError: (error: Error & { suggestion?: string }) => {
      toast({
        title: "The payment was not recorded",
        description: error.suggestion ? `${error.message} - ${error.suggestion}` : error.message,
        variant: "destructive",
      });
    },
  });

  const voidReceipt = useMutation({
    mutationFn: async () => {
      if (!reasonAction || reasonAction.kind !== "void") throw new Error("Choose a receipt");
      const response = await fetch(`/api/invoice-payments/${reasonAction.paymentId}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      return readJson(response);
    },
    onSuccess: () => {
      toast({ title: "Receipt voided", description: "The invoice balance was re-opened.", variant: "success" });
      setReasonAction(null);
      setReason("");
      refreshAll();
    },
    onError: (error: Error & { suggestion?: string }) => {
      toast({
        title: "The receipt was not voided",
        description: error.suggestion ? `${error.message} - ${error.suggestion}` : error.message,
        variant: "destructive",
      });
    },
  });

  const cancelInvoiceMutation = useMutation({
    mutationFn: async ({ invoiceId, reason: cancelReason }: { invoiceId: number; reason: string }) => {
      const response = await fetch(`/api/invoices/${invoiceId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });
      return readJson(response);
    },
    onSuccess: () => {
      toast({ title: "Invoice cancelled", description: "It stays on file and owes nothing.", variant: "success" });
      setReason("");
      setDetailId(null);
      refreshAll();
    },
    onError: (error: Error & { suggestion?: string }) => {
      toast({
        title: "The invoice was not cancelled",
        description: error.suggestion ? `${error.message} - ${error.suggestion}` : error.message,
        variant: "destructive",
      });
    },
  });

  const data = listQuery.data;
  const summary = data?.summary;
  const invoices = data?.invoices ?? [];

  const openPaymentDialog = (invoice: InvoiceRow) => {
    setRecordPaymentFor(invoice);
    setAmount(invoice.balanceDue.toFixed(0));
    setPaidAt(todayIso());
    setReference("");
    setNotes("");
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Receivables</h1>
          <p className="text-sm text-muted-foreground">
            Invoices issued to customers and the money still owed on them.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => listQuery.refetch()}
          disabled={listQuery.isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${listQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Invoiced</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatCurrency(summary?.totalInvoiced ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground">{summary?.invoiceCount ?? 0} invoices</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Collected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-success">
              {formatCurrency(summary?.totalPaid ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground">{summary?.counts.paid ?? 0} fully paid</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Outstanding</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-warning">
              {formatCurrency(summary?.totalOutstanding ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {(summary?.counts.issued ?? 0) + (summary?.counts.partially_paid ?? 0)} open invoices
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Overdue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-destructive">
              {formatCurrency(summary?.overdueAmount ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {summary?.counts.overdue ?? 0} past due date
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Aging of the outstanding balance
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {(data?.aging ?? []).map((bucket) => (
            <div key={bucket.key} className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">{bucket.label}</div>
              <div className="text-lg font-semibold">{formatCurrency(bucket.amount)}</div>
              <div className="text-xs text-muted-foreground">
                {bucket.count} {bucket.count === 1 ? "invoice" : "invoices"}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-72">
          <SearchInput
            value={search}
            onValueChange={(value) => {
              setSearch(value);
              setOffset(0);
            }}
            placeholder="Invoice number, buyer or tax id"
          />
        </div>
        <Select
          value={statusFilter || "all"}
          onValueChange={(value) => {
            setStatusFilter(value === "all" ? "" : value);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="outstanding">Outstanding only</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="partially_paid">Partially paid</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-sm text-muted-foreground">
          {data ? `${data.total} invoice${data.total === 1 ? "" : "s"}` : ""}
        </div>
      </div>

      <div className="rounded-md border border-border bg-card">
        <Table className="table-actions-sticky min-w-[1100px]">
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                  No invoices match this filter.
                </TableCell>
              </TableRow>
            ) : (
              invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <div className="font-medium">{invoice.invoiceNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      {invoice.source === "SALES_ORDER"
                        ? `Sales order ${invoice.salesOrder?.orderNumber ?? ""}`
                        : (invoice.store?.name ?? "Counter sale")}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[220px] truncate">{invoice.buyerName || "-"}</div>
                    <div className="text-xs text-muted-foreground">
                      {invoice.kind === "VAT" ? "VAT invoice" : "Retail invoice"}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(invoice.issuedAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(invoice.dueDate)}
                    {invoice.daysPastDue > 0 && invoice.status !== "paid" && (
                      <div className="text-xs text-destructive">
                        {invoice.daysPastDue} day{invoice.daysPastDue === 1 ? "" : "s"} late
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(invoice.totalAmount)}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(invoice.amountPaid)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(invoice.balanceDue)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={invoice.status} label={invoice.statusLabel} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Open invoice"
                        onClick={() => setDetailId(invoice.id)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {canRecordMoney && invoice.balanceDue > 0 && invoice.status !== "cancelled" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Record a payment"
                          onClick={() => openPaymentDialog(invoice)}
                        >
                          <Banknote className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.total > data.limit && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {data.offset + 1}-{Math.min(data.offset + data.limit, data.total)} of{" "}
            {data.total}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={data.offset === 0}
              onClick={() => setOffset(Math.max(0, data.offset - data.limit))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={data.offset + data.limit >= data.total}
              onClick={() => setOffset(data.offset + data.limit)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* One invoice, its receipts, and the two corrections a clerk is allowed to make. */}
      <Dialog open={detailId != null} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              {detailQuery.data?.invoice.invoiceNumber ?? "Invoice"}
            </DialogTitle>
            <DialogDescription>
              Issued once and never rewritten - a receipt only moves the balance.
            </DialogDescription>
          </DialogHeader>

          {detailQuery.isLoading || !detailQuery.data ? (
            <div className="py-10 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            (() => {
              const invoice = detailQuery.data.invoice;
              return (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Buyer</div>
                      <div className="font-medium">{invoice.buyerName || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Status</div>
                      <StatusBadge status={invoice.status} label={invoice.statusLabel} />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Issued</div>
                      <div>{formatDateTime(invoice.issuedAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Due</div>
                      <div>{formatDate(invoice.dueDate)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Subtotal</div>
                      <div>{formatCurrency(invoice.subtotal)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        VAT ({(invoice.vatRate * 100).toFixed(2)}%)
                      </div>
                      <div>{formatCurrency(invoice.vatAmount)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Total</div>
                      <div className="font-semibold">{formatCurrency(invoice.totalAmount)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Balance due</div>
                      <div className="font-semibold text-warning">
                        {formatCurrency(invoice.balanceDue)}
                      </div>
                    </div>
                  </div>

                  {invoice.cancelReason && (
                    <div className="rounded-md border border-destructive/30 bg-destructive-subtle p-3 text-sm text-destructive-subtle-foreground">
                      Cancelled: {invoice.cancelReason}
                    </div>
                  )}

                  <Separator />

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold">Receipts</h3>
                      {canRecordMoney &&
                        invoice.balanceDue > 0 &&
                        invoice.status !== "cancelled" && (
                          <Button size="sm" onClick={() => openPaymentDialog(invoice)}>
                            <Banknote className="h-4 w-4 mr-2" />
                            Record payment
                          </Button>
                        )}
                    </div>

                    {invoice.payments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No money has been recorded against this invoice.
                      </p>
                    ) : (
                      <div className="rounded-md border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Receipt</TableHead>
                              <TableHead>Paid</TableHead>
                              <TableHead>Method</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {invoice.payments.map((payment) => (
                              <TableRow
                                key={payment.id}
                                className={payment.voided ? "opacity-60" : undefined}
                              >
                                <TableCell>
                                  <div className="font-medium">{payment.receiptNumber}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {payment.voided
                                      ? `Voided${payment.voidReason ? `: ${payment.voidReason}` : ""}`
                                      : `By ${payment.receivedByUser?.username ?? "-"}`}
                                  </div>
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                  {formatDate(payment.paidAt)}
                                </TableCell>
                                <TableCell>
                                  {PAYMENT_METHOD_LABELS[payment.paymentMethod] ??
                                    payment.paymentMethod}
                                  {payment.reference ? (
                                    <div className="text-xs text-muted-foreground">
                                      {payment.reference}
                                    </div>
                                  ) : null}
                                </TableCell>
                                <TableCell className="text-right">
                                  {formatCurrency(payment.amount)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    {/* Proof pictures of the money: the bank screenshot or the
                                        signed paper receipt. */}
                                    <AttachmentsButton
                                      entityType="invoice_payment"
                                      entityId={payment.id}
                                      label={`Receipt ${payment.receiptNumber}`}
                                    />
                                    {canRecordMoney && !payment.voided && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          setReason("");
                                          setReasonAction({
                                            kind: "void",
                                            paymentId: payment.id,
                                            receiptNumber: payment.receiptNumber,
                                          });
                                        }}
                                      >
                                        <XCircle className="h-4 w-4 mr-1" />
                                        Void
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>

                  {canRecordMoney &&
                    invoice.status !== "cancelled" &&
                    invoice.amountPaid === 0 && (
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setReason("");
                            setReasonAction({
                              kind: "cancel",
                              invoiceId: invoice.id,
                              invoiceNumber: invoice.invoiceNumber,
                            });
                          }}
                          title="Cancel the whole invoice - only possible while no money is recorded"
                        >
                          <Ban className="h-4 w-4 mr-2" />
                          Cancel invoice
                        </Button>
                      </div>
                    )}
                </div>
              );
            })()
          )}
        </DialogContent>
      </Dialog>

      {/* Record a receipt against one invoice. The amount can be anything up to the balance. */}
      <Dialog
        open={recordPaymentFor != null}
        onOpenChange={(open) => {
          if (!open) {
            setRecordPaymentFor(null);
            setPaymentDocuments([]);
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              {recordPaymentFor
                ? `${recordPaymentFor.invoiceNumber} - balance ${formatCurrency(
                    recordPaymentFor.balanceDue
                  )}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="receivable-amount">Amount received</Label>
              <Input
                id="receivable-amount"
                type="number"
                min={0}
                max={recordPaymentFor?.balanceDue ?? 0}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Never more than the outstanding balance - collect the rest with another receipt.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Method</Label>
                <Select value={method} onValueChange={(value) => setMethod(value as PaymentMethod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {PAYMENT_METHOD_LABELS[value] ?? value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="receivable-paid-at">Received on</Label>
                <Input
                  id="receivable-paid-at"
                  type="date"
                  value={paidAt}
                  onChange={(event) => setPaidAt(event.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="receivable-reference">Reference</Label>
              <Input
                id="receivable-reference"
                placeholder="Bank slip / transfer reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </div>
            <PendingAttachmentPicker
              files={paymentDocuments}
              onFilesChange={setPaymentDocuments}
              label="Payment proof"
              description="Screenshot the bank transfer or photograph the signed receipt - up to 10 pictures, 5 MB each. They are filed with this receipt when you record it."
              disabled={recordPayment.isPending}
            />
            <div>
              <Label htmlFor="receivable-notes">Notes</Label>
              <Textarea
                id="receivable-notes"
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordPaymentFor(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => recordPayment.mutate()}
              disabled={
                recordPayment.isPending ||
                !amount ||
                Number(amount) <= 0 ||
                Number(amount) > (recordPaymentFor?.balanceDue ?? 0)
              }
            >
              {recordPayment.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Banknote className="h-4 w-4 mr-2" />
              )}
              Record receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* A void or a cancel without a written reason is not auditable, so the reason is required. */}
      <Dialog open={reasonAction != null} onOpenChange={(open) => !open && setReasonAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reasonAction?.kind === "void" ? "Void this receipt" : "Cancel this invoice"}
            </DialogTitle>
            <DialogDescription>
              {reasonAction?.kind === "void"
                ? `${reasonAction.receiptNumber} stays on file; the balance it settled becomes due again.`
                : `${reasonAction?.invoiceNumber ?? "The invoice"} stays on file and owes nothing. An invoice with receipts cannot be cancelled.`}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="receivable-reason">Reason</Label>
            <Textarea
              id="receivable-reason"
              rows={3}
              value={reason}
              placeholder="e.g. customer paid the wrong amount"
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonAction(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || voidReceipt.isPending || cancelInvoiceMutation.isPending}
              onClick={() => {
                if (!reasonAction) return;
                if (reasonAction.kind === "void") {
                  voidReceipt.mutate();
                } else {
                  cancelInvoiceMutation.mutate({ invoiceId: reasonAction.invoiceId, reason });
                  setReasonAction(null);
                }
              }}
            >
              {(voidReceipt.isPending || cancelInvoiceMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {reasonAction?.kind === "void" ? "Void receipt" : "Cancel invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ReceivablesPage;
