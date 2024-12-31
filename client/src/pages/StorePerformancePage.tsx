import { useQuery } from "@tanstack/react-query";
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
import { Loader2 } from "lucide-react";

interface StoreMetrics {
  storeId: number;
  storeName: string;
  orderCount: number;
  revenue: number;
  averageOrderValue: number;
  fulfillmentRate: number;
  inventoryTurnover: number;
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

function StorePerformancePage() {
  const { data, isLoading } = useQuery<PerformanceData>({
    queryKey: ['/api/stores/performance'],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const currentMetrics = data?.currentMetrics || [];
  const historicalData = data?.historicalData || [];
  const inventoryStatus = data?.inventoryStatus || [];

  // Format currency for VND
  const formatCurrency = (value: number) => 
    new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND'
    }).format(value);

  // Format percentage
  const formatPercentage = (value: number) => 
    `${(value * 100).toFixed(1)}%`;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Store Performance Dashboard</h1>
      
      {/* Revenue Comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Revenue Comparison</CardTitle>
          <CardDescription>Compare revenue across all stores</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={currentMetrics}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="storeName" />
                <YAxis tickFormatter={(value) => formatCurrency(value)} />
                <Tooltip 
                  formatter={(value: number) => formatCurrency(value)}
                  labelFormatter={(label) => `Store: ${label}`}
                />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={currentMetrics}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="storeName" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="orderCount" name="Orders" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={currentMetrics}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="storeName" />
                  <YAxis tickFormatter={(value) => formatCurrency(value)} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="averageOrderValue" name="Avg Order" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={currentMetrics}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="storeName" />
                  <YAxis tickFormatter={(value) => formatPercentage(value)} />
                  <Tooltip formatter={(value: number) => formatPercentage(value)} />
                  <Bar dataKey="fulfillmentRate" name="Fulfillment Rate" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
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
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historicalData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="month" 
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                  }}
                />
                <YAxis tickFormatter={(value) => formatCurrency(value)} />
                <Tooltip 
                  formatter={(value: number) => formatCurrency(value)}
                  labelFormatter={(label) => new Date(label).toLocaleDateString('en-US', { 
                    month: 'long',
                    year: 'numeric'
                  })}
                />
                <Legend />
                {currentMetrics.map((store) => (
                  <Line
                    key={store.storeId}
                    type="monotone"
                    dataKey="revenue"
                    data={historicalData.filter(d => d.storeId === store.storeId)}
                    name={store.storeName}
                    stroke={`hsl(${store.storeId * 60}, 70%, 50%)`}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
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
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="storeName" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="totalItems" name="Total Items" fill="hsl(var(--primary))" />
                <Bar dataKey="lowStockItems" name="Low Stock Items" fill="hsl(var(--destructive))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default StorePerformancePage;