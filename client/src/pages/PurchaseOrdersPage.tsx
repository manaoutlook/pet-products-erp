import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Printer,
  FileText,
  CreditCard,
  Package,
  X,
  CheckCircle,
  Circle,
  History,
  Clock,
  User,
  Search
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import { CreatePurchaseOrderDialog } from "@/components/PurchaseOrders/CreatePurchaseOrderDialog";

interface Supplier {
  id: number;
  name: string;
}

interface PurchaseOrderAction {
  id: number;
  actionType: 'cancel' | 'print' | 'invoice_received' | 'payment_sent' | 'goods_receipt';
  performedByUser: {
    id: number;
    username: string;
  };
  performedAt: string;
}

interface PurchaseOrder {
  id: number;
  orderNumber: string;
  supplier: Supplier;
  createdAt: string;
  deliveryDate: string;
  totalAmount: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  actions?: PurchaseOrderAction[];
}

function PurchaseOrdersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: purchaseOrders = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ['/api/purchase-orders'],
  });

  const logAction = useMutation({
    mutationFn: async ({ orderId, actionType }: { orderId: number; actionType: string }) => {
      const response = await fetch(`/api/purchase-orders/${orderId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ actionType }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to log action');
      }

      return response.json();
    },
    onSuccess: () => {
      // Force refresh the purchase orders data
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'], exact: true });
      toast({
        title: "Success",
        description: "Action logged successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const printOrder = (orderNumber: string) => {
    // Simple print functionality - in a real app you'd generate a proper document
    const printContent = `
      Purchase Order: ${orderNumber}
      Printed on: ${new Date().toLocaleDateString()}
    `;
    const printWindow = window.open('', '_blank');
    printWindow?.document.write(printContent);
    printWindow?.print();
    printWindow?.close();

    // Log the print action
    const order = purchaseOrders.find((o: PurchaseOrder) => o.orderNumber === orderNumber);
    if (order) {
      logAction.mutate({ orderId: order.id, actionType: 'print' });
    }
  };

  const hasAction = (order: PurchaseOrder, actionType: string): boolean => {
    return order.actions?.some(action => action.actionType === actionType) || false;
  };

  const canPerformAction = (order: PurchaseOrder, actionType: string): boolean => {
    if (order.status === 'cancelled' || order.status === 'delivered') {
      return false;
    }

    switch (actionType) {
      case 'cancel':
        return true; // Can cancel if not completed/cancelled
      case 'print':
        return true;
      case 'invoice_received':
        return order.status === 'pending' || order.status === 'confirmed';
      case 'payment_sent':
        return hasAction(order, 'invoice_received');
      case 'goods_receipt':
        return hasAction(order, 'payment_sent');
      default:
        return false;
    }
  };

  const getActionLabel = (actionType: string): string => {
    switch (actionType) {
      case 'cancel':
        return 'Order Cancelled';
      case 'print':
        return 'Order Printed';
      case 'invoice_received':
        return 'Invoice Received';
      case 'payment_sent':
        return 'Payment Sent';
      case 'goods_receipt':
        return 'Goods Receipt Processed';
      default:
        return actionType;
    }
  };

  // Filter purchase orders based on search term
  const filteredPurchaseOrders = purchaseOrders?.filter((order: PurchaseOrder) =>
    order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.supplier?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.status.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.totalAmount.toString().includes(searchTerm)
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Purchase Orders</h1>
        <CreatePurchaseOrderDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Purchase Order List</CardTitle>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search purchase orders..."
                className="pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
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
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPurchaseOrders.map((order: PurchaseOrder) => (
                  <TableRow key={order.id}>
                    <TableCell>{order.orderNumber}</TableCell>
                    <TableCell>{order.supplier?.name}</TableCell>
                    <TableCell>{formatDate(order.createdAt)}</TableCell>
                    <TableCell>{formatDate(order.deliveryDate)}</TableCell>
                    <TableCell>{Number(order.totalAmount).toLocaleString()}</TableCell>
                    <TableCell className="capitalize">{order.status}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {/* Print */}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => printOrder(order.orderNumber)}
                          disabled={!canPerformAction(order, 'print')}
                          title="Print Order"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>

                        {/* Invoice Received */}
                        <Button
                          size="sm"
                          variant={hasAction(order, 'invoice_received') ? "default" : "outline"}
                          onClick={() => logAction.mutate({ orderId: order.id, actionType: 'invoice_received' })}
                          disabled={!canPerformAction(order, 'invoice_received')}
                          title="Mark Invoice Received"
                        >
                          {hasAction(order, 'invoice_received') ? (
                            <CheckCircle className="h-4 w-4" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                        </Button>

                        {/* Payment Sent */}
                        <Button
                          size="sm"
                          variant={hasAction(order, 'payment_sent') ? "default" : "outline"}
                          onClick={() => logAction.mutate({ orderId: order.id, actionType: 'payment_sent' })}
                          disabled={!canPerformAction(order, 'payment_sent')}
                          title="Mark Payment Sent"
                        >
                          {hasAction(order, 'payment_sent') ? (
                            <CheckCircle className="h-4 w-4" />
                          ) : (
                            <CreditCard className="h-4 w-4" />
                          )}
                        </Button>

                        {/* Goods Receipt */}
                        <Button
                          size="sm"
                          variant={hasAction(order, 'goods_receipt') ? "default" : "outline"}
                          onClick={() => logAction.mutate({ orderId: order.id, actionType: 'goods_receipt' })}
                          disabled={!canPerformAction(order, 'goods_receipt')}
                          title="Process Goods Receipt"
                        >
                          {hasAction(order, 'goods_receipt') ? (
                            <CheckCircle className="h-4 w-4" />
                          ) : (
                            <Package className="h-4 w-4" />
                          )}
                        </Button>

                        {/* Cancel */}
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => logAction.mutate({ orderId: order.id, actionType: 'cancel' })}
                          disabled={!canPerformAction(order, 'cancel')}
                          title="Cancel Order"
                        >
                          <X className="h-4 w-4" />
                        </Button>

                        {/* Action History */}
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              title="View Action History"
                            >
                              <History className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>Action History - {order.orderNumber}</DialogTitle>
                              <DialogDescription>
                                Complete timeline of actions performed on this purchase order
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 max-h-96 overflow-y-auto">
                              {(!order.actions || order.actions.length === 0) ? (
                                <div className="text-center text-muted-foreground py-8">
                                  No actions recorded yet
                                </div>
                              ) : (
                                order.actions
                                  .sort((a, b) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime())
                                  .map((action: PurchaseOrderAction, index: number) => (
                                    <div key={action.id} className="flex items-start gap-4 p-4 border rounded-lg">
                                      <div className="flex-shrink-0">
                                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                          {action.actionType === 'print' && <Printer className="h-5 w-5 text-primary" />}
                                          {action.actionType === 'invoice_received' && <FileText className="h-5 w-5 text-primary" />}
                                          {action.actionType === 'payment_sent' && <CreditCard className="h-5 w-5 text-primary" />}
                                          {action.actionType === 'goods_receipt' && <Package className="h-5 w-5 text-primary" />}
                                          {action.actionType === 'cancel' && <X className="h-5 w-5 text-destructive" />}
                                        </div>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                          <h4 className="text-sm font-medium text-foreground">
                                            {getActionLabel(action.actionType)}
                                          </h4>
                                          <span className="text-xs text-muted-foreground">
                                            {formatDate(action.performedAt)}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-2">
                                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                            <User className="h-3 w-3" />
                                            {action.performedByUser.username}
                                          </div>
                                          <div className="flex items-center gap-1 text-xs text-muted-foreground ml-4">
                                            <Clock className="h-3 w-3" />
                                            {new Date(action.performedAt).toLocaleString('en-US', {
                                              year: 'numeric',
                                              month: 'short',
                                              day: 'numeric',
                                              hour: '2-digit',
                                              minute: '2-digit',
                                              second: '2-digit'
                                            })}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ))
                              )}
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default PurchaseOrdersPage;
