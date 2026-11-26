import { Link } from "wouter";
import { AlertCircle, Banknote, PackageSearch, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import StatsCards, { type DashboardStats } from "@/components/Dashboard/StatsCards";
import { chartTheme } from "@/lib/chart-theme";
import { usePermissions } from "@/hooks/use-permissions";
import { formatCompactCurrency, formatCurrency, formatNumber } from "@/utils/format";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** One day of the chart - mirrors `OrderTrendPoint` in server/dashboard-stats.ts. */
interface OrderTrendPoint {
  date: string;
  orders: number;
  revenue: number;
  posSales: number;
  salesOrders: number;
}

interface DashboardResponse {
  stats: DashboardStats;
  trend: OrderTrendPoint[];
}

/** Mirrors `CashOnHand` in server/finance.ts (`GET /api/finance/cash-on-hand`). */
interface CashOnHand {
  asOf: string;
  total: number;
  moneyIn: number;
  moneyOut: number;
  openingBalance: number;
  byMethod: Array<{
    method: string;
    label: string;
    moneyIn: number;
    moneyOut: number;
    balance: number;
  }>;
}

/**
 * `YYYY-MM-DD` -> `DD/MM/YYYY`.
 *
 * AI Agent Note - deliberately not `formatDate()`: that parses a bare date string as UTC
 * midnight, so a browser west of Greenwich would render the previous day. The server already
 * sent a Vietnamese calendar day; this only rearranges its digits.
 */
function dayLabel(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

/** Short x-axis tick, `YYYY-MM-DD` -> `DD/MM`. */
function axisDay(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}/${month}`;
}

/** The chart tooltip: the day's money first, then where it came from. */
function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: OrderTrendPoint }[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">{dayLabel(point.date)}</p>
      <p className="mt-1 text-sm font-semibold">{formatCurrency(point.revenue)}</p>
      <p className="text-muted-foreground">
        {formatNumber(point.orders)} sale{point.orders === 1 ? "" : "s"} ·{" "}
        {formatNumber(point.posSales)} POS · {formatNumber(point.salesOrders)} orders
      </p>
    </div>
  );
}


function DashboardPage() {
  // One request for the tiles and the chart: they must describe the same 30 days, so they cannot
  // arrive from two endpoints that disagree. `isError` is separate from "no data" on purpose -
  // a failed fetch used to render as a confident 0.
  const { data, isLoading, isError, isFetching, refetch } = useQuery<DashboardResponse>({
    queryKey: ["/api/dashboard"],
  });

  // Money on hand comes from Finance, so the card is only asked for (and only shown) when the
  // role may read Finance - otherwise the request would be a 403 drawn as a broken dashboard.
  // The figure is a balance: no date range, same builder as the Finance report's card.
  const { hasPermission } = usePermissions();
  const canReadFinance = hasPermission("finance", "read");
  const cashQuery = useQuery<CashOnHand>({
    queryKey: ["/api/finance/cash-on-hand"],
    enabled: canReadFinance,
  });

  const refreshAll = () => {
    refetch();
    if (canReadFinance) cashQuery.refetch();
  };

  const stats = data?.stats;
  const trend = data?.trend ?? [];
  const hasActivity = trend.some((point) => point.orders > 0 || point.revenue > 0);
  const tradingDays = trend.filter((point) => point.orders > 0).length;
  const lowStock = stats?.lowStock ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {stats
              ? `${dayLabel(stats.last30Days.from)} – ${dayLabel(stats.last30Days.to)}`
              : "Last 30 days"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>The dashboard could not be loaded</AlertTitle>
          <AlertDescription>
            These figures are unavailable, not zero. Check the connection and try again.
          </AlertDescription>
        </Alert>
      )}

      <StatsCards stats={stats} isLoading={isLoading} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {canReadFinance ? (
          <Card className="p-6" data-testid="dashboard-money-on-hand">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Banknote className="h-4 w-4" />
                  Money on hand
                </h2>
                <p className="text-sm text-muted-foreground">
                  Till and bank per the books, as at{" "}
                  {cashQuery.data ? dayLabel(cashQuery.data.asOf) : "today"}
                </p>
              </div>
              <Link href="/finance" className="text-sm font-medium text-primary hover:underline">
                Finance
              </Link>
            </div>

            {cashQuery.isError ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Money figures unavailable
              </p>
            ) : cashQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <>
                <div
                  className="text-2xl font-semibold"
                  data-testid="dashboard-money-on-hand-total"
                >
                  {formatCurrency(cashQuery.data?.total ?? 0)}
                </div>
                {(cashQuery.data?.byMethod ?? []).length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Nothing has been recorded yet, so there is no money to show.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {(cashQuery.data?.byMethod ?? []).map((row) => (
                      <div
                        key={row.method}
                        data-testid={`dashboard-money-on-hand-${row.method.toLowerCase()}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-md border border-border px-3 py-2"
                      >
                        <span className="text-sm">{row.label}</span>
                        <span className="text-sm font-medium">{formatCurrency(row.balance)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {(cashQuery.data?.openingBalance ?? 0) > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Includes {formatCurrency(cashQuery.data!.openingBalance)} recorded as the
                    opening balance.
                  </p>
                )}
              </>
            )}
          </Card>
        ) : null}

        <Card className="p-6">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Sales trend</h2>
              <p className="text-sm text-muted-foreground">Revenue per day, last 30 days</p>
            </div>
            {stats && (
              <span className="text-sm font-semibold">
                {formatCurrency(stats.last30Days.revenue)}
              </span>
            )}
          </div>
          <div className="h-[300px]">
            {isError ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Sales figures unavailable
              </p>
            ) : isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : !hasActivity ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm font-medium">No sales in the last 30 days</p>
                <p className="text-xs text-muted-foreground">
                  Sales from the till and from sales orders both appear here.
                </p>
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link href="/pos">Open the till</Link>
                </Button>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={axisDay}
                    stroke={chartTheme.axis}
                    tick={{ fill: chartTheme.axis, fontSize: 12 }}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    stroke={chartTheme.axis}
                    tick={{ fill: chartTheme.axis, fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={70}
                    tickFormatter={(value: number) => formatCompactCurrency(value)}
                  />
                  <Tooltip content={<TrendTooltip />} cursor={{ stroke: chartTheme.grid }} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke={chartTheme.line}
                    strokeWidth={2}
                    fill={chartTheme.line}
                    fillOpacity={0.14}
                    // A shop that traded on one or two days would otherwise draw a line with no
                    // visible points at all, which reads as an empty chart.
                    dot={
                      tradingDays <= 2
                        ? { r: 3, fill: chartTheme.line, strokeWidth: 0 }
                        : false
                    }
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Stock to reorder</h2>
              <p className="text-sm text-muted-foreground">At or below its minimum level</p>
            </div>
            <Link href="/inventory" className="text-sm font-medium text-primary hover:underline">
              Inventory
            </Link>
          </div>

          {isError ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Stock figures unavailable
            </p>
          ) : isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : lowStock.length > 0 ? (
            <div className="space-y-1">
              {lowStock.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.sku}</p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-destructive">
                    {formatNumber(item.quantity)} left · min {formatNumber(item.minStock)}
                  </span>
                </div>
              ))}
              {lowStock.length === 5 && (
                <p className="pt-2 text-xs text-muted-foreground">
                  Showing the five lowest.{" "}
                  <Link href="/inventory" className="underline">
                    See all
                  </Link>
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center">
              <PackageSearch className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">Nothing needs reordering</p>
              <p className="text-xs text-muted-foreground">
                Every product is above its minimum stock level.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default DashboardPage;
