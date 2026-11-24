import { useQuery } from "@tanstack/react-query";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import { chartTheme } from "@/lib/chart-theme";
import { formatCompactCurrency, formatCurrency, formatMonthLabel, formatPercent } from "@/utils/format";

interface StoreMetrics {
  storeId: number;
  storeName: string;
  orderCount: number;
  revenue: number;
  averageOrderValue: number;
  fulfillmentRate: number;
}

interface HistoricalData {
  storeId: number;
  month: string;
  revenue: number;
  orderCount: number;
}

interface InventoryStatus {
  storeId: number;
  totalItems: number;
  lowStockItems: number;
}

interface PerformanceData {
  currentMetrics: StoreMetrics[];
  historicalData: HistoricalData[];
  inventoryStatus: InventoryStatus[];
}

/**
 * `YYYY-MM-01` -> "May 26", without re-parsing the string in the browser's zone.
 * `new Date("2026-05-01")` is UTC midnight, which is the previous day west of Greenwich.
 */
function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return formatMonthLabel(new Date(year, monthNumber - 1, 1));
}

/** A chart that has nothing to plot says so, instead of drawing bare axes. */
function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center">
      <p className="text-sm font-medium">{message}</p>
      <p className="text-xs text-muted-foreground">
        Sales from the till and from sales orders both count towards these figures.
      </p>
    </div>
  );
}

const axisProps = {
  stroke: chartTheme.axis,
  tick: { fill: chartTheme.axis, fontSize: 12 },
  tickLine: false,
} as const;

function StorePerformancePage() {
  // `isError` is tracked separately from "no data": a failed request used to render as a page of
  // confident zeros, which reads as a shop that sold nothing rather than a page that broke.
  const { data, isLoading, isError, isFetching, refetch } = useQuery<PerformanceData>({
    queryKey: ['/api/stores/performance'],
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-3xl font-bold tracking-tight">Store Performance Dashboard</h1>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-[260px] w-full" />
          ))}
        </div>
      </div>
    );
  }

  const currentMetrics = data?.currentMetrics || [];
  const historicalData = data?.historicalData || [];
  const inventoryStatus = data?.inventoryStatus || [];

  const hasStores = currentMetrics.length > 0;
  const hasRevenue = currentMetrics.some((store) => store.revenue > 0);
  const hasOrders = currentMetrics.some((store) => store.orderCount > 0);
  const hasFulfillment = currentMetrics.some((store) => store.fulfillmentRate > 0);
  const hasHistory = historicalData.some((point) => point.revenue > 0);
  const hasInventory = inventoryStatus.some((status) => status.totalItems > 0);

  // One row per month with a column per store - the shape a multi-series LineChart needs.
  // The old code gave every <Line> its own filtered `data` while the chart kept a single axis,
  // so the months and the series could not line up.
  const months = Array.from(new Set(historicalData.map((point) => point.month))).sort();
  const trendData = months.map((month) => {
    const row: Record<string, string | number> = { month };
    for (const store of currentMetrics) {
      row[store.storeName] =
        historicalData.find(
          (point) => point.storeId === store.storeId && point.month === month
        )?.revenue ?? 0;
    }
    return row;
  });
  const seriesColors = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'];

  // Amounts and percentages come from utils/format.ts: this page used to build its own
  // Intl.NumberFormat here and format percentages with toFixed, so it disagreed with
  // the rest of the app (grouping and decimal places).

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Store Performance Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            This month, with the last 6 months of history
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Store performance could not be loaded</AlertTitle>
          <AlertDescription>
            These figures are unavailable, not zero. Check the connection and try again.
          </AlertDescription>
        </Alert>
      )}

      {!isError && !hasStores && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No stores to compare</AlertTitle>
          <AlertDescription>
            You are not assigned to a store yet, so there is nothing to break down by store.
          </AlertDescription>
        </Alert>
      )}
      
      {/* Revenue Comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Revenue Comparison</CardTitle>
          <CardDescription>Compare revenue across all stores</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
            {isError ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Revenue figures unavailable
              </p>
            ) : !hasRevenue ? (
              <EmptyChart message="No revenue recorded this month" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={currentMetrics}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="storeName" {...axisProps} />
                  <YAxis tickFormatter={(value) => formatCompactCurrency(value)} {...axisProps} axisLine={false} width={70} />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    labelFormatter={(label) => `Store: ${label}`}
                    contentStyle={chartTheme.tooltip}
                    cursor={{ fill: chartTheme.grid, fillOpacity: 0.25 }}
                  />
                  {/* The chart used to render no series at all - the endpoint returned `totalSales`
                      and the page plotted `revenue`, so this card was always empty. */}
                  <Bar dataKey="revenue" name="Revenue" fill={chartTheme.line} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Performance Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Order Count */}
        <Card>
          <CardHeader>
            <CardTitle>Order Volume</CardTitle>
            <CardDescription>Monthly order count by store</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {isError ? (
                <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Order figures unavailable
                </p>
              ) : !hasOrders ? (
                <EmptyChart message="No orders this month" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={currentMetrics}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                    <XAxis dataKey="storeName" {...axisProps} />
                    <YAxis {...axisProps} axisLine={false} allowDecimals={false} width={40} />
                    <Tooltip
                      contentStyle={chartTheme.tooltip}
                      cursor={{ fill: chartTheme.grid, fillOpacity: 0.25 }}
                    />
                    <Bar dataKey="orderCount" name="Orders" fill={chartTheme.line} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Average Order Value */}
        <Card>
          <CardHeader>
            <CardTitle>Average Order Value</CardTitle>
            <CardDescription>Average transaction amount</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {isError ? (
                <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Average order value unavailable
                </p>
              ) : !hasRevenue ? (
                <EmptyChart message="No orders this month" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={currentMetrics}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                    <XAxis dataKey="storeName" {...axisProps} />
                    <YAxis
                      tickFormatter={(value) => formatCompactCurrency(value)}
                      {...axisProps}
                      axisLine={false}
                      width={70}
                    />
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                      contentStyle={chartTheme.tooltip}
                      cursor={{ fill: chartTheme.grid, fillOpacity: 0.25 }}
                    />
                    <Bar dataKey="averageOrderValue" name="Avg Order" fill={chartTheme.line} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Fulfillment Rate */}
        <Card>
          <CardHeader>
            <CardTitle>Order Fulfillment Rate</CardTitle>
            <CardDescription>Completed orders percentage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {isError ? (
                <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Fulfillment figures unavailable
                </p>
              ) : !hasFulfillment ? (
                <EmptyChart message="No fulfilled orders this month" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={currentMetrics}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                    <XAxis dataKey="storeName" {...axisProps} />
                    <YAxis
                      tickFormatter={(value) => formatPercent(value)}
                      domain={[0, 1]}
                      {...axisProps}
                      axisLine={false}
                      width={50}
                    />
                    <Tooltip
                      formatter={(value: number) => formatPercent(value)}
                      contentStyle={chartTheme.tooltip}
                      cursor={{ fill: chartTheme.grid, fillOpacity: 0.25 }}
                    />
                    <Bar dataKey="fulfillmentRate" name="Fulfillment Rate" fill={chartTheme.line} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Historical Trends */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Trends</CardTitle>
          <CardDescription>6-month revenue history by store</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
            {isError ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Revenue history unavailable
              </p>
            ) : !hasHistory ? (
              <EmptyChart message="No revenue in the last 6 months" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps} />
                  <YAxis
                    tickFormatter={(value) => formatCompactCurrency(value)}
                    {...axisProps}
                    axisLine={false}
                    width={70}
                  />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    labelFormatter={(label) => monthLabel(String(label))}
                    contentStyle={chartTheme.tooltip}
                  />
                  <Legend />
                  {currentMetrics.map((store, index) => (
                    <Line
                      key={store.storeId}
                      type="monotone"
                      dataKey={store.storeName}
                      name={store.storeName}
                      stroke={`hsl(var(${seriesColors[index % seriesColors.length]}))`}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Inventory Status */}
      <Card>
        <CardHeader>
          <CardTitle>Inventory Health</CardTitle>
          <CardDescription>Low stock items vs total inventory</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            {isError ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Inventory figures unavailable
              </p>
            ) : !hasInventory ? (
              <EmptyChart message="No stock recorded in these stores" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={currentMetrics.map(store => {
                    const status = inventoryStatus.find(s => s.storeId === store.storeId);
                    return {
                      storeName: store.storeName,
                      totalItems: status?.totalItems || 0,
                      lowStockItems: status?.lowStockItems || 0
                    };
                  })}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="storeName" {...axisProps} />
                  <YAxis {...axisProps} axisLine={false} allowDecimals={false} width={40} />
                  <Tooltip
                    contentStyle={chartTheme.tooltip}
                    cursor={{ fill: chartTheme.grid, fillOpacity: 0.25 }}
                  />
                  <Legend />
                  <Bar dataKey="totalItems" name="Total Items" fill={chartTheme.line} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="lowStockItems" name="Low Stock Items" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default StorePerformancePage;