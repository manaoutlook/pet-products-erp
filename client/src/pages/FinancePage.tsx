import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { formatCurrency, formatDate, formatDateTime } from "@/utils/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchInput } from "@/components/ui/search-input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Clock,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  ShoppingCart,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { PendingAttachmentPicker } from "@/components/attachments/AttachmentUploader";
import { AttachmentsButton } from "@/components/attachments/AttachmentsDialog";
import { uploadAttachmentFiles } from "@/components/attachments/attachment-api";
import {
  EXPENSE_CATEGORIES,
  FINANCE_ENTRY_TYPES,
  FINANCE_ENTRY_TYPE_DESCRIPTIONS,
  FINANCE_ENTRY_TYPE_LABELS,
  FUNDING_KINDS,
  FUNDING_KIND_LABELS,
  INCOME_CATEGORIES,
  categoriesForFinanceEntry,
  isFinanceEntryType,
  isPartnerEntryType,
  validatePartnerWithdrawal,
  type FinanceEntryStatus,
  type FinanceEntryType,
  type FundingKind,
} from "@shared/finance";
import { PAYMENT_METHODS, type InvoiceStatus } from "@shared/invoice-payment";
import { vietnamDayOf } from "@shared/vietnam-day";

/**
 * Finance - the money that is not a customer receipt.
 *
 * Three tabs over one book:
 *   Report   - income (invoice receipts + manual income), expenses (including the expense each
 *              purchase order posts), net profit, the purchase orders behind the supplier total,
 *              partner capital, and what customers still owe, with partially paid invoices called
 *              out.
 *   Entries  - the ledger: expenses, other income, partner deposits/withdrawals. Purchase orders
 *              add their own "Supplier purchases" entry when created. Rows are never edited or
 *              deleted: a mistake is voided with a reason and stays visible. The tab links to the
 *              receipts register, because till sales deliberately do not appear here.
 *   Partners - who has money in the company, and how much of it is still there. An administrator
 *              can correct a partner's details, or delete them once their balance is zero.
 *
 * Invoice receipts are NOT recorded here. They belong to Receivables; this page only reads them
 * into the report, so a receipt voided there leaves income immediately. The "Money in" figure and
 * the automatic income row both link to `/receipts?tab=customer` so the owner can see the actual
 * transactions behind the total. "Money out" links back into this page as
 * `/finance?tab=entries&type=expense`, which opens the ledger already narrowed to expenses.
 * "Net profit" scrolls to the two totals it is subtracted from, and "Partner money held" opens
 * the Partners tab, so no headline figure is a dead end.
 */

interface FinanceEntryRow {
  id: number;
  entryNumber: string;
  entryType: FinanceEntryType;
  direction: "debit" | "credit";
  category: string;
  description: string;
  amount: number;
  entryDate: string;
  paymentMethod: string;
  reference: string | null;
  notes: string | null;
  partnerId: number | null;
  fundingKind: FundingKind | null;
  status: FinanceEntryStatus;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string | null;
  voided: boolean;
  partner?: { id: number; name: string } | null;
  createdByUser?: { id: number; username: string } | null;
  voidedByUser?: { id: number; username: string } | null;
}

interface FinanceEntriesResponse {
  entries: FinanceEntryRow[];
  total: number;
  limit: number;
  offset: number;
  totals: { credits: number; debits: number; net: number };
}

interface FinancePartnerRow {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  deposits: number;
  withdrawals: number;
  balance: number;
}

interface FinancePartnersResponse {
  partners: FinancePartnerRow[];
  totals: { deposits: number; withdrawals: number; balance: number; partnerCount: number };
}

interface OutstandingInvoiceRow {
  id: number;
  invoiceNumber: string;
  buyerName: string;
  status: InvoiceStatus;
  issuedAt: string;
  dueDate: string | null;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  daysPastDue: number;
  statusLabel: string;
  agingBucket: string | null;
  store?: { id: number; name: string } | null;
}

interface PurchaseOrderFinanceRow {
  id: number;
  orderNumber: string;
  orderDate: string;
  status: string;
  supplier: string;
  amount: number;
  expense: { entryNumber: string; status: string | null } | null;
}

interface FinanceSummaryResponse {
  from: string;
  to: string;
  income: {
    receipts: number;
    receiptsCount: number;
    otherIncome: number;
    total: number;
    byCategory: Array<{ category: string; amount: number; automatic: boolean }>;
  };
  expenses: {
    total: number;
    count: number;
    byCategory: Array<{ category: string; amount: number; count: number }>;
  };
  /**
   * The purchase orders behind the "Supplier purchases" expense heading. Their totals are NOT
   * added to `expenses` again - each order already posted its own expense entry - so this block is
   * a drill-down by supplier and PO, plus a warning for orders with no posted entry.
   */
  purchases: {
    total: number;
    count: number;
    recordedTotal: number;
    unrecordedCount: number;
    rows: PurchaseOrderFinanceRow[];
  };
  netProfit: number;
  cashPosition: number;
  capital: {
    deposits: number;
    withdrawals: number;
    net: number;
    balance: number;
    byPartner: Array<{
      partnerId: number | null;
      name: string;
      deposits: number;
      withdrawals: number;
      balance: number;
    }>;
    byFundingKind: Array<{
      fundingKind: FundingKind | null;
      deposits: number;
      withdrawals: number;
      balance: number;
    }>;
  };
  receivables: {
    totalOutstanding: number;
    invoiceCount: number;
    partiallyPaidAmount: number;
    partiallyPaidCount: number;
    unpaidAmount: number;
    unpaidCount: number;
    overdueAmount: number;
    overdueCount: number;
    aging: Array<{ key: string; label: string; amount: number; count: number }>;
  };
  generatedAt: string;
}


const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  DIGITAL_WALLET: "Digital wallet",
  OTHER: "Other",
};

const ENTRY_TYPE_BADGE: Record<FinanceEntryType, "success" | "destructive" | "info" | "warning"> = {
  income: "success",
  expense: "destructive",
  partner_deposit: "info",
  partner_withdrawal: "warning",
};

const INVOICE_STATUS_BADGE: Record<
  InvoiceStatus,
  { variant: "info" | "warning" | "success" | "destructive" | "secondary"; icon: typeof Clock }
> = {
  issued: { variant: "info", icon: Clock },
  partially_paid: { variant: "warning", icon: Wallet },
  paid: { variant: "success", icon: CheckCircle2 },
  overdue: { variant: "destructive", icon: AlertCircle },
  cancelled: { variant: "secondary", icon: Ban },
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

function todayIso() {
  // Vietnamese day, so the default period matches the printed cash book and the receipt register
  // (see shared/vietnam-day.ts). A UTC "today" is still yesterday until 07:00 local.
  return vietnamDayOf(new Date()) || new Date().toISOString().slice(0, 10);
}

function monthStartIso() {
  return `${todayIso().slice(0, 7)}-01`;
}

interface EntryFormState {
  entryType: FinanceEntryType;
  category: string;
  description: string;
  amount: string;
  entryDate: string;
  paymentMethod: string;
  reference: string;
  notes: string;
  partnerId: string;
  fundingKind: FundingKind;
}

function emptyEntryForm(): EntryFormState {
  return {
    entryType: "expense",
    category: EXPENSE_CATEGORIES[0],
    description: "",
    amount: "",
    entryDate: todayIso(),
    paymentMethod: "CASH",
    reference: "",
    notes: "",
    partnerId: "",
    fundingKind: "capital",
  };
}

/**
 * The edit dialog starts from the stored row rather than an empty form.
 *
 * `entryDate` comes back as `YYYY-MM-DD` (a date column, not a timestamp), which is exactly what
 * `<input type="date">` wants; the slice keeps it safe if the API ever returns an ISO timestamp.
 */
function entryToForm(entry: FinanceEntryRow): EntryFormState {
  return {
    entryType: entry.entryType,
    category: entry.category,
    description: entry.description,
    amount: String(entry.amount),
    entryDate: entry.entryDate.slice(0, 10),
    paymentMethod: entry.paymentMethod,
    reference: entry.reference ?? "",
    notes: entry.notes ?? "",
    partnerId: entry.partnerId !== null ? String(entry.partnerId) : "",
    fundingKind: entry.fundingKind ?? "capital",
  };
}

/** The body both POST and PATCH send - one shape, validated by the same route schema. */
function entryPayload(form: EntryFormState) {
  return {
    entryType: form.entryType,
    category: form.category,
    description: form.description.trim(),
    amount: Number(form.amount),
    entryDate: form.entryDate,
    paymentMethod: form.paymentMethod,
    reference: form.reference.trim() || null,
    notes: form.notes.trim() || null,
    partnerId: isPartnerEntryType(form.entryType) ? Number(form.partnerId) : null,
    fundingKind: isPartnerEntryType(form.entryType) ? form.fundingKind : null,
  };
}

function StatCard({
  title,
  value,
  hint,
  tone = "default",
  icon: Icon,
  footer,
}: {
  title: string;
  value: number;
  hint: string;
  tone?: "success" | "warning" | "destructive" | "default";
  icon?: typeof Wallet;
  /** Optional drill-down (e.g. the receipts behind a figure). */
  footer?: ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : "";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {Icon ? <Icon className="h-4 w-4" /> : null}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold ${toneClass}`}>{formatCurrency(value)}</div>
        <p className="text-xs text-muted-foreground">{hint}</p>
        {footer}
      </CardContent>
    </Card>
  );
}

/**
 * The drill-down under a headline figure.
 *
 * Every card points at the transactions - or, for net profit, at the sum - behind its number, so
 * the report is a place to start reading rather than a dead end. Same-page targets are handled
 * by the caller through `onClick`, because navigating to an identical URL does not re-run the
 * router.
 */
function StatCardLink({
  href,
  testId,
  onClick,
  children,
}: {
  href: string;
  testId: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const className =
    "mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline";
  const body = (
    <>
      {children}
      <ArrowRight className="h-3 w-3" />
    </>
  );

  /*
    A fragment target must be a plain anchor: the browser scrolls to `#id`, while the router's
    pushState would leave the reader where they are.
  */
  if (href.startsWith("#")) {
    return (
      <a href={href} onClick={onClick} data-testid={testId} className={className}>
        {body}
      </a>
    );
  }

  return (
    <Link href={href} onClick={onClick} data-testid={testId} className={className}>
      {body}
    </Link>
  );
}

function FinancePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission, isAdmin } = usePermissions();
  const canRead = hasPermission("finance", "read");
  const canCreate = hasPermission("finance", "create");
  const canVoid = hasPermission("finance", "update");
  /**
   * Editing rewrites a posted row, so it is stricter than voiding: the administrator role is
   * required on top of the `finance.update` grant, and the API enforces the same rule
   * (`requireAdmin` on PATCH /api/finance/entries/:id).
   */
  const canEdit = isAdmin && hasPermission("finance", "update");

  const [tab, setTab] = useState("report");
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());

  // Ledger filters.
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [ledgerFrom, setLedgerFrom] = useState("");
  const [ledgerTo, setLedgerTo] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  /** The posted entry being corrected; null while recording a new one. */
  const [editing, setEditing] = useState<FinanceEntryRow | null>(null);
  // The receipt/voucher pictures picked while the entry is being typed. Uploaded once the POST
  // returns the entry id - until then there is nothing in the database to attach them to.
  const [entryDocuments, setEntryDocuments] = useState<File[]>([]);
  const [form, setForm] = useState<EntryFormState>(emptyEntryForm());

  const [partnerDialogOpen, setPartnerDialogOpen] = useState(false);
  /** The partner being corrected; null while registering a new one. */
  const [editingPartner, setEditingPartner] = useState<FinancePartnerRow | null>(null);
  const [partnerName, setPartnerName] = useState("");
  const [partnerPhone, setPartnerPhone] = useState("");
  const [partnerNotes, setPartnerNotes] = useState("");

  /** The partner waiting to be deleted; null while the confirm dialog is closed. */
  const [deletingPartner, setDeletingPartner] = useState<FinancePartnerRow | null>(null);

  const [voiding, setVoiding] = useState<FinanceEntryRow | null>(null);
  const [voidReason, setVoidReason] = useState("");

  /**
   * Drill-down links land here with the ledger already narrowed down.
   *
   * The report's headline figures are the start of the trail, not the end: "Money in" points at
   * the receipts register (till sales are receipted there and never copied into this ledger),
   * and "Money out" points back at this page as `?tab=entries&type=expense`, so the total and the
   * entries behind it are one click apart.
   */
  const locationSearch = useSearch();
  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    const nextTab = params.get("tab");
    if (nextTab === "report" || nextTab === "entries" || nextTab === "partners") {
      setTab(nextTab);
    }
    const nextType = params.get("type");
    if (isFinanceEntryType(nextType)) {
      setTypeFilter(nextType);
      setOffset(0);
    }
  }, [locationSearch]);

  const summaryQuery = useQuery<FinanceSummaryResponse>({
    queryKey: ["/api/finance/summary", from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      return readJson(await fetch(`/api/finance/summary?${params}`, { credentials: "include" }));
    },
    enabled: canRead,
  });

  const outstandingQuery = useQuery<{ invoices: OutstandingInvoiceRow[] }>({
    queryKey: ["/api/finance/outstanding"],
    queryFn: async () =>
      readJson(await fetch("/api/finance/outstanding?limit=100", { credentials: "include" })),
    enabled: canRead,
  });

  const entriesQuery = useQuery<FinanceEntriesResponse>({
    queryKey: [
      "/api/finance/entries",
      search,
      typeFilter,
      statusFilter,
      ledgerFrom,
      ledgerTo,
      offset,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (typeFilter !== "all") params.set("entryType", typeFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (ledgerFrom) params.set("from", ledgerFrom);
      if (ledgerTo) params.set("to", ledgerTo);
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      return readJson(await fetch(`/api/finance/entries?${params}`, { credentials: "include" }));
    },
    enabled: canRead,
  });

  const partnersQuery = useQuery<FinancePartnersResponse>({
    queryKey: ["/api/finance/partners"],
    queryFn: async () =>
      readJson(await fetch("/api/finance/partners", { credentials: "include" })),
    enabled: canRead,
  });

  const partners = useMemo(() => partnersQuery.data?.partners ?? [], [partnersQuery.data]);
  const selectedPartner = useMemo(
    () => partners.find((partner) => String(partner.id) === form.partnerId) ?? null,
    [partners, form.partnerId]
  );

  const refreshMoney = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/finance"] });
  };

  /** Close the entry dialog and forget both the typing and which row was being corrected. */
  const closeEntryDialog = () => {
    setEntryDialogOpen(false);
    setEditing(null);
    setEntryDocuments([]);
    setForm(emptyEntryForm());
  };

  /** Open the same dialog empty (new entry) or filled in (correcting a posted one). */
  const openEntryDialog = (entry: FinanceEntryRow | null = null) => {
    setEditing(entry);
    setEntryDocuments([]);
    setForm(entry ? entryToForm(entry) : emptyEntryForm());
    setEntryDialogOpen(true);
  };

  const createEntry = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/finance/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(entryPayload(form)),
      });
      return readJson(response);
    },
    onSuccess: async (result: { entry: FinanceEntryRow }) => {
      // The entry exists now; file the voucher/receipt pictures against it. A failed upload is
      // reported but never undoes the entry - they can be added from the entries table.
      const uploaded =
        entryDocuments.length > 0
          ? await uploadAttachmentFiles("finance_entry", result.entry.id, entryDocuments)
          : null;

      toast({
        title: `${FINANCE_ENTRY_TYPE_LABELS[result.entry.entryType]} ${result.entry.entryNumber} recorded`,
        description: formatCurrency(result.entry.amount),
        variant: "success",
      });

      if (uploaded && uploaded.failures.length > 0) {
        toast({
          title: `${uploaded.failures.length} voucher picture(s) were not saved`,
          description: uploaded.failures.join(" "),
          variant: "destructive",
        });
      }

      closeEntryDialog();
      refreshMoney();
    },
    onError: (error: Error & { suggestion?: string }) => {
      toast({
        title: "The entry was not recorded",
        description: error.suggestion ? `${error.message} - ${error.suggestion}` : error.message,
        variant: "destructive",
      });
    },
  });

  /**
   * Save a corrected entry. PATCH, not POST: the entry number stays, the totals drop the old
   * amount and pick up the new one in the same refresh.
   */
  const updateEntry = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("Choose an entry to edit");
      const response = await fetch(`/api/finance/entries/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(entryPayload(form)),
      });
      return readJson(response);
    },
    onSuccess: (result: { entry: FinanceEntryRow }) => {
      toast({
        title: `${FINANCE_ENTRY_TYPE_LABELS[result.entry.entryType]} ${result.entry.entryNumber} updated`,
        description: formatCurrency(result.entry.amount),
        variant: "success",
      });
      closeEntryDialog();
      refreshMoney();
    },
    onError: (error: Error & { suggestion?: string }) => {
      toast({
        title: "The entry was not updated",
        description: error.suggestion ? `${error.message} - ${error.suggestion}` : error.message,
        variant: "destructive",
      });
    },
  });

  /** Open the partner dialog empty (new partner) or filled in (correcting one). */
  const openPartnerDialog = (partner: FinancePartnerRow | null = null) => {
    setEditingPartner(partner);
    setPartnerName(partner?.name ?? "");
    setPartnerPhone(partner?.phone ?? "");
    setPartnerNotes(partner?.notes ?? "");
    setPartnerDialogOpen(true);
  };

  const closePartnerDialog = () => {
    setPartnerDialogOpen(false);
    setEditingPartner(null);
    setPartnerName("");
    setPartnerPhone("");
    setPartnerNotes("");
  };

  const partnerPayload = () => ({
    name: partnerName.trim(),
    phone: partnerPhone.trim() || null,
    notes: partnerNotes.trim() || null,
  });

  const createPartner = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/finance/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(partnerPayload()),
      });
      return readJson(response);
    },
    onSuccess: (result: { partner: FinancePartnerRow }) => {
      toast({ title: `${result.partner.name} added`, variant: "success" });
      closePartnerDialog();
      refreshMoney();
    },
    onError: (error: Error & { suggestion?: string }) => {
      toast({
        title: "The partner was not added",
        description: error.suggestion ? `${error.message} - ${error.suggestion}` : error.message,
        variant: "destructive",
      });
    },
  });

  /** Correct a partner's details. PATCH: the money rows stay, only the label changes. */
  const updatePartner = useMutation({
    mutationFn: async () => {
      if (!editingPartner) throw new Error("Choose a partner to edit");
      const response = await fetch(`/api/finance/partners/${editingPartner.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(partnerPayload()),
      });
      return readJson(response);
    },
    onSuccess: (result: { partner: FinancePartnerRow }) => {
      toast({ title: `${result.partner.name} updated`, variant: "success" });
      closePartnerDialog();
      refreshMoney();
    },
    onError: (error: Error & { suggestion?: string }) => {
      toast({
        title: "The partner was not updated",
        description: error.suggestion ? `${error.message} - ${error.suggestion}` : error.message,
        variant: "destructive",
      });
    },
  });

  /**
   * Delete a partner. The API refuses while their balance is not zero, so the dialog says what is
   * still held rather than hiding the button - the administrator sees why it cannot go yet.
   */
  const deletePartner = useMutation({
    mutationFn: async () => {
      if (!deletingPartner) throw new Error("Choose a partner to delete");
      const response = await fetch(`/api/finance/partners/${deletingPartner.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      return readJson(response);
    },
    onSuccess: (result: { name: string; deletedEntries: string[] }) => {
      toast({
        title: `${result.name} deleted`,
        description:
          result.deletedEntries.length > 0
            ? `${result.deletedEntries.length} money entr${
                result.deletedEntries.length === 1 ? "y" : "ies"
              } recorded for them went too.`
            : "They had no money entries left in the book.",
        variant: "success",
      });
      setDeletingPartner(null);
      refreshMoney();
    },
    onError: (error: Error & { suggestion?: string }) => {
      toast({
        title: "The partner was not deleted",
        description: error.suggestion ? `${error.message} - ${error.suggestion}` : error.message,
        variant: "destructive",
      });
    },
  });

  const voidEntry = useMutation({
    mutationFn: async () => {
      if (!voiding) throw new Error("Choose an entry");
      const response = await fetch(`/api/finance/entries/${voiding.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: voidReason.trim() }),
      });
      return readJson(response);
    },
    onSuccess: () => {
      toast({
        title: "Entry voided",
        description: "It stays in the book and no longer counts in any total.",
        variant: "success",
      });
      setVoiding(null);
      setVoidReason("");
      refreshMoney();
    },
    onError: (error: Error & { suggestion?: string }) => {
      toast({
        title: "The entry was not voided",
        description: error.suggestion ? `${error.message} - ${error.suggestion}` : error.message,
        variant: "destructive",
      });
    },
  });

  /**
   * Pre-flight the partner balance before submitting. When editing a withdrawal, its own amount is
   * still deducted from the partner balance, so it is added back here - matching what the server
   * does (it removes the old contribution before applying the new one).
   */
  const withdrawalCheck: { valid: boolean; error?: string; suggestion?: string } =
    form.entryType === "partner_withdrawal" && selectedPartner
      ? validatePartnerWithdrawal(
          Number(form.amount) || 0,
          selectedPartner.balance +
            (editing &&
            editing.entryType === "partner_withdrawal" &&
            editing.partnerId === selectedPartner.id
              ? editing.amount
              : 0)
        )
      : { valid: true };

  const categories = isPartnerEntryType(form.entryType)
    ? []
    : categoriesForFinanceEntry(form.entryType);

  const canSubmitEntry =
    (editing ? canEdit : canCreate) &&
    form.amount.trim() !== "" &&
    Number(form.amount) > 0 &&
    form.description.trim() !== "" &&
    form.category.trim() !== "" &&
    (!isPartnerEntryType(form.entryType) || form.partnerId !== "") &&
    withdrawalCheck.valid;

  const setEntryType = (entryType: FinanceEntryType) => {
    setForm((current) => ({
      ...current,
      entryType,
      category: isPartnerEntryType(entryType)
        ? FINANCE_ENTRY_TYPE_LABELS[entryType]
        : categoriesForFinanceEntry(entryType)[0],
      partnerId: isPartnerEntryType(entryType) ? current.partnerId : "",
    }));
  };

  const summary = summaryQuery.data;
  const outstandingInvoices = outstandingQuery.data?.invoices ?? [];
  const entriesData = entriesQuery.data;
  const entries = entriesData?.entries ?? [];
  const partnersData = partnersQuery.data;


  const isLoadingReport = summaryQuery.isLoading;
  const reportError = summaryQuery.error as (Error & { suggestion?: string }) | null;

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Finance</h1>
          <p className="text-sm text-muted-foreground">
            Manual expenses, other income and partner money - customer receipts are read in from
            Receivables.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshMoney}
            disabled={summaryQuery.isFetching || entriesQuery.isFetching}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${summaryQuery.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          {/*
            Printing is a separate screen on purpose: the report above is an on-screen summary,
            while /finance/ledger builds the printable cash book and customer statements from the
            same receipts and entries. The period carries over so the paper matches the screen.
          */}
          <Button variant="outline" size="sm" asChild>
            <Link href={`/finance/ledger?from=${from}&to=${to}`}>
              <Printer className="mr-2 h-4 w-4" />
              Print ledger
            </Link>
          </Button>
          {canCreate ? (
            <Button size="sm" onClick={() => openEntryDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              New entry
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="entries">Manual entries</TabsTrigger>
          <TabsTrigger value="partners">Partners</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------------ Report */}
        <TabsContent value="report" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="finance-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="finance-from"
                type="date"
                value={from}
                max={to}
                onChange={(event) => setFrom(event.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="finance-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="finance-to"
                type="date"
                value={to}
                min={from}
                onChange={(event) => setTo(event.target.value)}
                className="w-40"
              />
            </div>
            {summary ? (
              <p className="pb-2 text-xs text-muted-foreground">
                Generated {formatDateTime(summary.generatedAt)}
              </p>
            ) : null}
          </div>

          {reportError ? (
            <Card className="border-destructive/40">
              <CardContent className="flex items-start gap-3 pt-6">
                <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
                <div>
                  <p className="font-medium">{reportError.message}</p>
                  {reportError.suggestion ? (
                    <p className="text-sm text-muted-foreground">{reportError.suggestion}</p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {isLoadingReport ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : summary ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  title="Money in"
                  value={summary.income.total}
                  tone="success"
                  icon={ArrowDownLeft}
                  hint={`${summary.income.receiptsCount} customer ${
                    summary.income.receiptsCount === 1 ? "receipt" : "receipts"
                  } · ${formatCurrency(summary.income.otherIncome)} other income`}
                  footer={
                    <StatCardLink href="/receipts?tab=customer" testId="money-in-receipts-link">
                      View customer receipts
                    </StatCardLink>
                  }
                />
                <StatCard
                  title="Money out"
                  value={summary.expenses.total}
                  tone="destructive"
                  icon={ArrowUpRight}
                  hint={`${summary.expenses.count} expense ${
                    summary.expenses.count === 1 ? "entry" : "entries"
                  }`}
                  footer={
                    <StatCardLink
                      href="/finance?tab=entries&type=expense"
                      testId="money-out-entries-link"
                      /*
                        Set the tab and filter directly as well as navigating: the target is this
                        same page, and re-clicking a link whose URL has not changed would otherwise
                        leave a filter the owner had cleared in place.
                      */
                      onClick={() => {
                        setTab("entries");
                        setTypeFilter("expense");
                        setOffset(0);
                      }}
                    >
                      View expense entries
                    </StatCardLink>
                  }
                />
                <StatCard
                  title="Net profit"
                  value={summary.netProfit}
                  tone={summary.netProfit >= 0 ? "success" : "destructive"}
                  hint="Money in minus expenses (partner money excluded)"
                  footer={
                    <StatCardLink href="#profit-breakdown" testId="net-profit-breakdown-link">
                      See how it is worked out
                    </StatCardLink>
                  }
                />
                <StatCard
                  title="Partner money held"
                  value={summary.capital.balance}
                  tone="warning"
                  icon={Landmark}
                  hint={`${formatCurrency(summary.capital.deposits)} in · ${formatCurrency(
                    summary.capital.withdrawals
                  )} out`}
                  footer={
                    <StatCardLink
                      href="/finance?tab=partners"
                      testId="partner-balances-link"
                      onClick={() => setTab("partners")}
                    >
                      View partner balances
                    </StatCardLink>
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Cash position (money in + partner deposits − expenses − partner withdrawals):{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(summary.cashPosition)}
                </span>
              </p>
            </>
          ) : null}


          {/* Receivables vs payables: what customers still owe, partially paid called out. */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Wallet className="h-4 w-4" />
                  Outstanding receivables
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-2xl font-semibold text-warning">
                  {formatCurrency(summary?.receivables.totalOutstanding ?? 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {summary?.receivables.invoiceCount ?? 0} open invoices ·{" "}
                  {formatCurrency(summary?.receivables.overdueAmount ?? 0)} overdue
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-warning/40 bg-warning-subtle p-3">
                    <div className="text-xs text-warning-subtle-foreground">Partially paid</div>
                    <div className="text-lg font-semibold">
                      {formatCurrency(summary?.receivables.partiallyPaidAmount ?? 0)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {summary?.receivables.partiallyPaidCount ?? 0} invoices still owe part of
                      their total
                    </div>
                  </div>
                  <div className="rounded-md border border-border p-3">
                    <div className="text-xs text-muted-foreground">Not paid at all</div>
                    <div className="text-lg font-semibold">
                      {formatCurrency(summary?.receivables.unpaidAmount ?? 0)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {summary?.receivables.unpaidCount ?? 0} invoices
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Aging of the outstanding balance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(summary?.receivables.aging ?? []).map((bucket) => (
                  <div
                    key={bucket.key}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                  >
                    <span className="text-sm">{bucket.label}</span>
                    <span className="text-sm font-medium">{formatCurrency(bucket.amount)}</span>
                    <span className="text-xs text-muted-foreground">
                      {bucket.count} {bucket.count === 1 ? "invoice" : "invoices"}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>


          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" />
                Invoices still owing - partially paid highlighted
              </CardTitle>
            </CardHeader>
            <CardContent>
              {outstandingQuery.isLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : outstandingInvoices.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  No invoice is outstanding. Every issued invoice is fully paid or cancelled.
                </p>
              ) : (
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Buyer</TableHead>
                      <TableHead>Issued</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Still owed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outstandingInvoices.map((invoice) => {
                      const badge =
                        INVOICE_STATUS_BADGE[invoice.status] ?? INVOICE_STATUS_BADGE.issued;
                      const BadgeIcon = badge.icon;
                      const partiallyPaid = invoice.status === "partially_paid";
                      return (
                        <TableRow
                          key={invoice.id}
                          className={partiallyPaid ? "bg-warning-subtle/60" : undefined}
                        >
                          <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                          <TableCell>{invoice.buyerName}</TableCell>
                          <TableCell>{formatDate(invoice.issuedAt)}</TableCell>
                          <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                          <TableCell>
                            <Badge variant={badge.variant} className="gap-1 whitespace-nowrap">
                              <BadgeIcon className="h-3 w-3" />
                              {invoice.statusLabel}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(invoice.totalAmount)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(invoice.amountPaid)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCurrency(invoice.balanceDue)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>


          {/* Net profit is worked out here, so "Net profit" above links down to this block. */}
          <div id="profit-breakdown" className="scroll-mt-24 space-y-2">
            <p className="text-xs text-muted-foreground">
              Net profit is the two totals below subtracted: total money in minus total expenses.
              Partner deposits and withdrawals move money around but are not profit.
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Where the money came in
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Customer receipts are recorded in Receivables and read into this report - they
                    are never typed into the manual entries ledger.
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(summary?.income.byCategory ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing recorded in this period.</p>
                  ) : (
                    summary?.income.byCategory.map((row) => {
                      /*
                        The automatic row is the money the receivables module already recorded.
                        It links to the register that holds those receipts instead of pretending
                        they are a hand-typed entry.
                      */
                      const body = (
                        <>
                          <span className="flex items-center gap-2">
                            {row.category}
                            {row.automatic ? (
                              <Badge variant="secondary" className="text-[10px]">
                                from invoices
                              </Badge>
                            ) : null}
                          </span>
                          <span className="flex items-center gap-1 font-medium">
                            {formatCurrency(row.amount)}
                            {row.automatic ? (
                              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : null}
                          </span>
                        </>
                      );

                      return row.automatic ? (
                        <Link
                          key={row.category}
                          href="/receipts?tab=customer"
                          data-testid="income-receipts-link"
                          className="-mx-1 flex items-center justify-between gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-muted/60"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div
                          key={row.category}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          {body}
                        </div>
                      );
                    })
                  )}
                  <Separator />
                  <div className="flex items-center justify-between text-sm font-semibold">
                    <span>Total money in</span>
                    <span>{formatCurrency(summary?.income.total ?? 0)}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Where the money went
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    A purchase order posts a "Supplier purchases" entry when it is created; every
                    other expense is a manual entry. Nothing is inferred from payments.
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(summary?.expenses.byCategory ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No expenses in this period.</p>
                  ) : (
                    summary?.expenses.byCategory.map((row) => (
                      <div key={row.category} className="flex items-center justify-between text-sm">
                        <span>
                          {row.category}{" "}
                          <span className="text-xs text-muted-foreground">({row.count})</span>
                        </span>
                        <span className="font-medium">{formatCurrency(row.amount)}</span>
                      </div>
                    ))
                  )}
                  <Separator />
                  <div className="flex items-center justify-between text-sm font-semibold">
                    <span>Total expenses</span>
                    <span>{formatCurrency(summary?.expenses.total ?? 0)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/*
            Purchase orders: the supplier and PO number behind the "Supplier purchases" expense
            heading. The order totals are already inside "Money out" through the expense each order
            posted when it was created, so nothing here is added to the totals a second time.
          */}
          <Card data-testid="purchases-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShoppingCart className="h-4 w-4" />
                Purchases (purchase orders)
                {(summary?.purchases?.unrecordedCount ?? 0) > 0 ? (
                  <Badge variant="warning">
                    {summary?.purchases?.unrecordedCount} not in expenses
                  </Badge>
                ) : null}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                A purchase order posts a "Supplier purchases" expense for its total when it is
                created, so it is already inside "Money out" - cancelling the order voids that
                entry. The orders below name the supplier and PO behind that heading; their totals
                are not added a second time.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {(summary?.purchases?.rows ?? []).length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  No purchase orders in this period.
                </p>
              ) : (
                <Table className="min-w-[820px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Purchase order</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Ordered</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Finance entry</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(summary?.purchases?.rows ?? []).map((row) => (
                      <TableRow key={row.id} data-testid={`purchase-row-${row.id}`}>
                        <TableCell className="font-medium">{row.orderNumber}</TableCell>
                        <TableCell>{row.supplier}</TableCell>
                        <TableCell>{formatDate(row.orderDate)}</TableCell>
                        <TableCell className="capitalize">{row.status}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.amount)}</TableCell>
                        <TableCell>
                          {row.expense?.status === "posted" ? (
                            <Badge variant="success" className="gap-1 whitespace-nowrap">
                              <CheckCircle2 className="h-3 w-3" />
                              {row.expense.entryNumber}
                            </Badge>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-warning">
                              <AlertCircle className="h-3.5 w-3.5" />
                              {row.expense ? "Expense voided" : "Not in expenses"}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Separator />
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  {summary?.purchases?.count ?? 0}{" "}
                  {(summary?.purchases?.count ?? 0) === 1 ? "order" : "orders"} ·{" "}
                  {formatCurrency(summary?.purchases?.recordedTotal ?? 0)} recorded as expenses
                </span>
                <span className="font-semibold">
                  Total purchases: {formatCurrency(summary?.purchases?.total ?? 0)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Partner money by kind
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {(summary?.capital.byFundingKind ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No partner money in the book yet.</p>
              ) : (
                summary?.capital.byFundingKind.map((row) => (
                  <div
                    key={row.fundingKind ?? "unknown"}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="text-xs text-muted-foreground">
                      {row.fundingKind ? FUNDING_KIND_LABELS[row.fundingKind] : "Unknown"}
                    </div>
                    <div className="text-lg font-semibold">{formatCurrency(row.balance)}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatCurrency(row.deposits)} in · {formatCurrency(row.withdrawals)} out
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>


        {/* ----------------------------------------------------------------- Entries */}
        <TabsContent value="entries" className="space-y-4">
          <p className="text-sm text-muted-foreground" data-testid="entries-ledger-note">
            This ledger holds expenses, other income, and money partners put in or take out.
            Purchase orders add their own "Supplier purchases" expense when they are created -
            cancelling an order voids it - and everything else is{" "}
            <span className="font-medium text-foreground">manual</span>. Till sales and invoice
            payments are receipted in Receivables and counted in the Report's "Money in" - they are
            never copied here, so nothing is counted twice.{" "}
            <Link
              href="/receipts?tab=customer"
              className="font-medium text-primary hover:underline"
            >
              See the customer receipts register
            </Link>
            .
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-full sm:w-64">
              <SearchInput
                value={search}
                onValueChange={(value) => {
                  setSearch(value);
                  setOffset(0);
                }}
                placeholder="Search number, description, reference"
              />
            </div>
            <Select
              value={typeFilter}
              onValueChange={(value) => {
                setTypeFilter(value);
                setOffset(0);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {FINANCE_ENTRY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {FINANCE_ENTRY_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                setOffset(0);
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="posted">Posted</SelectItem>
                <SelectItem value="voided">Voided</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              aria-label="Entries from"
              value={ledgerFrom}
              onChange={(event) => {
                setLedgerFrom(event.target.value);
                setOffset(0);
              }}
              className="w-40"
            />
            <Input
              type="date"
              aria-label="Entries to"
              value={ledgerTo}
              onChange={(event) => {
                setLedgerTo(event.target.value);
                setOffset(0);
              }}
              className="w-40"
            />
            {canCreate ? (
              <Button className="ml-auto" onClick={() => openEntryDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                New entry
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              Money in:{" "}
              <span className="font-medium text-success">
                {formatCurrency(entriesData?.totals.credits ?? 0)}
              </span>
            </span>
            <span>
              Money out:{" "}
              <span className="font-medium text-destructive">
                {formatCurrency(entriesData?.totals.debits ?? 0)}
              </span>
            </span>
            <span>
              Net: <span className="font-medium">{formatCurrency(entriesData?.totals.net ?? 0)}</span>
            </span>
            <span className="text-muted-foreground">
              {entriesData?.total ?? 0} matching {entriesData?.total === 1 ? "entry" : "entries"}
            </span>
          </div>


          <Card>
            <CardContent className="pt-6">
              {entriesQuery.isLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : entries.length === 0 ? (
                <div className="py-10 text-center">
                  <Landmark className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">No entries match these filters</p>
                  <p className="text-sm text-muted-foreground">
                    Record an expense, other income, or money a partner put in.
                  </p>
                </div>
              ) : (
                <Table className="table-actions-sticky min-w-[1100px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Number</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Partner</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id} className={entry.voided ? "opacity-60" : undefined}>
                        <TableCell className="font-mono text-xs">{entry.entryNumber}</TableCell>
                        <TableCell>{formatDate(entry.entryDate)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={ENTRY_TYPE_BADGE[entry.entryType]}
                            className="whitespace-nowrap"
                          >
                            {FINANCE_ENTRY_TYPE_LABELS[entry.entryType]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{entry.category}</div>
                          <div className="text-xs text-muted-foreground">{entry.description}</div>
                          {entry.reference ? (
                            <div className="text-xs text-muted-foreground">
                              Ref {entry.reference}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {entry.partner ? (
                            <div>
                              <div>{entry.partner.name}</div>
                              {entry.fundingKind ? (
                                <div className="text-xs text-muted-foreground">
                                  {FUNDING_KIND_LABELS[entry.fundingKind]}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {PAYMENT_METHOD_LABELS[entry.paymentMethod] ?? entry.paymentMethod}
                        </TableCell>
                        <TableCell
                          className={`text-right font-medium ${
                            entry.direction === "credit" ? "text-success" : "text-destructive"
                          }`}
                        >
                          {entry.direction === "credit" ? "+" : "-"}
                          {formatCurrency(entry.amount)}
                        </TableCell>
                        <TableCell>
                          {entry.voided ? (
                            <div>
                              <Badge variant="secondary">Voided</Badge>
                              <div className="mt-1 max-w-[200px] text-xs text-muted-foreground">
                                {entry.voidReason}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {entry.voidedAt ? formatDateTime(entry.voidedAt) : null}
                                {entry.voidedByUser ? ` by ${entry.voidedByUser.username}` : null}
                              </div>
                            </div>
                          ) : (
                            <Badge variant="success">Posted</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* The paper receipt or bank screenshot behind this entry. */}
                            <AttachmentsButton
                              entityType="finance_entry"
                              entityId={entry.id}
                              label={`Entry ${entry.entryNumber}`}
                            />
                            {/*
                              Correcting a posted row is administrator-only; voiding stays open to
                              anyone with finance update, so a non-admin bookkeeper can still reverse
                              a mistake without rewriting it.
                            */}
                            {canEdit && !entry.voided ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Edit entry ${entry.entryNumber}`}
                                onClick={() => openEntryDialog(entry)}
                              >
                                <Pencil className="mr-1 h-4 w-4" />
                                Edit
                              </Button>
                            ) : null}
                            {canVoid && !entry.voided ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setVoiding(entry);
                                  setVoidReason("");
                                }}
                              >
                                <Ban className="mr-1 h-4 w-4" />
                                Void
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}


              {(entriesData?.total ?? 0) > limit ? (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Showing {offset + 1}–{Math.min(offset + limit, entriesData?.total ?? 0)} of{" "}
                    {entriesData?.total ?? 0}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - limit))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset + limit >= (entriesData?.total ?? 0)}
                      onClick={() => setOffset(offset + limit)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------------- Partners */}
        <TabsContent value="partners" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Users className="h-5 w-5" />
                Partners
              </h2>
              <p className="text-sm text-muted-foreground">
                Money each partner has put in, taken back, and still has in the company.
              </p>
            </div>
            {canCreate ? (
              <Button onClick={() => openPartnerDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                New partner
              </Button>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              title="Total deposited"
              value={partnersData?.totals.deposits ?? 0}
              tone="success"
              hint="Capital and loans put in"
            />
            <StatCard
              title="Total withdrawn"
              value={partnersData?.totals.withdrawals ?? 0}
              tone="destructive"
              hint="Money partners took back"
            />
            <StatCard
              title="Still in the company"
              value={partnersData?.totals.balance ?? 0}
              tone="warning"
              hint={`${partnersData?.totals.partnerCount ?? 0} ${
                partnersData?.totals.partnerCount === 1 ? "partner" : "partners"
              }`}
            />
          </div>

          <Card>
            <CardContent className="pt-6">
              {partnersQuery.isLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : partners.length === 0 ? (
                <div className="py-10 text-center">
                  <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">No partners recorded yet</p>
                  <p className="text-sm text-muted-foreground">
                    Add a partner, then record what they put in.
                  </p>
                </div>
              ) : (
                <Table className="min-w-[860px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Partner</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-right">Deposited</TableHead>
                      <TableHead className="text-right">Withdrawn</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Notes</TableHead>
                      {canEdit ? <TableHead className="text-right">Actions</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {partners.map((partner) => (
                      <TableRow key={partner.id}>
                        <TableCell>
                          <div className="font-medium">{partner.name}</div>
                          {!partner.isActive ? (
                            <Badge variant="secondary" className="mt-1">
                              Inactive
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>{partner.phone ?? "-"}</TableCell>
                        <TableCell className="text-right text-success">
                          {formatCurrency(partner.deposits)}
                        </TableCell>
                        <TableCell className="text-right text-destructive">
                          {formatCurrency(partner.withdrawals)}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(partner.balance)}
                        </TableCell>
                        <TableCell className="max-w-[240px] text-xs text-muted-foreground">
                          {partner.notes ?? "-"}
                        </TableCell>
                        {canEdit ? (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Edit partner ${partner.name}`}
                                onClick={() => openPartnerDialog(partner)}
                              >
                                <Pencil className="mr-1 h-4 w-4" />
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                aria-label={`Delete partner ${partner.name}`}
                                onClick={() => setDeletingPartner(partner)}
                              >
                                <Trash2 className="mr-1 h-4 w-4" />
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>



      {/* ------------------------------------------- New entry / correct an entry */}
      <Dialog
        open={entryDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setEntryDialogOpen(true);
          } else {
            closeEntryDialog();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit entry ${editing.entryNumber}` : "Record an entry"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Correct what was recorded. The entry number stays the same and the ledger totals update when you save."
                : FINANCE_ENTRY_TYPE_DESCRIPTIONS[form.entryType]}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="entry-type">Type</Label>
              <Select
                value={form.entryType}
                onValueChange={(v) => setEntryType(v as FinanceEntryType)}
              >
                <SelectTrigger id="entry-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FINANCE_ENTRY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {FINANCE_ENTRY_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="entry-date">Date</Label>
                <Input
                  id="entry-date"
                  type="date"
                  value={form.entryDate}
                  max={todayIso()}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, entryDate: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="entry-amount">Amount</Label>
                <Input
                  id="entry-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, amount: event.target.value }))
                  }
                  placeholder="0"
                />
              </div>
            </div>

            {isPartnerEntryType(form.entryType) ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="entry-partner">Partner</Label>
                  <Select
                    value={form.partnerId}
                    onValueChange={(value) =>
                      setForm((current) => ({ ...current, partnerId: value }))
                    }
                  >
                    <SelectTrigger id="entry-partner">
                      <SelectValue placeholder="Choose a partner" />
                    </SelectTrigger>
                    <SelectContent>
                      {partners.length === 0 ? (
                        <SelectItem value="none" disabled>
                          Add a partner first
                        </SelectItem>
                      ) : (
                        partners.map((partner) => (
                          <SelectItem key={partner.id} value={String(partner.id)}>
                            {partner.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {selectedPartner ? (
                    <p className="text-xs text-muted-foreground">
                      Available to withdraw: {formatCurrency(selectedPartner.balance)}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="entry-funding">Money is</Label>
                  <Select
                    value={form.fundingKind}
                    onValueChange={(value) =>
                      setForm((current) => ({ ...current, fundingKind: value as FundingKind }))
                    }
                  >
                    <SelectTrigger id="entry-funding">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FUNDING_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {FUNDING_KIND_LABELS[kind]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="entry-category">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, category: value }))
                  }
                >
                  <SelectTrigger id="entry-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!withdrawalCheck.valid && form.entryType === "partner_withdrawal" && form.amount ? (
              <p className="text-sm text-destructive">{withdrawalCheck.error}</p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="entry-method">Paid by</Label>
                <Select
                  value={form.paymentMethod}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, paymentMethod: value }))
                  }
                >
                  <SelectTrigger id="entry-method">
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
              <div className="space-y-1">
                <Label htmlFor="entry-reference">Reference</Label>
                <Input
                  id="entry-reference"
                  value={form.reference}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, reference: event.target.value }))
                  }
                  placeholder="Receipt or voucher number"
                  maxLength={100}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="entry-description">Description</Label>
              <Input
                id="entry-description"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder={
                  form.entryType === "expense"
                    ? "What the money was spent on"
                    : "What the money was for"
                }
                maxLength={200}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="entry-notes">Notes</Label>
              <Textarea
                id="entry-notes"
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                rows={2}
                maxLength={500}
              />
            </div>

            {/*
              Voucher pictures are filed when the entry is first recorded. On an edit the pictures
              already filed stay attached and can be managed from the row's attachments button, so
              the picker would only confuse - there is nothing queued to upload.
            */}
            {editing ? null : (
              <PendingAttachmentPicker
                files={entryDocuments}
                onFilesChange={setEntryDocuments}
                label="Receipt / bank-transfer pictures"
                description="Photograph the paper receipt or screenshot the bank transfer for this entry - up to 10 pictures, 5 MB each. They are filed with the entry when you record it."
                disabled={createEntry.isPending}
              />
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeEntryDialog}>
              Cancel
            </Button>
            <Button
              onClick={() => (editing ? updateEntry.mutate() : createEntry.mutate())}
              disabled={!canSubmitEntry || createEntry.isPending || updateEntry.isPending}
            >
              {createEntry.isPending || updateEntry.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {editing ? "Save changes" : "Record entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* ------------------------------------------------- New partner / correct one */}
      <Dialog
        open={partnerDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setPartnerDialogOpen(true);
          } else {
            closePartnerDialog();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPartner ? `Edit ${editingPartner.name}` : "Add a partner"}</DialogTitle>
            <DialogDescription>
              {editingPartner
                ? "Correct the name, phone or notes. The money already recorded for them stays exactly as it is."
                : "A partner is someone whose money the company holds - capital or a loan."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="partner-name">Name</Label>
              <Input
                id="partner-name"
                value={partnerName}
                onChange={(event) => setPartnerName(event.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="partner-phone">Phone</Label>
              <Input
                id="partner-phone"
                value={partnerPhone}
                onChange={(event) => setPartnerPhone(event.target.value)}
                maxLength={30}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="partner-notes">Notes</Label>
              <Textarea
                id="partner-notes"
                value={partnerNotes}
                onChange={(event) => setPartnerNotes(event.target.value)}
                rows={2}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePartnerDialog}>
              Cancel
            </Button>
            <Button
              onClick={() => (editingPartner ? updatePartner.mutate() : createPartner.mutate())}
              disabled={
                partnerName.trim() === "" || createPartner.isPending || updatePartner.isPending
              }
            >
              {createPartner.isPending || updatePartner.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {editingPartner ? "Save changes" : "Add partner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------------------- Delete partner */}
      <Dialog
        open={deletingPartner !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingPartner(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deletingPartner?.name ?? "this partner"}?</DialogTitle>
            <DialogDescription>
              Deleting removes the partner and any money entries recorded for them. It only works
              once their balance is zero - money the company still holds cannot be deleted off the
              report, so void their deposits or record the settling withdrawal first.
            </DialogDescription>
          </DialogHeader>

          {deletingPartner ? (
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deposited</span>
                <span className="font-medium text-success">
                  {formatCurrency(deletingPartner.deposits)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Withdrawn</span>
                <span className="font-medium text-destructive">
                  {formatCurrency(deletingPartner.withdrawals)}
                </span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-muted-foreground">Still in the company</span>
                <span className="font-semibold">{formatCurrency(deletingPartner.balance)}</span>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingPartner(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletePartner.mutate()}
              disabled={deletePartner.isPending}
            >
              {deletePartner.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete partner
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------ Void entry */}
      <Dialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) {
            setVoiding(null);
            setVoidReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void this entry?</DialogTitle>
            <DialogDescription>
              {voiding
                ? `${voiding.entryNumber} - ${formatCurrency(voiding.amount)} - ${
                    voiding.description
                  }`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              The entry stays in the book, marked voided, and stops counting in every total. This
              cannot be undone - record a new entry if the money still moved.
            </p>
            <div className="space-y-1">
              <Label htmlFor="void-reason">Reason</Label>
              <Textarea
                id="void-reason"
                value={voidReason}
                onChange={(event) => setVoidReason(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Why this entry is wrong"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>
              Keep entry
            </Button>
            <Button
              variant="destructive"
              onClick={() => voidEntry.mutate()}
              disabled={voidReason.trim() === "" || voidEntry.isPending}
            >
              {voidEntry.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Void entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default FinancePage;

