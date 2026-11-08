import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/utils/format";
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
import { SearchInput } from "@/components/ui/search-input";
import { ColumnHeader, TableControlsBar } from "@/components/ui/table-controls";
import { useTableControls } from "@/hooks/use-table-controls";
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
  Eye
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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

interface PurchaseOrderItem {
  id: number;
  product: {
    id: number;
    name: string;
    sku: string;
  };
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  deliveredQuantity: number;
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
  items?: PurchaseOrderItem[];
  notes?: string;
  destinationStore?: {
    id: number;
    name: string;
  } | null;
}

function PurchaseOrdersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: purchaseOrders = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ['/api/purchase-orders'],
  });

  const { data: selectedOrderDetails, isLoading: isLoadingDetails } = useQuery<PurchaseOrder>({
    queryKey: ['/api/purchase-orders', selectedOrderId],
    queryFn: async () => {
      if (!selectedOrderId) return null;
      const response = await fetch(`/api/purchase-orders/${selectedOrderId}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch purchase order details');
      }
      return response.json();
    },
    enabled: !!selectedOrderId,
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
        variant: "success",
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
      Printed on: ${formatDate(new Date())}
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
  // Header controls: click a column header to sort it (asc -> desc -> none) and
  // use the small input under a header to filter that single column.
  const purchaseOrdersTable = useTableControls(
    purchaseOrders,
    {
      orderNumber: (order) => order.orderNumber,
      supplier: (order) => order.supplier?.name,
      orderDate: (order) => (order.createdAt ? new Date(order.createdAt) : null),
      deliveryDate: (order) => (order.deliveryDate ? new Date(order.deliveryDate) : null),
      totalAmount: (order) => Number(order.totalAmount),
      status: (order) => order.status,
    },
    {
      // The page level search box stays the primary, whole row search.
      filter: (order) =>
        order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.supplier?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.status.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.totalAmount.toString().includes(searchTerm),
    }
  );

  // Rows currently visible (search + column filters + sorting).
  const filteredPurchaseOrders = purchaseOrdersTable.rows;

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
            <SearchInput
              containerClassName="flex-1 max-w-sm"
              placeholder="Search purchase orders..."
              value={searchTerm}
              onValueChange={setSearchTerm}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-4">Loading purchase orders...</div>
          ) : (
            <>
            <TableControlsBar controls={purchaseOrdersTable} noun="purchase orders" />
            <Table>
              <TableHeader>
                <TableRow>
                  <ColumnHeader controls={purchaseOrdersTable} columnKey="orderNumber" label="Order Number" filterPlaceholder="Filter order no." />
                  <ColumnHeader controls={purchaseOrdersTable} columnKey="supplier" label="Supplier" filterPlaceholder="Filter supplier" />
                  <ColumnHeader controls={purchaseOrdersTable} columnKey="orderDate" label="Order Date" filterPlaceholder="Filter order date" />
                  <ColumnHeader controls={purchaseOrdersTable} columnKey="deliveryDate" label="Delivery Date" filterPlaceholder="Filter delivery date" />
                  <ColumnHeader controls={purchaseOrdersTable} columnKey="totalAmount" label="Total Amount (VND)" filterPlaceholder="Filter total" />
                  <ColumnHeader controls={purchaseOrdersTable} columnKey="status" label="Status" filterPlaceholder="Filter status" />
                  <TableHead className="align-top">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPurchaseOrders.map((order: PurchaseOrder) => (
                  <TableRow key={order.id}>
                    <TableCell>{order.orderNumber}</TableCell>
                    <TableCell>{order.supplier?.name}</TableCell>
                    <TableCell>{formatDate(order.createdAt)}</TableCell>
                    <TableCell>{formatDate(order.deliveryDate)}</TableCell>
                    <TableCell>{formatNumber(order.totalAmount)}</TableCell>
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

                        {/* View Details */}
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedOrderId(order.id)}
                              title="View Order Details"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>Purchase Order Details - {order.orderNumber}</DialogTitle>
                              <DialogDescription>
                                Complete details of the purchase order including items and supplier information
                              </DialogDescription>
                            </DialogHeader>
                            {isLoadingDetails ? (
                              <div className="text-center py-8">Loading order details...</div>
                            ) : selectedOrderDetails ? (
                              <div className="space-y-6">
                                {/* Order Header Information */}
                                <div className="grid grid-cols-2 gap-4 p-4 border rounded-lg bg-muted/50">
                                  <div>
                                    <h4 className="font-semibold mb-2">Order Information</h4>
                                    <div className="space-y-1 text-sm">
                                      <div><strong>Order Number:</strong> {selectedOrderDetails.orderNumber}</div>
                                      <div><strong>Status:</strong> <span className="capitalize">{selectedOrderDetails.status}</span></div>
                                      <div><strong>Order Date:</strong> {formatDate(selectedOrderDetails.createdAt)}</div>
                                      <div><strong>Delivery Date:</strong> {formatDate(selectedOrderDetails.deliveryDate)}</div>
                                      {selectedOrderDetails.notes && (
                                        <div><strong>Notes:</strong> {selectedOrderDetails.notes}</div>
                                      )}
                                    </div>
                                  </div>
                                  <div>
                                    <h4 className="font-semibold mb-2">Supplier Information</h4>
                                    <div className="space-y-1 text-sm">
                                      <div><strong>Name:</strong> {selectedOrderDetails.supplier?.name}</div>
                                      <div><strong>Total Amount:</strong> {formatCurrency(selectedOrderDetails.totalAmount)}</div>
                                      <div><strong>Delivery Location:</strong> {selectedOrderDetails.destinationStore?.name || 'Main Warehouse'}</div>
                                    </div>
                                  </div>
                                </div>

                                {/* Order Items */}
                                <div>
                                  <h4 className="font-semibold mb-4">Order Items</h4>
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Product</TableHead>
                                        <TableHead>SKU</TableHead>
                                        <TableHead className="text-right">Quantity</TableHead>
                                        <TableHead className="text-right">Unit Price (VND)</TableHead>
                                        <TableHead className="text-right">Total (VND)</TableHead>
                                        <TableHead className="text-right">Delivered</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {selectedOrderDetails.items?.map((item: PurchaseOrderItem) => (
                                        <TableRow key={item.id}>
                                          <TableCell>{item.product.name}</TableCell>
                                          <TableCell className="font-mono text-sm">{item.product.sku}</TableCell>
                                          <TableCell className="text-right">{item.quantity}</TableCell>
                                          <TableCell className="text-right">{formatNumber(item.unitPrice)}</TableCell>
                                          <TableCell className="text-right">{formatNumber(item.totalPrice)}</TableCell>
                                          <TableCell className="text-right">
                                            <span className={item.deliveredQuantity === item.quantity ? "text-green-600" : "text-orange-600"}>
                                              {item.deliveredQuantity}/{item.quantity}
                                            </span>
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>

                                {/* Action History Summary */}
                                {selectedOrderDetails.actions && selectedOrderDetails.actions.length > 0 && (
                                  <div>
                                    <h4 className="font-semibold mb-4">Recent Actions</h4>
                                    <div className="space-y-2">
                                      {selectedOrderDetails.actions
                                        .sort((a: PurchaseOrderAction, b: PurchaseOrderAction) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime())
                                        .slice(0, 3)
                                        .map((action: PurchaseOrderAction) => (
                                          <div key={action.id} className="flex items-center justify-between p-3 border rounded">
                                            <div className="flex items-center gap-3">
                                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                                {action.actionType === 'print' && <Printer className="h-4 w-4 text-primary" />}
                                                {action.actionType === 'invoice_received' && <FileText className="h-4 w-4 text-primary" />}
                                                {action.actionType === 'payment_sent' && <CreditCard className="h-4 w-4 text-primary" />}
                                                {action.actionType === 'goods_receipt' && <Package className="h-4 w-4 text-primary" />}
                                                {action.actionType === 'cancel' && <X className="h-4 w-4 text-destructive" />}
                                              </div>
                                              <div>
                                                <div className="font-medium">{getActionLabel(action.actionType)}</div>
                                                <div className="text-sm text-muted-foreground">
                                                  by {action.performedByUser.username} on {formatDate(action.performedAt)}
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-center text-muted-foreground py-8">
                                Failed to load order details
                              </div>
                            )}
                          </DialogContent>
                        </Dialog>

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
                                            {formatDateTime(action.performedAt)}
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default PurchaseOrdersPage;
