import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  History,
  Loader2,
  PackageMinus,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { readApiError } from "@/lib/apiError";
import { queryClient } from "@/lib/queryClient";
import { formatDateTime } from "@/utils/format";

/**
 * Stock adjustments screen.
 *
 * AI Agent Note: every correction on this page goes through
 * `POST /api/inventory/:id/adjust`, which writes a `stock_movements` row with an explicit
 * `transactionType` - never `PUT /api/inventory/:id`, which overwrites the quantity with no
 * ledger entry and loses a concurrent sale. The three tabs differ only in the type they
 * stamp and in whether they send `delta` (correction / write-off) or `countedQuantity`
 * (recount, so the server derives the delta from the stored quantity).
 */

/** Row shape returned by `GET /api/inventory/stock-take`; the picker reuses it. */
interface StockRow {
  inventoryId: number;
  productId: number | null;
  productName: string;
  sku: string;
  storeId: number | null;
  storeName: string | null;
  inventoryType: string;
  systemQuantity: number;
}

interface AdjustResponse {
  message: string;
  adjustment: {
    inventoryId: number;
    quantityBefore: number;
    quantityAfter: number;
    delta: number;
    movementWritten: boolean;
  };
}

/** One row of the "Recent adjustments" table (subset of the transactions API). */
interface AdjustmentMovement {
  id: number;
  transactionType: string;
  quantityChange: number;
  quantityBefore: number | null;
  quantityAfter: number | null;
  productName: string | null;
  sku: string | null;
  storeName: string | null;
  userName: string | null;
  notes: string | null;
  reasonLabel: string;
  createdAt: string | null;
}

interface TransactionsResponse {
  transactions: AdjustmentMovement[];
}

type AdjustmentMode = "adjust" | "write_off" | "recount";

interface ModeConfig {
  title: string;
  description: string;
  transactionType: "MANUAL_ADJUSTMENT" | "DAMAGE_OR_WRITE_OFF" | "PHYSICAL_COUNT";
  source: "stock_adjust" | "stock_take";
  /** Caption above the quantity box. */
  quantityLabel: string;
  quantityHint: string;
  reasonPlaceholder: string;
  defaultReason: string;
  /** Short list of frequent reasons, offered as one-click chips. */
  presets: string[];
  submitLabel: string;
}

const MODES: Record<AdjustmentMode, ModeConfig> = {
  adjust: {
    title: "Manual adjustment",
    description:
      "Correct the recorded quantity in either direction when the shelf and the system disagree. Recorded as a manual adjustment with your reason.",
    transactionType: "MANUAL_ADJUSTMENT",
    source: "stock_adjust",
    quantityLabel: "Quantity to add or remove",
    quantityHint: "Whole units. Pick the direction, then the amount.",
    reasonPlaceholder: "e.g. Found 2 extra during unloading",
    defaultReason: "",
    presets: ["Recount correction", "Supplier short-shipped", "Data entry fix"],
    submitLabel: "Record adjustment",
  },
  write_off: {
    title: "Damage / write-off",
    description:
      "Remove stock that can no longer be sold - breakage, expiry, loss. Recorded as a damage or write-off so shrinkage is reported separately from sales.",
    transactionType: "DAMAGE_OR_WRITE_OFF",
    source: "stock_adjust",
    quantityLabel: "Quantity written off",
    quantityHint: "How many units are leaving the shelf for good.",
    reasonPlaceholder: "e.g. Broken bottle in aisle 3",
    defaultReason: "",
    presets: ["Damaged in transit", "Broken on shelf", "Expired", "Lost or stolen", "Water damage"],
    submitLabel: "Write off stock",
  },
  recount: {
    title: "Recount",
    description:
      "Enter the quantity you actually counted. The server works out the difference from the stored quantity and records it as a physical count - a count that matches writes nothing.",
    transactionType: "PHYSICAL_COUNT",
    source: "stock_take",
    quantityLabel: "Counted quantity",
    quantityHint: "What is physically on the shelf right now.",
    reasonPlaceholder: "e.g. Counted 12 after delivery",
    defaultReason: "Stock recount",
    presets: ["Stock recount", "Cycle count", "Spot check"],
    submitLabel: "Save count",
  },
};

const signedQuantity = (value: number): string => `${value > 0 ? "+" : ""}${value}`;

/** Types this screen produces - the "Recent adjustments" table shows only these. */
const RECENT_TYPES = "MANUAL_ADJUSTMENT,DAMAGE_OR_WRITE_OFF,PHYSICAL_COUNT";
const RECENT_URL = `/api/inventory/transactions?types=${RECENT_TYPES}&limit=50`;

interface AdjustmentFormProps {
  mode: AdjustmentMode;
  rows: StockRow[];
  canAdjust: boolean;
}

function AdjustmentForm({ mode, rows, canAdjust }: AdjustmentFormProps) {
  const config = MODES[mode];
  const { toast } = useToast();

  const [inventoryId, setInventoryId] = useState<string | null>(null);
  const [direction, setDirection] = useState<"increase" | "decrease">("decrease");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState(config.defaultReason);

  const selected = useMemo(
    () => rows.find((row) => String(row.inventoryId) === inventoryId) ?? null,
    [rows, inventoryId],
  );

  const options = useMemo(
    () =>
      rows.map((row) => ({
        value: String(row.inventoryId),
        label: `${row.productName} (${row.sku})`,
        description: `${row.storeName ?? "Distribution center"} · ${row.systemQuantity} on hand`,
      })),
    [rows],
  );

  /**
   * Live preview of the ledger row, computed the same way the server does: a correction or
   * write-off sends a signed delta, a recount sends the counted value and lets the server
   * derive the delta from the stored quantity.
   */
  const preview = useMemo(() => {
    if (!selected) return null;
    const parsed = Number(amount);
    if (amount.trim() === "" || !Number.isInteger(parsed)) return null;

    if (mode === "recount") {
      if (parsed < 0) return null;
      return { delta: parsed - selected.systemQuantity, after: parsed };
    }

    if (parsed <= 0) return null;
    const delta = mode === "write_off" || direction === "decrease" ? -parsed : parsed;
    return { delta, after: selected.systemQuantity + delta };
  }, [amount, direction, mode, selected]);

  const refreshLedgers = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
    queryClient.invalidateQueries({ queryKey: ["/api/inventory/stock-take"] });
    queryClient.invalidateQueries({ queryKey: [RECENT_URL] });
    // The transaction panels key their query by the full filtered URL, so match the prefix.
    queryClient.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey[0] === "string" &&
        (query.queryKey[0] as string).startsWith("/api/inventory/transactions"),
    });
  };

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch(`/api/inventory/${inventoryId}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      return (await res.json()) as AdjustResponse;
    },
    onSuccess: (data) => {
      toast({
        title: data.adjustment.movementWritten ? `${config.title} recorded` : "Nothing to change",
        description: data.adjustment.movementWritten
          ? `${selected?.productName ?? "Stock"} is now ${data.adjustment.quantityAfter}, was ${data.adjustment.quantityBefore}.`
          : data.message,
      });
      setAmount("");
      refreshLedgers();
    },
    onError: (error: Error) => {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
    },
  });

  const submit = () => {
    if (!selected) {
      toast({
        title: "Pick a product first",
        description: "Search the list and choose the stock row you are correcting",
        variant: "destructive",
      });
      return;
    }

    const parsed = Number(amount);
    if (amount.trim() === "" || !Number.isInteger(parsed)) {
      toast({
        title: "Invalid quantity",
        description: "Enter a whole number of units",
        variant: "destructive",
      });
      return;
    }
    if (mode === "recount" ? parsed < 0 : parsed <= 0) {
      toast({
        title: "Invalid quantity",
        description:
          mode === "recount"
            ? "A counted quantity is zero or more"
            : "The quantity must be more than zero",
        variant: "destructive",
      });
      return;
    }
    if (reason.trim().length < 3) {
      toast({
        title: "A reason is required",
        description: "Say why the stock changed so the entry is explainable later",
        variant: "destructive",
      });
      return;
    }
    if (preview && preview.after < 0) {
      toast({
        title: "Not enough stock on record",
        description: `Only ${selected.systemQuantity} on record - use Recount if the shelf holds less`,
        variant: "destructive",
      });
      return;
    }

    const payload =
      mode === "recount"
        ? {
            countedQuantity: parsed,
            reason: reason.trim(),
            source: config.source,
            transactionType: config.transactionType,
          }
        : {
            delta: preview?.delta ?? 0,
            reason: reason.trim(),
            source: config.source,
            transactionType: config.transactionType,
          };

    mutation.mutate(payload);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor={`${mode}-product`}>Product and store</Label>
          <SearchableSelect
            id={`${mode}-product`}
            value={inventoryId}
            onChange={setInventoryId}
            options={options}
            placeholder="Search by product name or SKU"
            searchPlaceholder="Type a product name or SKU..."
            emptyMessage="No stock rows match - check the store assignment"
            disabled={!canAdjust || rows.length === 0}
          />
        </div>

        {mode === "adjust" && (
          <div className="space-y-2">
            <Label htmlFor="adjust-direction">Direction</Label>
            <Select
              value={direction}
              onValueChange={(value) => setDirection(value as "increase" | "decrease")}
              disabled={!canAdjust}
            >
              <SelectTrigger id="adjust-direction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="decrease">Remove from stock</SelectItem>
                <SelectItem value="increase">Add to stock</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor={`${mode}-amount`}>{config.quantityLabel}</Label>
          <Input
            id={`${mode}-amount`}
            type="number"
            min={mode === "recount" ? 0 : 1}
            step={1}
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0"
            disabled={!canAdjust}
          />
          <p className="text-xs text-muted-foreground">{config.quantityHint}</p>
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor={`${mode}-reason`}>Reason</Label>
          <Input
            id={`${mode}-reason`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={config.reasonPlaceholder}
            maxLength={200}
            disabled={!canAdjust}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            {config.presets.map((preset) => (
              <Button
                key={preset}
                type="button"
                size="sm"
                variant={reason === preset ? "secondary" : "outline"}
                className="h-7 text-xs"
                onClick={() => setReason(preset)}
                disabled={!canAdjust}
              >
                {preset}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {selected ? (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <span>
              <span className="text-muted-foreground">On record:</span>{" "}
              <span className="font-medium">{selected.systemQuantity}</span>
            </span>
            <span>
              <span className="text-muted-foreground">After this entry:</span>{" "}
              <span
                className={
                  preview && preview.after < 0 ? "font-medium text-red-600" : "font-medium"
                }
              >
                {preview ? preview.after : selected.systemQuantity}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">Recorded as:</span>{" "}
              <span className="font-medium">{config.transactionType}</span>
            </span>
            {preview && preview.delta === 0 ? (
              <span className="text-muted-foreground">
                The count matches the system - nothing will be written.
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Choose a product above to see its current quantity and what this entry will change.
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setAmount("");
            setReason(config.defaultReason);
          }}
          disabled={mutation.isPending}
        >
          Reset
        </Button>
        <Button onClick={submit} disabled={!canAdjust || mutation.isPending}>
          {mutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : mode === "write_off" ? (
            <PackageMinus className="mr-2 h-4 w-4" />
          ) : (
            <SlidersHorizontal className="mr-2 h-4 w-4" />
          )}
          {config.submitLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Stock adjustment screen: one tab per audited transaction type this page can produce.
 */
export default function StockAdjustmentsPage() {
  const { hasPermission } = usePermissions();
  const canAdjust = hasPermission("inventory", "update");

  const { data: rows, isLoading } = useQuery<StockRow[]>({
    queryKey: ["/api/inventory/stock-take"],
  });

  const {
    data: recent,
    isFetching: recentFetching,
    refetch: refetchRecent,
  } = useQuery<TransactionsResponse>({ queryKey: [RECENT_URL] });

  const movements = recent?.transactions ?? [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Stock Adjustments</h1>
        <p className="text-muted-foreground">
          Correct stock with an explicit reason. Adjustments, write-offs and recounts all land
          in the inventory transaction log with who did it and the quantity before and after.
        </p>
      </div>

      {!canAdjust && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          You can review adjustments but need the inventory update permission to record one.
        </div>
      )}

      <Tabs defaultValue="adjust" className="space-y-4">
        <TabsList>
          <TabsTrigger value="adjust">
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Adjust
          </TabsTrigger>
          <TabsTrigger value="write_off">
            <PackageMinus className="mr-2 h-4 w-4" />
            Write off
          </TabsTrigger>
          <TabsTrigger value="recount">
            <RefreshCw className="mr-2 h-4 w-4" />
            Recount
          </TabsTrigger>
        </TabsList>

        {(Object.keys(MODES) as AdjustmentMode[]).map((mode) => (
          <TabsContent key={mode} value={mode}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{MODES[mode].title}</CardTitle>
                <CardDescription>{MODES[mode].description}</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading stock...
                  </div>
                ) : (
                  <AdjustmentForm mode={mode} rows={rows ?? []} canAdjust={canAdjust} />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" />
                Recent adjustments
              </CardTitle>
              <CardDescription>
                Manual adjustments, write-offs and counts across the stores you can see. Sales,
                receipts and transfers live in the inventory transaction log.
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => refetchRecent()} disabled={recentFetching}>
              <RefreshCw
                className={recentFetching ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"}
              />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Before → After</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentFetching && movements.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                      Loading adjustments...
                    </TableCell>
                  </TableRow>
                ) : movements.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No adjustments recorded yet. The first entry you save will appear here.
                    </TableCell>
                  </TableRow>
                ) : (
                  movements.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDateTime(movement.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{movement.productName ?? "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">{movement.sku ?? "-"}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{movement.reasonLabel}</div>
                        <div className="text-xs text-muted-foreground">
                          {movement.transactionType}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {movement.storeName ?? "Distribution center"}
                      </TableCell>
                      <TableCell
                        className={
                          movement.quantityChange < 0
                            ? "text-right font-medium text-red-600"
                            : "text-right font-medium text-green-600"
                        }
                      >
                        {signedQuantity(movement.quantityChange)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm">
                        {movement.quantityBefore ?? "-"} → {movement.quantityAfter ?? "-"}
                      </TableCell>
                      <TableCell className="text-sm">{movement.userName ?? "System"}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                        {movement.notes ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


