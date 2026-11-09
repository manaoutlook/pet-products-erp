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
import { ReceiveGoodsDialog } from "@/components/PurchaseOrders/ReceiveGoodsDialog";

interface Supplier {
  id: number;
  name: string;
}

interface PurchaseOrderAction {
  id: number;
  actionType: 'cancel' | 'print' | 'invoice_received' | 'payment_sent' | 'goods_receipt';
  /** Missing when the user record is gone - the timeline falls back to "Unknown user". */
  performedByUser?: {
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
  deliveredQuantity?: number | null;
  /** Unit price plus this line's share of the goods receipt's fees. Null until received. */
  landedCostPerUnit?: number | string | null;
}

interface PurchaseOrder {
  id: number;
  orderNumber: string;
  supplier: Supplier;
  createdAt: string;
  /** The date the supplier promised. The actual arrival lives on the goods receipt. */
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
  goodsReceipts?: GoodsReceipt[];
}

/**
 * The Goods Receipt Note: what actually happened when the goods arrived, and what the
 * delivery really cost on top of the invoice. A short delivery produces one receipt per
 * shipment, each with the lines and quantities it carried.
 */
interface GoodsReceipt {
  id: number;
  receiptNumber: string;
  actualDeliveryDate: string;
  shippingFee: number | string;
  customsDuty: number | string;
  customsTax: number | string;
  brokerageFee: number | string;
  additionalFee: number | string;
  additionalFeeNote?: string | null;
  totalAdditionalCost: number | string;
  notes?: string | null;
  receivedByUser?: { id: number; username: string };
  items?: Array<{
    id: number;
    quantity: number;
    unitPrice: number | string;
    allocatedCost: number | string;
    landedCostPerUnit: number | string;
    purchaseOrderItem?: {
      id: number;
      quantity: number;
      product?: { id: number; name: string; sku: string };
    };
  }>;
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

  /**
   * Every line booked in? A purchase order can arrive in several shipments, so "delivered"
   * is decided by the delivered quantities, not by the fact that a receipt exists.
   */
  const isFullyReceived = (order: PurchaseOrder): boolean =>
    order.items && order.items.length > 0
      ? order.items.every((item) => (item.deliveredQuantity ?? 0) >= item.quantity)
      : hasAction(order, 'goods_receipt');

  /** Partly booked in: at least one receipt, but units still owed by the supplier. */
  const isPartiallyReceived = (order: PurchaseOrder): boolean =>
    !isFullyReceived(order) && (order.goodsReceipts?.length ?? 0) > 0;

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
        // Repeatable: each shipment gets its own receipt until every line is complete.
        return hasAction(order, 'payment_sent') && !isFullyReceived(order);
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
            {/* Wide list: the wrapper scrolls horizontally and the Actions column
                stays frozen on the right (see `.table-scroll` /
                `.table-actions-sticky` in index.css). */}
            <Table className="table-actions-sticky min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <ColumnHeader controls={purchaseOrdersTable} columnKey="orderNumber" label="Order Number" filterPlaceholder="Filter order no." />
                  <ColumnHeader controls={purchaseOrdersTable} columnKey="supplier" label="Supplier" filterPlaceholder="Filter supplier" />
                  <ColumnHeader controls={purchaseOrdersTable} columnKey="orderDate" label="Order Date" filterPlaceholder="Filter order date" />
                  <ColumnHeader controls={purchaseOrdersTable} columnKey="deliveryDate" label="Expected Delivery Date" filterPlaceholder="Filter expected delivery" />
                  <ColumnHeader controls={purchaseOrdersTable} columnKey="totalAmount" label="Total Amount (VND)" filterPlaceholder="Filter total" />
                  <ColumnHeader controls={purchaseOrdersTable} columnKey="status" label="Status" filterPlaceholder="Filter status" />
                  {/* Last column: `.table-actions-sticky` keeps it frozen on the right,
                      on a single line, while the data columns scroll. */}
                  <TableHead className="text-right align-top">Actions</TableHead>
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
                    <TableCell>
                      <span className="capitalize">{order.status}</span>
                      {isPartiallyReceived(order) && (
                        <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                          Partially received
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
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

                        {/* Goods Receipt - opens the Goods Receipt Note form, which captures the
                            actual delivery date, what arrived and the costs incurred on arrival.
                            Stays available after a short delivery so the rest can follow. */}
                        {isFullyReceived(order) ? (
                          <Button size="sm" variant="default" disabled title="Goods received in full">
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        ) : (
                          <ReceiveGoodsDialog
                            purchaseOrderId={order.id}
                            orderNumber={order.orderNumber}
                            expectedDeliveryDate={order.deliveryDate}
                            items={order.items}
                            disabled={!canPerformAction(order, 'goods_receipt')}
                            disabledReason="Record 'Payment Sent' first"
                          />
                        )}

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
                                      <div><strong>Expected Delivery Date:</strong> {formatDate(selectedOrderDetails.deliveryDate)}</div>
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
                                        <TableHead className="text-right">Landed Cost/Unit</TableHead>
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
                                            {item.landedCostPerUnit != null
                                              ? formatNumber(item.landedCostPerUnit)
                                              : <span className="text-muted-foreground">-</span>}
                                          </TableCell>
                                          <TableCell className="text-right">
                                            <span className={(item.deliveredQuantity ?? 0) >= item.quantity ? "text-green-600" : "text-orange-600"}>
                                              {item.deliveredQuantity ?? 0}/{item.quantity}
                                            </span>
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>

                                {/* Goods Receipt - the actual arrival and what it cost on top of the
                                    invoice. Kept apart from the order, which keeps the expected date. */}
                                {selectedOrderDetails.goodsReceipts && selectedOrderDetails.goodsReceipts.length > 0 && (
                                  <div>
                                    <h4 className="font-semibold mb-4">Goods Receipt</h4>
                                    {selectedOrderDetails.goodsReceipts.map((receipt) => {
                                      const expected = selectedOrderDetails.deliveryDate
                                        ? new Date(selectedOrderDetails.deliveryDate)
                                        : null;
                                      const actual = new Date(receipt.actualDeliveryDate);
                                      const daysLate = expected
                                        ? Math.ceil((actual.getTime() - expected.getTime()) / 86400000)
                                        : 0;

                                      return (
                                        <div key={receipt.id} className="rounded-lg border p-4 space-y-3">
                                          <div className="grid grid-cols-2 gap-4 text-sm">
                                            <div className="space-y-1">
                                              <div><strong>Receipt Number:</strong> {receipt.receiptNumber}</div>
                                              <div><strong>Actual Delivery Date:</strong> {formatDateTime(receipt.actualDeliveryDate)}</div>
                                              <div><strong>Received By:</strong> {receipt.receivedByUser?.username || '-'}</div>
                                              {expected && (
                                                <div>
                                                  <strong>Against Plan:</strong>{' '}
                                                  <span className={daysLate > 0 ? 'text-orange-600' : 'text-green-600'}>
                                                    {daysLate > 0 ? `${daysLate} day(s) late` : 'On time'}
                                                  </span>
                                                </div>
                                              )}
                                            </div>
                                            <div className="space-y-1">
                                              <div><strong>Shipping Fee:</strong> {formatCurrency(receipt.shippingFee)}</div>
                                              <div><strong>Customs Duty:</strong> {formatCurrency(receipt.customsDuty)}</div>
                                              <div><strong>Customs Tax:</strong> {formatCurrency(receipt.customsTax)}</div>
                                              <div><strong>Brokerage Fee:</strong> {formatCurrency(receipt.brokerageFee)}</div>
                                              <div>
                                                <strong>Additional Fee:</strong> {formatCurrency(receipt.additionalFee)}
                                                {receipt.additionalFeeNote ? ` (${receipt.additionalFeeNote})` : ''}
                                              </div>
                                            </div>
                                          </div>
                                          <div className="flex justify-between border-t pt-2 font-medium">
                                            <span>Total additional cost</span>
                                            <span>{formatCurrency(receipt.totalAdditionalCost)}</span>
                                          </div>
                                          {/* What this shipment carried. A short delivery has its
                                              own receipt, so the lines are part of the record. */}
                                          {receipt.items && receipt.items.length > 0 && (
                                            <div className="border-t pt-2">
                                              <div className="mb-1 text-sm font-medium">Lines on this receipt</div>
                                              <div className="space-y-1 text-sm">
                                                {receipt.items.map((line) => (
                                                  <div key={line.id} className="flex justify-between">
                                                    <span>
                                                      {line.purchaseOrderItem?.product?.name || `Line ${line.purchaseOrderItem?.id ?? ''}`}
                                                      {line.purchaseOrderItem
                                                        ? ` (${line.quantity} of ${line.purchaseOrderItem.quantity} units)`
                                                        : ` (${line.quantity} units)`}
                                                    </span>
                                                    <span>{formatNumber(line.landedCostPerUnit)}/unit</span>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                          {receipt.notes && (
                                            <div className="text-sm"><strong>Notes:</strong> {receipt.notes}</div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

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
                                                  by {action.performedByUser?.username ?? 'Unknown user'} on {formatDate(action.performedAt)}
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
                                [...order.actions]
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
                                            {action.performedByUser?.username ?? 'Unknown user'}
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
