import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";
import { formatDateTime, formatQuantity } from "@/utils/format";
import {
  WEBSITE_CHANNELS_KEY,
  deleteWebsiteChannel,
  refreshWebsiteCatalogue,
  runWebsiteSync,
  saveWebsiteChannel,
  testWebsiteChannel,
  useWebsiteChannels,
  useWebsiteSyncPreview,
  useWebsiteSyncRun,
  useWebsiteSyncRuns,
  type StockSyncMode,
  type WebsiteChannel,
  type WebsiteStockScope,
} from "@/hooks/use-website-sync";

/**
 * Website Stock Sync - the one-way push of ERP stock to the WooCommerce shops.
 *
 * The screen follows the order the work is actually done:
 *
 *   1. a shop is set up once (address + WooCommerce key, encrypted at rest);
 *   2. "Refresh catalogue" matches the shop's SKUs to `products.sku` - until that runs, nothing
 *      can be pushed, and whatever could not be matched is listed;
 *   3. "Preview" shows exactly what a run would send and why (new, changed, site differs);
 *   4. "Sync now" pushes it and records every line in the history below.
 *
 * AI Agent Note - the mode switch is not cosmetic:
 * "Changed only" is the daily click; "All products" is the repair path after a broken run and
 * rewrites every linked product. Preview must be re-read after switching, which is why the mode is
 * part of the query key (`useWebsiteSyncPreview`).
 *
 * AI Agent Note - nothing here recomputes stock:
 * The quantities and the "not tracking stock" list are the server's plan. If the page and the run
 * could disagree, the confirmation step would be theatre.
 */

const MODE_LABELS: Record<StockSyncMode, string> = {
  changed: "Changed only",
  all: "All products",
};

const REASON_LABELS: Record<string, string> = {
  new: "Never sent",
  changed: "Stock changed",
  "site-differs": "Site differs",
  all: "Forced (all)",
};

const SCOPE_LABELS: Record<WebsiteStockScope, string> = {
  ALL: "Distribution centre + all stores",
  DC: "Distribution centre only",
  STORES: "Store shelves only",
};

/** How many preview lines are rendered - a 3,000-row table is not a useful confirmation. */
const PREVIEW_ROW_LIMIT = 100;

interface ChannelFormState {
  name: string;
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  isActive: boolean;
  stockScope: WebsiteStockScope;
  clampNegative: boolean;
  allowBackorders: boolean;
  forceManageStock: boolean;
}

const EMPTY_FORM: ChannelFormState = {
  name: "",
  baseUrl: "",
  consumerKey: "",
  consumerSecret: "",
  isActive: true,
  stockScope: "ALL",
  clampNegative: true,
  allowBackorders: false,
  forceManageStock: false,
};

function formForChannel(channel: WebsiteChannel): ChannelFormState {
  return {
    name: channel.name,
    baseUrl: channel.baseUrl,
    // The stored key is never sent to the browser: empty means "keep it".
    consumerKey: "",
    consumerSecret: "",
    isActive: channel.isActive,
    stockScope: channel.stockScope,
    clampNegative: channel.clampNegative,
    allowBackorders: channel.allowBackorders,
    forceManageStock: channel.forceManageStock,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function SyncStatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="secondary">Never synced</Badge>;
  if (status === "success") {
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">Success</Badge>;
  }
  if (status === "partial") return <Badge className="bg-amber-600 hover:bg-amber-600">Partial</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

export default function WebsiteSyncPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();

  const { channels, isLoading, error } = useWebsiteChannels();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<StockSyncMode>("changed");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WebsiteChannel | null>(null);
  const [form, setForm] = useState<ChannelFormState>(EMPTY_FORM);
  const [detailRunId, setDetailRunId] = useState<number | null>(null);

  // The first channel is selected automatically, so opening the screen needs no extra click.
  const activeId = selectedId ?? channels[0]?.id ?? null;
  const selected = useMemo(
    () => channels.find((channel) => channel.id === activeId) ?? null,
    [channels, activeId],
  );

  const previewQuery = useWebsiteSyncPreview(activeId, mode, selected !== null);
  const preview = previewQuery.preview;
  const runsQuery = useWebsiteSyncRuns(activeId);
  const runDetailQuery = useWebsiteSyncRun(detailRunId);

  const canCreate = hasPermission("websiteSync", "create");
  const canUpdate = hasPermission("websiteSync", "update");
  const canDelete = hasPermission("websiteSync", "delete");

  const refreshViews = () => {
    queryClient.invalidateQueries({ queryKey: [WEBSITE_CHANNELS_KEY] });
    queryClient.invalidateQueries({ queryKey: ["/api/website-sync/preview"] });
    queryClient.invalidateQueries({ queryKey: ["/api/website-sync/runs"] });
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (channel: WebsiteChannel) => {
    setEditing(channel);
    setForm(formForChannel(channel));
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      saveWebsiteChannel(
        {
          name: form.name,
          baseUrl: form.baseUrl,
          // Empty strings mean "keep the stored key" - the server never receives a mask back.
          ...(form.consumerKey ? { consumerKey: form.consumerKey } : {}),
          ...(form.consumerSecret ? { consumerSecret: form.consumerSecret } : {}),
          isActive: form.isActive,
          stockScope: form.stockScope,
          clampNegative: form.clampNegative,
          allowBackorders: form.allowBackorders,
          forceManageStock: form.forceManageStock,
        },
        editing?.id,
      ),
    onSuccess: (channel) => {
      setFormOpen(false);
      setSelectedId(channel.id);
      refreshViews();
      toast({
        title: editing ? "Website updated" : "Website added",
        description: channel.name,
        variant: "success",
      });
    },
    onError: (mutationError) => {
      toast({
        title: "Could not save the website",
        description: errorMessage(mutationError),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteWebsiteChannel(id),
    onSuccess: () => {
      setSelectedId(null);
      refreshViews();
      toast({
        title: "Website removed",
        description: "Its links and sync history were removed too.",
        variant: "success",
      });
    },
    onError: (mutationError) => {
      toast({
        title: "Could not remove the website",
        description: errorMessage(mutationError),
        variant: "destructive",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => testWebsiteChannel(id),
    onSuccess: (result) => {
      toast({
        title: "Connection works",
        description: `${result.baseUrl} answered - ${
          result.totalProducts === null ? "products reachable" : `${result.totalProducts} products`
        }.${
          result.urlStyle === "rest_route"
            ? " Permalinks are set to \"Plain\", so the ?rest_route= address is used."
            : ""
        }${
          result.authMode === "query"
            ? " The shop's web server drops the Authorization header, so the key is sent in the address instead - it will appear in that shop's access logs. Ask the host to pass HTTP_AUTHORIZATION to PHP to stop that."
            : ""
        }`,
        variant: "success",
      });
    },
    onError: (mutationError) => {
      toast({
        title: "Connection failed",
        description: errorMessage(mutationError),
        variant: "destructive",
      });
    },
  });

  const refreshCatalogueMutation = useMutation({
    mutationFn: (id: number) => refreshWebsiteCatalogue(id),
    onSuccess: (result) => {
      refreshViews();
      toast({
        title: "Catalogue refreshed",
        description: `${result.linked} of ${result.siteEntries} site products matched (${result.created} new, ${result.dropped} dropped${
          result.unmapped.length > 0 ? `, ${result.unmapped.length} unmapped` : ""
        }).`,
        variant: "success",
      });
    },
    onError: (mutationError) => {
      toast({
        title: "Could not refresh the catalogue",
        description: errorMessage(mutationError),
        variant: "destructive",
      });
    },
  });

  const runMutation = useMutation({
    mutationFn: (channelId: number) => runWebsiteSync(channelId, mode),
    onSuccess: (result) => {
      refreshViews();
      toast({
        title:
          result.status === "success"
            ? "Stock pushed"
            : result.status === "partial"
              ? "Stock pushed, with failures"
              : "Nothing could be pushed",
        description: `${result.message} (${Math.round(result.durationMs / 1000)}s)`,
        variant: result.status === "failed" ? "destructive" : "success",
      });
    },
    onError: (mutationError) => {
      toast({
        title: "The sync failed",
        description: errorMessage(mutationError),
        variant: "destructive",
      });
    },
  });

  // Only the channel whose own button was pressed shows a spinner.
  const busyChannelId =
    (runMutation.isPending ? runMutation.variables : undefined) ??
    (refreshCatalogueMutation.isPending ? refreshCatalogueMutation.variables : undefined) ??
    (testMutation.isPending ? testMutation.variables : undefined) ??
    null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Globe className="h-6 w-6" /> Website Stock Sync
          </h1>
          <p className="text-sm text-muted-foreground">
            Push ERP stock to the WooCommerce shops. One-way only: a website order never changes
            the ERP.
          </p>
        </div>
        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Add website
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading websites…
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 pt-6 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {errorMessage(error)}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && channels.length === 0 && (
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <Globe className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No website is set up yet</p>
            <p className="text-sm text-muted-foreground">
              Add the shop address and a WooCommerce REST key with Read/Write permission, then
              refresh the catalogue so the SKUs can be matched.
            </p>
            {canCreate && (
              <Button className="mt-2" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Add website
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {channels.map((channel) => {
          const isSelected = channel.id === activeId;
          const isBusy = busyChannelId === channel.id;

          return (
            <Card
              key={channel.id}
              className={cn(
                "cursor-pointer transition-colors",
                isSelected ? "border-primary ring-1 ring-primary/30" : "hover:border-primary/40",
              )}
              onClick={() => setSelectedId(channel.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      {channel.name}
                      {channel.isActive ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Switched off</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1 break-all">{channel.baseUrl}</CardDescription>
                  </div>
                  <SyncStatusBadge status={channel.lastSyncStatus} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Stock from</dt>
                  <dd>{SCOPE_LABELS[channel.stockScope]}</dd>
                  <dt className="text-muted-foreground">Last sync</dt>
                  <dd>{channel.lastSyncAt ? formatDateTime(channel.lastSyncAt) : "Never"}</dd>
                  <dt className="text-muted-foreground">Consumer key</dt>
                  <dd className="font-mono">{channel.consumerKeyMasked || "—"}</dd>
                  <dt className="text-muted-foreground">Zero stock</dt>
                  <dd>{channel.clampNegative ? "Clamped to 0" : "Sent as is"}</dd>
                  <dt className="text-muted-foreground">Backorders</dt>
                  <dd>{channel.allowBackorders ? "Allowed" : "Not allowed"}</dd>
                </dl>

                {channel.lastSyncMessage && (
                  <p className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                    {channel.lastSyncMessage}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canUpdate || isBusy}
                    onClick={(event) => {
                      event.stopPropagation();
                      testMutation.mutate(channel.id);
                    }}
                  >
                    {isBusy && testMutation.isPending ? (
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-3 w-3" />
                    )}
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canUpdate || isBusy}
                    onClick={(event) => {
                      event.stopPropagation();
                      refreshCatalogueMutation.mutate(channel.id);
                    }}
                  >
                    {isBusy && refreshCatalogueMutation.isPending ? (
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    ) : (
                      <Link2 className="mr-2 h-3 w-3" />
                    )}
                    Refresh catalogue
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canUpdate}
                    onClick={(event) => {
                      event.stopPropagation();
                      openEdit(channel);
                    }}
                  >
                    <Pencil className="mr-2 h-3 w-3" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={!canDelete || deleteMutation.isPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (
                        window.confirm(
                          `Remove ${channel.name}? Its SKU links and sync history are removed too - the shop itself is not touched.`,
                        )
                      ) {
                        deleteMutation.mutate(channel.id);
                      }
                    }}
                  >
                    <Trash2 className="mr-2 h-3 w-3" /> Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {selected && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Preview for {selected.name}</CardTitle>
                <CardDescription>
                  Nothing is written until you press Sync now. The list is the server's own plan.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-md border">
                  {(["changed", "all"] as StockSyncMode[]).map((option) => (
                    <Button
                      key={option}
                      size="sm"
                      variant={mode === option ? "default" : "ghost"}
                      className="rounded-none first:rounded-l-md last:rounded-r-md"
                      onClick={() => setMode(option)}
                    >
                      {MODE_LABELS[option]}
                    </Button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => previewQuery.refetch()}
                  disabled={previewQuery.isFetching}
                >
                  <RefreshCw
                    className={cn("mr-2 h-3 w-3", previewQuery.isFetching && "animate-spin")}
                  />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  onClick={() => runMutation.mutate(selected.id)}
                  disabled={
                    !canUpdate ||
                    runMutation.isPending ||
                    !selected.isActive ||
                    !preview ||
                    preview.totals.toSend === 0
                  }
                >
                  {runMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <UploadCloud className="mr-2 h-4 w-4" />
                  )}
                  Sync now
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {previewQuery.isLoading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Working out what changed…
              </p>
            )}

            {previewQuery.error && (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" /> {errorMessage(previewQuery.error)}
              </p>
            )}

            {preview && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatBox label="To send" value={preview.totals.toSend} tone="primary" />
                  <StatBox label="Already matching" value={preview.totals.unchanged} />
                  <StatBox
                    label="Not tracking stock"
                    value={preview.totals.notTracking}
                    tone="warning"
                  />
                  <StatBox label="Linked products" value={preview.totals.linkedProducts} />
                </div>

                {preview.totals.toSend === 0 && (
                  <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    {preview.totals.linkedProducts === 0
                      ? "No SKUs are linked yet - press Refresh catalogue first."
                      : "Every linked product already matches the ERP stock."}
                  </p>
                )}

                {preview.totals.disabledLinks > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {preview.totals.disabledLinks} link(s) are parked and are never sent.
                  </p>
                )}

                {preview.totals.missingProducts > 0 && (
                  <p className="flex items-center gap-2 text-xs text-amber-700">
                    <AlertTriangle className="h-3 w-3" />
                    {preview.totals.missingProducts} link(s) point at products that no longer exist
                    - refresh the catalogue to clean them up.
                  </p>
                )}

                {preview.items.length > 0 && (
                  <div className="max-h-80 overflow-auto rounded-md border">
                    <Table className="min-w-[720px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>SKU</TableHead>
                          <TableHead>Woo ID</TableHead>
                          <TableHead className="text-right">Site now</TableHead>
                          <TableHead className="text-right">ERP</TableHead>
                          <TableHead>Why</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.items.slice(0, PREVIEW_ROW_LIMIT).map((item) => (
                          <TableRow key={`${item.wooType}-${item.wooId}`}>
                            <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              #{item.wooId}
                              {item.wooType === "variation" ? " (variation)" : ""}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.siteQuantity === null ? "—" : formatQuantity(item.siteQuantity)}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatQuantity(item.quantity)}
                            </TableCell>
                            <TableCell className="text-xs">
                              {REASON_LABELS[item.reason] ?? item.reason}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  item.stockStatus === "instock" ? "secondary" : "destructive"
                                }
                              >
                                {item.stockStatus === "instock" ? "In stock" : "Out of stock"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {preview.items.length > PREVIEW_ROW_LIMIT && (
                  <p className="text-xs text-muted-foreground">
                    Showing the first {PREVIEW_ROW_LIMIT} of {preview.items.length} products. The run
                    sends all of them.
                  </p>
                )}

                {preview.notTracking.length > 0 && (
                  <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    <p className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      {preview.notTracking.length} product(s) do not track stock on this shop, so
                      WooCommerce ignores the quantity.
                    </p>
                    <p>
                      Tick "Track stock quantity for this product" in the shop, then press Refresh
                      catalogue - this list is what the shop reported when the catalogue was last
                      read, so a box ticked since then still shows here and the run keeps skipping
                      the product. Or switch on "Force stock tracking" on this channel. These
                      products are never counted as synced.
                    </p>
                    {/* The step people miss: the flag above is stored per link at the last
                        catalogue read, so a fresh tick in wp-admin changes nothing until this
                        runs. Offered here rather than only on the channel card. */}
                    <div className="pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-amber-300 bg-white text-xs text-amber-900 hover:bg-amber-100"
                        disabled={!canUpdate || busyChannelId === preview.channel.id}
                        onClick={() => refreshCatalogueMutation.mutate(preview.channel.id)}
                      >
                        {refreshCatalogueMutation.isPending ? (
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        ) : (
                          <Link2 className="mr-2 h-3 w-3" />
                        )}
                        Refresh catalogue
                      </Button>
                    </div>
                    <p className="font-mono">
                      {preview.notTracking
                        .slice(0, 12)
                        .map((item) => item.sku)
                        .join(", ")}
                      {preview.notTracking.length > 12 ? " …" : ""}
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sync history</CardTitle>
            <CardDescription>
              The last 20 runs for {selected.name}, newest first. Click a row to see every product
              that was sent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {runsQuery.isLoading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
              </p>
            )}

            {!runsQuery.isLoading && runsQuery.runs.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing has been pushed to this website yet.
              </p>
            )}

            {runsQuery.runs.length > 0 && (
              <div className="overflow-auto rounded-md border">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Sent</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runsQuery.runs.map((run) => (
                      <TableRow
                        key={run.id}
                        className="cursor-pointer"
                        onClick={() => setDetailRunId(run.id)}
                      >
                        <TableCell className="whitespace-nowrap text-xs">
                          {run.startedAt ? formatDateTime(run.startedAt) : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {MODE_LABELS[run.mode as StockSyncMode] ?? run.mode}
                        </TableCell>
                        <TableCell>
                          <SyncStatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          {run.succeeded}/{run.changedItems}
                        </TableCell>
                        <TableCell className="text-right">
                          {run.failed > 0 ? <span className="text-destructive">{run.failed}</span> : 0}
                        </TableCell>
                        <TableCell className="max-w-[28rem] truncate text-xs text-muted-foreground">
                          {run.message ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add a website"}</DialogTitle>
            <DialogDescription>
              WooCommerce &gt; Settings &gt; Advanced &gt; REST API &gt; Add key (Read/Write). The key
              is encrypted before it is stored and is never shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="website-name">Name</Label>
              <Input
                id="website-name"
                value={form.name}
                placeholder="SmartLife Retail"
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="website-url">Address</Label>
              <Input
                id="website-url"
                value={form.baseUrl}
                placeholder="https://www.smartlife-vn.com"
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                The shop root, not the API path - <code>/wp-json/wc/v3</code> is added automatically.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="website-key">Consumer key</Label>
                <Input
                  id="website-key"
                  type="password"
                  autoComplete="off"
                  value={form.consumerKey}
                  placeholder={editing?.hasCredentials ? "Leave blank to keep" : "ck_…"}
                  onChange={(event) => setForm({ ...form, consumerKey: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website-secret">Consumer secret</Label>
                <Input
                  id="website-secret"
                  type="password"
                  autoComplete="off"
                  value={form.consumerSecret}
                  placeholder={editing?.hasCredentials ? "Leave blank to keep" : "cs_…"}
                  onChange={(event) => setForm({ ...form, consumerSecret: event.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Which stock feeds this shop</Label>
              <Select
                value={form.stockScope}
                onValueChange={(value) =>
                  setForm({ ...form, stockScope: value as WebsiteStockScope })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick the stock source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{SCOPE_LABELS.ALL}</SelectItem>
                  <SelectItem value="DC">{SCOPE_LABELS.DC}</SelectItem>
                  <SelectItem value="STORES">{SCOPE_LABELS.STORES}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The website sells from every shelf by default; the total is one number per product.
              </p>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <SwitchRow
                label="Channel active"
                description="A switched-off channel cannot be synced."
                checked={form.isActive}
                onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
              />
              <SwitchRow
                label="Clamp negative stock to 0"
                description="An over-sold line reaches the shop as 0, never as a negative number."
                checked={form.clampNegative}
                onCheckedChange={(checked) => setForm({ ...form, clampNegative: checked })}
              />
              <SwitchRow
                label="Allow backorders"
                description="Off means an item sells to exactly 0 and then the shop refuses the sale."
                checked={form.allowBackorders}
                onCheckedChange={(checked) => setForm({ ...form, allowBackorders: checked })}
              />
              <SwitchRow
                label="Force stock tracking"
                description={'Also tick "Track stock quantity" on products that do not track it. Changes how the shop behaves - off by default.'}
                checked={form.forceManageStock}
                onCheckedChange={(checked) => setForm({ ...form, forceManageStock: checked })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending ||
                !form.name.trim() ||
                !form.baseUrl.trim() ||
                (!editing && (!form.consumerKey.trim() || !form.consumerSecret.trim()))
              }
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save website
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={detailRunId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailRunId(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Sync run #{detailRunId ?? ""}</DialogTitle>
            <DialogDescription>
              {runDetailQuery.run
                ? `${runDetailQuery.run.channelName ?? "Website"} - ${MODE_LABELS[runDetailQuery.run.mode as StockSyncMode] ?? runDetailQuery.run.mode} - ${runDetailQuery.run.message ?? ""}`
                : "Loading the run…"}
            </DialogDescription>
          </DialogHeader>

          {runDetailQuery.isLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the lines…
            </p>
          )}

          {runDetailQuery.error && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" /> {errorMessage(runDetailQuery.error)}
            </p>
          )}

          {runDetailQuery.run && runDetailQuery.run.items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              That run sent nothing - every linked product already matched.
            </p>
          )}

          {runDetailQuery.run && runDetailQuery.run.items.length > 0 && (
            <div className="max-h-[60vh] overflow-auto rounded-md border">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Woo ID</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Before</TableHead>
                    <TableHead className="text-right">After</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runDetailQuery.run.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.wooId === null ? "—" : `#${item.wooId}`}
                        {item.wooType === "variation" ? " (variation)" : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.quantitySent === null ? "—" : formatQuantity(item.quantitySent)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {item.wooQuantityBefore === null ? "—" : formatQuantity(item.wooQuantityBefore)}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.wooQuantityAfter === null ? "—" : formatQuantity(item.wooQuantityAfter)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.status === "success" ? "secondary" : "destructive"}>
                          {item.status === "success" ? "Updated" : "Failed"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[22rem] truncate text-xs text-muted-foreground">
                        {item.message ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailRunId(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A single preview number, tinted when it needs attention. */
function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "primary" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        tone === "primary" && "border-primary/40 bg-primary/5",
        tone === "warning" && value > 0 && "border-amber-300 bg-amber-50",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{formatQuantity(value)}</p>
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
