import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface Supplier {
  id: number;
  name: string;
}

interface PurchaseOrder {
  id: number;
  orderNumber: string;
  supplier: Supplier;
  createdAt: string;
  deliveryDate: string;
  totalAmount: number;
  status: 'pending' | 'confirmed' | 'delivered';
}

function PurchaseOrdersPage() {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: purchaseOrders = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ['/api/purchase-orders'],
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Purchase Orders</h1>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Purchase Order
        </Button>
      </div>

      <Card>
        <div className="p-6">
          {isLoading ? (
            <div className="text-center py-4">Loading purchase orders...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Delivery Date</TableHead>
                  <TableHead>Total Amount (VND)</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchaseOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>{order.orderNumber}</TableCell>
                    <TableCell>{order.supplier?.name}</TableCell>
                    <TableCell>{formatDate(order.createdAt)}</TableCell>
                    <TableCell>{formatDate(order.deliveryDate)}</TableCell>
                    <TableCell>{Number(order.totalAmount).toLocaleString()}</TableCell>
                    <TableCell className="capitalize">{order.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}

export default PurchaseOrdersPage;