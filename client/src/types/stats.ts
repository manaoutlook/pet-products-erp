export interface DashboardStats {
  totalOrders: number;
  revenue: number;
  totalProducts: number;
  growth: number;
  lowStock: {
    id: number;
    name: string;
    quantity: number;
  }[];
}

export interface OrderTrend {
  date: string;
  orders: number;
}
