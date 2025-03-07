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

import React from 'react';

function DashboardPage() {
  const { data: stats } = useQuery({
    queryKey: ['/api/stats'],
  });

  const { data: orderTrends } = useQuery({
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
              <LineChart data={orderTrends}>
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
          {stats?.lowStock?.map((item: any) => (
            <div key={item.id} className="flex justify-between items-center py-2">
              <span>{item.name}</span>
              <span className="text-red-500">{item.quantity} remaining</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

export default DashboardPage;

export default function DashboardPage() {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-2">Total Orders</h2>
          <p className="text-3xl font-bold">128</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-2">Revenue</h2>
          <p className="text-3xl font-bold">24,500,000 VND</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-2">Low Stock Items</h2>
          <p className="text-3xl font-bold">12</p>
        </div>
      </div>
      
      <div className="bg-white p-6 rounded-lg shadow mb-8">
        <h2 className="text-xl font-semibold mb-4">Recent Orders</h2>
        <table className="min-w-full">
          <thead>
            <tr>
              <th className="px-4 py-2 text-left">Order ID</th>
              <th className="px-4 py-2 text-left">Customer</th>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Amount</th>
              <th className="px-4 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-2">#12345</td>
              <td className="px-4 py-2">Nguyen Van A</td>
              <td className="px-4 py-2">2023-06-05</td>
              <td className="px-4 py-2">1,200,000 VND</td>
              <td className="px-4 py-2"><span className="px-2 py-1 bg-green-100 text-green-800 rounded">Completed</span></td>
            </tr>
            <tr>
              <td className="px-4 py-2">#12344</td>
              <td className="px-4 py-2">Tran Thi B</td>
              <td className="px-4 py-2">2023-06-04</td>
              <td className="px-4 py-2">850,000 VND</td>
              <td className="px-4 py-2"><span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded">Processing</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
