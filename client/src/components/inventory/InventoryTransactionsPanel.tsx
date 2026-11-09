import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { History, Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Inventory transaction log.
 *
 * Every stock change (sale, goods receipt, transfer, count, import, manual edit) writes one
 * row on the server; this panel is the read-only view of that ledger. The wording of each
 * row comes from the API (`reasonLabel`) so the screen never has to know which writer
 * produced the change.
 */

export type InventoryTransactionType =
  | "PURCHASE_ORDER"
  | "SALES_ORDER"
  | "PHYSICAL_COUNT"
  | "BULK_IMPORT"
  | "MANUAL_ADJUSTMENT"
  | "STOCK_TRANSFER"
  | "RETURN"
  | "DAMAGE_OR_WRITE_OFF";

export interface InventoryTransaction {
  id: number;
  transactionType: InventoryTransactionType;
  /** Signed: negative left the shelf, positive arrived on it. */
  quantityChange: number;
  quantityBefore: number | null;
  quantityAfter: number | null;
  productId: number | null;
  productName: string | null;
  sku: string | null;
  inventoryId: number;
  storeId: number | null;
  storeName: string | null;
  inventoryType: string | null;
  location: string | null;
  referenceDocumentType: string | null;
  referenceDocumentId: number | null;
  userId: number | null;
  userName: string | null;
  notes: string | null;
  importFileId: number | null;
  importFileName: string | null;
  importFileUrl: string | null;
  createdAt: string | null;
  reasonLabel: string;
}

interface InventoryTransactionsResponse {
  transactions: InventoryTransaction[];
  total: number;
}

interface StoreOption {
  id: number;
  name: string;
}

const TYPE_OPTIONS: { value: InventoryTransactionType | "all"; label: string }[] = [
  { value: "all", label: "All reasons" },
  { value: "PURCHASE_ORDER", label: "Goods receipt" },
  { value: "SALES_ORDER", label: "Sale" },
  { value: "STOCK_TRANSFER", label: "Transfer" },
  { value: "PHYSICAL_COUNT", label: "Stock take" },
  { value: "BULK_IMPORT", label: "Bulk import" },
  { value: "MANUAL_ADJUSTMENT", label: "Manual adjustment" },
  { value: "RETURN", label: "Return" },
  { value: "DAMAGE_OR_WRITE_OFF", label: "Damage / write-off" },
];

const formatDateTime = (value: string | null): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

const signedQuantity = (value: number): string => `${value > 0 ? "+" : ""}${value}`;

interface InventoryTransactionsPanelProps {
  /** Hide the heading when the panel already sits inside a titled dialog. */
  showHeader?: boolean;
}

export function InventoryTransactionsPanel({
  showHeader = true,
}: InventoryTransactionsPanelProps) {
  const [type, setType] = useState<InventoryTransactionType | "all">("all");
  const [storeId, setStoreId] = useState<string>("all");
  const [limit, setLimit] = useState<string>("100");

  // The app's default query function fetches the query key as a URL, so the filters are
  // part of the key - changing one refetches, and each filter combination stays cached.
  const query = new URLSearchParams();
  if (type !== "all") query.set("type", type);
  if (storeId !== "all") query.set("storeId", storeId);
  query.set("limit", limit);

  const { data, isLoading, isFetching, refetch } = useQuery<InventoryTransactionsResponse>({
    queryKey: [`/api/inventory/transactions?${query.toString()}`],
  });

  const { data: stores } = useQuery<StoreOption[]>({
    queryKey: ["/api/stores"],
  });

  const transactions = data?.transactions ?? [];

  return (
    <div className="space-y-4">
      {showHeader && (
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <History className="h-4 w-4" />
            Inventory transaction history
          </h3>
          <p className="text-sm text-muted-foreground">
            Every change to a stock quantity, with the document behind it and who made it.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={type}
          onValueChange={(value) => setType(value as InventoryTransactionType | "all")}
        >
          <SelectTrigger className="w-[210px]">
            <SelectValue placeholder="All reasons" />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="All stores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stores</SelectItem>
            {(stores ?? []).map((store) => (
              <SelectItem key={store.id} value={String(store.id)}>
                {store.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={limit} onValueChange={setLimit}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="100 rows" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="50">50 rows</SelectItem>
            <SelectItem value="100">100 rows</SelectItem>
            <SelectItem value="250">250 rows</SelectItem>
            <SelectItem value="500">500 rows</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <History className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

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
              <TableHead>Reference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Loading transactions...
                </TableCell>
              </TableRow>
            ) : transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  No stock movements match these filters.
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(transaction.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{transaction.productName ?? "Unknown product"}</div>
                    <div className="text-xs text-muted-foreground">{transaction.sku ?? "-"}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{transaction.reasonLabel}</div>
                    <div className="text-xs text-muted-foreground">{transaction.transactionType}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {transaction.storeName ?? "Distribution center"}
                  </TableCell>
                  <TableCell
                    className={
                      transaction.quantityChange < 0
                        ? "text-right font-medium text-red-600"
                        : "text-right font-medium text-green-600"
                    }
                  >
                    {signedQuantity(transaction.quantityChange)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-sm">
                    {transaction.quantityBefore ?? "-"} → {transaction.quantityAfter ?? "-"}
                  </TableCell>
                  <TableCell className="text-sm">{transaction.userName ?? "System"}</TableCell>
                  <TableCell className="text-sm">
                    {transaction.importFileUrl ? (
                      <a
                        className="underline underline-offset-2 hover:text-foreground"
                        href={transaction.importFileUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {transaction.importFileName ?? "Imported file"}
                      </a>
                    ) : transaction.referenceDocumentType ? (
                      <span className="text-xs text-muted-foreground">
                        {transaction.referenceDocumentType}
                        {transaction.referenceDocumentId
                          ? ` #${transaction.referenceDocumentId}`
                          : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                    {transaction.notes ? (
                      <div className="text-xs text-muted-foreground">{transaction.notes}</div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {transactions.length} transaction{transactions.length === 1 ? "" : "s"}. Older
        rows are kept - raise the row limit or narrow the filters to see them.
      </p>
    </div>
  );
}

export default InventoryTransactionsPanel;

