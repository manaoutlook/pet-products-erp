import { Card } from "@/components/ui/card";
import StatsCards from "@/components/Dashboard/StatsCards";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";
import type { DashboardStats, OrderTrend } from "@/types/stats";

function DashboardPage() {
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['/api/stats'],
  });

  const { data: orderTrends } = useQuery<OrderTrend[]>({
    queryKey: ['/api/stats/orders-trend'],
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      </div>

      <StatsCards />

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Order Trends</h2>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={orderTrends ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="orders" stroke="#8884d8" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Low Stock Alerts</h2>
          {stats?.lowStock?.map((item) => (
            <div key={item.id} className="flex justify-between items-center py-2">
              <span>{item.name}</span>
              <span className="text-red-500">{item.quantity} remaining</span>
            </div>
          )) ?? (
            <p className="text-muted-foreground">No low stock items</p>
          )}
        </Card>
      </div>
    </div>
  );
}

export default DashboardPage;