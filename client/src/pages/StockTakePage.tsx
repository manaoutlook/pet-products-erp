import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDateTime } from "@/utils/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { ColumnHeader, TableControlsBar } from "@/components/ui/table-controls";
import { useTableControls } from "@/hooks/use-table-controls";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { readApiError } from "@/lib/apiError";
import { queryClient } from "@/lib/queryClient";
import { AlertTriangle, ClipboardCheck, Loader2 } from "lucide-react";

/**
 * Stock take screen.
 *
 * AI Agent Note: the counted value is sent to `POST /api/inventory/:id/adjust` as
 * `countedQuantity`, so the server derives the delta from the stored quantity and writes a
 * ledger movement with the reason. Never compute the delta here and PUT the new quantity -
 * that path has no audit trail and races with a concurrent sale.
 */
interface StockTakeRow {
  inventoryId: number;
  productId: number | null;
  productName: string;
  sku: string;
  storeId: number | null;
  storeName: string | null;
  inventoryType: string;
  systemQuantity: number;
  lastCountedQuantity: number | null;
  lastVariance: number | null;
  lastCountedAt: string | null;
  lastNote: string | null;
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

const DEFAULT_REASON = "Stock take";

function VarianceBadge({ variance }: { variance: number | null }) {
  if (variance === null || variance === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const positive = variance > 0;
  return (
    <span
      className={
        positive
          ? "inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
          : "inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
      }
    >
      {positive ? `+${variance}` : variance}
    </span>
  );
}

function formatCountedAt(value: string | null) {
  if (!value) return "never counted";
  return formatDateTime(value);
}

export default function StockTakePage() {
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canAdjust = hasPermission("inventory", "update");

  const [search, setSearch] = useState("");
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [counts, setCounts] = useState<Record<number, string>>({});
  // Per-row confirmation of the last save, shown inline instead of a toast.
  const [saved, setSaved] = useState<
    Record<number, { quantityAfter: number; movementWritten: boolean }>
  >({});

  const { data: rows, isLoading, refetch } = useQuery<StockTakeRow[]>({
    queryKey: ["/api/inventory/stock-take"],
  });

  const table = useTableControls<StockTakeRow>(
    rows,
    {
      product: (row) => row.productName,
      sku: (row) => row.sku,
      store: (row) => row.storeName ?? "Warehouse (DC)",
      system: (row) => row.systemQuantity,
      lastCounted: (row) => row.lastCountedQuantity,
      variance: (row) => row.lastVariance,
    },
    {
      filter: (row) => {
        if (!search.trim()) return true;
        const needle = search.toLowerCase();
        return (
          row.productName.toLowerCase().includes(needle) ||
          row.sku.toLowerCase().includes(needle) ||
          (row.storeName ?? "").toLowerCase().includes(needle)
        );
      },
    }
  );

  const adjustMutation = useMutation({
    mutationFn: async ({ row, counted }: { row: StockTakeRow; counted: number }) => {
      const res = await fetch(`/api/inventory/${row.inventoryId}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          countedQuantity: counted,
          reason: reason.trim(),
          source: "stock_take",
        }),
      });

      if (!res.ok) throw new Error(await readApiError(res));
      return (await res.json()) as AdjustResponse;
    },
    onSuccess: (data, variables) => {
      setCounts((current) => {
        const next = { ...current };
        delete next[variables.row.inventoryId];
        return next;
      });
      // Inline confirmation rather than a success toast: the row stays in view, so the new
      // quantity is visible where the count was typed. Errors still raise a toast.
      setSaved((current) => ({
        ...current,
        [variables.row.inventoryId]: {
          quantityAfter: data.adjustment.quantityAfter,
          movementWritten: data.adjustment.movementWritten,
        },
      }));
      refetch();
      // The inventory list shows the same quantity, so keep it in step.
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
    },
    onError: (error: Error) => {
      toast({ title: "Could not save the count", description: error.message, variant: "destructive" });
    },
  });

  const pendingCount = useMemo(
    () => Object.values(counts).filter((value) => value.trim() !== "").length,
    [counts]
  );

  const submitRow = (row: StockTakeRow) => {
    const raw = counts[row.inventoryId];
    if (raw === undefined || raw.trim() === "") {
      toast({
        title: "Nothing counted",
        description: "Type the quantity you counted before saving",
        variant: "destructive",
      });
      return;
    }

    const counted = Number(raw);
    if (!Number.isInteger(counted) || counted < 0) {
      toast({
        title: "Invalid quantity",
        description: "The counted quantity must be a whole number of zero or more",
        variant: "destructive",
      });
      return;
    }

    if (reason.trim().length < 3) {
      toast({
        title: "A reason is required",
        description: "Say why the stock changed, e.g. \"stock take 2026-02\"",
        variant: "destructive",
      });
      return;
    }

    adjustMutation.mutate({ row, counted });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stock Take</h1>
          <p className="text-muted-foreground">
            Count the shelf, enter what you found and save. Every difference is recorded in the
            stock ledger with your reason, so the quantity is always explainable later.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="w-56">
            <label htmlFor="stock-take-reason" className="text-xs font-medium text-muted-foreground">
              Reason recorded with each adjustment
            </label>
            <Input
              id="stock-take-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Stock take February"
              maxLength={200}
            />
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <ClipboardCheck className="mr-2 h-4 w-4" />
            Reload
          </Button>
        </div>
      </div>

      {!canAdjust && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          You can review counts but need the inventory update permission to save them.
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span>Counted vs system</span>
            {pendingCount > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                {pendingCount} unsaved {pendingCount === 1 ? "count" : "counts"}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search by product, SKU or store"
              containerClassName="max-w-sm"
            />
          </div>

          <TableControlsBar controls={table} noun="inventory rows" />

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading inventory...
            </div>
          ) : (
            <Table className="min-w-[1300px]">
              <TableHeader>
                <TableRow>
                  <ColumnHeader controls={table} columnKey="product" label="Product" />
                  <ColumnHeader controls={table} columnKey="sku" label="SKU" />
                  <ColumnHeader controls={table} columnKey="store" label="Store" />
                  <ColumnHeader controls={table} columnKey="system" label="System" />
                  <TableHead scope="col" className="text-xs uppercase tracking-wide">
                    Counted
                  </TableHead>
                  <TableHead scope="col" className="text-xs uppercase tracking-wide">
                    Difference
                  </TableHead>
                  <ColumnHeader controls={table} columnKey="lastCounted" label="Last count" />
                  <ColumnHeader controls={table} columnKey="variance" label="Last variance" />
                  <TableHead scope="col" className="text-right text-xs uppercase tracking-wide">
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      {table.totalCount === 0
                        ? "No inventory rows to count yet."
                        : "No rows match the current search or filters."}
                    </TableCell>
                  </TableRow>
                ) : (
                  table.rows.map((row) => {
                    const raw = counts[row.inventoryId] ?? "";
                    const parsed = raw.trim() === "" ? null : Number(raw);
                    const difference =
                      parsed === null || !Number.isFinite(parsed)
                        ? null
                        : parsed - row.systemQuantity;
                    const saving =
                      adjustMutation.isPending &&
                      adjustMutation.variables?.row.inventoryId === row.inventoryId;

                    return (
                      <TableRow key={row.inventoryId}>
                        <TableCell>
                          <div className="font-medium">{row.productName}</div>
                          <div className="text-xs text-muted-foreground">{row.inventoryType}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                        <TableCell>{row.storeName ?? "Warehouse (DC)"}</TableCell>
                        <TableCell className="tabular-nums">{row.systemQuantity}</TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Counted quantity for ${row.productName}`}
                            inputMode="numeric"
                            className="h-8 w-20"
                            value={raw}
                            disabled={!canAdjust || saving}
                            onChange={(event) =>
                              setCounts((current) => ({
                                ...current,
                                [row.inventoryId]: event.target.value,
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <VarianceBadge variance={difference} />
                          {saved[row.inventoryId] && (
                            <div className="mt-1 text-xs text-emerald-700">
                              {saved[row.inventoryId].movementWritten
                                ? `Saved → ${saved[row.inventoryId].quantityAfter}`
                                : "No difference"}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div>{formatCountedAt(row.lastCountedAt)}</div>
                          {row.lastNote && <div className="italic">{row.lastNote}</div>}
                        </TableCell>
                        <TableCell>
                          <VarianceBadge variance={row.lastVariance} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!canAdjust || saving}
                            onClick={() => submitRow(row)}
                          >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save count"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

