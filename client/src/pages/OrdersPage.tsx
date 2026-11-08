import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchInput } from "@/components/ui/search-input";
import { ColumnHeader, TableControlsBar } from "@/components/ui/table-controls";
import { useTableControls } from "@/hooks/use-table-controls";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { formatDate } from "@/utils/format";

interface OrderItem {
  id: number;
  product: {
    name: string;
    sku: string;
  };
  quantity: number;
  price: number;
}

interface Order {
  id: number;
  customerName: string;
  customerEmail: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  total: number;
  createdAt: string;
  items: OrderItem[];
}

function OrdersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: orders, isLoading } = useQuery<Order[]>({
    queryKey: ['/api/orders'],
  });

  // Header controls: click a column header to sort it (asc -> desc -> none) and
  // use the small input under a header to filter that single column.
  const ordersTable = useTableControls(
    orders,
    {
      orderId: (order) => order.id,
      customer: (order) => `${order.customerName} ${order.customerEmail}`,
      items: (order) => order.items.length,
      total: (order) => order.total,
      status: (order) => order.status,
      date: (order) => new Date(order.createdAt),
    },
    {
      // The page level search box and status filter stay the primary filters.
      filter: (order) =>
        (order.customerName.toLowerCase().includes(search.toLowerCase()) ||
          order.customerEmail.toLowerCase().includes(search.toLowerCase())) &&
        (statusFilter === "all" || order.status === statusFilter),
    }
  );

  // Rows currently visible (search + status filter + column filters + sorting).
  const filteredOrders = ordersTable.rows;

  const getStatusColor = (status: Order['status']) => {
    const colors = {
      pending: 'bg-warning-subtle text-warning-subtle-foreground',
      processing: 'bg-info-subtle text-info-subtle-foreground',
      shipped: 'bg-primary-subtle text-primary-subtle-foreground',
      delivered: 'bg-success-subtle text-success-subtle-foreground',
      cancelled: 'bg-destructive-subtle text-destructive-subtle-foreground'
    };
    return colors[status];
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Order List</CardTitle>
          <div className="flex items-center gap-4">
            <SearchInput
              containerClassName="flex-1 max-w-sm"
              placeholder="Search orders..."
              value={search}
              onValueChange={setSearch}
            />
            <Select
              value={statusFilter}
              onValueChange={setStatusFilter}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="shipped">Shipped</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button>Export</Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
            <TableControlsBar controls={ordersTable} noun="orders" />
            <Table>
              <TableHeader>
                <TableRow>
                  <ColumnHeader controls={ordersTable} columnKey="orderId" label="Order ID" filterPlaceholder="Filter order ID" />
                  <ColumnHeader controls={ordersTable} columnKey="customer" label="Customer" filterPlaceholder="Filter customer" />
                  <ColumnHeader controls={ordersTable} columnKey="items" label="Items" filterPlaceholder="Filter items" />
                  <ColumnHeader controls={ordersTable} columnKey="total" label="Total" filterPlaceholder="Filter total" />
                  <ColumnHeader controls={ordersTable} columnKey="status" label="Status" filterPlaceholder="Filter status" />
                  <ColumnHeader controls={ordersTable} columnKey="date" label="Date" filterPlaceholder="Filter date" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders?.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>#{order.id}</TableCell>
                    <TableCell>
                      <div>{order.customerName}</div>
                      <div className="text-sm text-muted-foreground">{order.customerEmail}</div>
                    </TableCell>
                    <TableCell>{order.items.length} items</TableCell>
                    <TableCell>${order.total.toFixed(2)}</TableCell>
                    <TableCell>
                      <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                        {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(order.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default OrdersPage;