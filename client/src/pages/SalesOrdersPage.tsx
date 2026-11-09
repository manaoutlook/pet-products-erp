import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatDate, formatQuantity } from "@/utils/format";
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
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { ColumnHeader, TableControlsBar } from "@/components/ui/table-controls";
import { useTableControls } from "@/hooks/use-table-controls";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { useCompanyInfo } from "@/hooks/use-company";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Ban, Pencil, Plus, Printer, Trash2, Truck } from "lucide-react";
import {
  SalesOrderFormDialog,
  type SalesOrderFormOrder,
} from "@/components/SalesOrders/SalesOrderFormDialog";
import { SalesOrderPrintDialog } from "@/components/SalesOrders/SalesOrderPrint";
import { DeliveryNoteFormDialog } from "@/components/SalesOrders/DeliveryNoteFormDialog";

interface SalesOrderLine {
  id: number;
  productId: number;
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  deliveredQuantity: number;
}

interface DeliveryNoteSummary {
  id: number;
  deliveryNoteNumber: string;
  deliveryDate: string;
}

interface SalesOrderRow {
  id: number;
  orderNumber: string;
  customerName: string;
  companyName?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  deliveryAddress?: string | null;
  orderDate: string;
  totalAmount: string;
  specialInstructions?: string | null;
  status: string;
  items?: SalesOrderLine[] | null;
  deliveryNotes?: DeliveryNoteSummary[];
  preparedByUser?: { username: string } | null;
}

/** How each derived status is shown. `status` is server owned - only cancel is a user action. */
const STATUS_BADGES: Record<string, { label: string; variant: "info" | "warning" | "success" | "destructive" | "secondary" }> = {
  open: { label: "Open", variant: "info" },
  partially_delivered: { label: "Partially delivered", variant: "warning" },
  delivered: { label: "Delivered", variant: "success" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

function statusLabel(status: string): string {
  return STATUS_BADGES[status]?.label ?? status;
}

/**
 * The minimum an order must expose to know whether it can still be edited: its status and how
 * much of each line has shipped. Both the list row and the edit-form order satisfy it.
 */
interface LockableOrder {
  status?: string;
  items?: Array<{ deliveredQuantity?: number | null }> | null;
}

/** Units ordered vs units already covered by a delivery note. */
function progress(order: SalesOrderRow) {
  const lines = order.items ?? [];
  const ordered = lines.reduce((sum, line) => sum + Number(line.quantity), 0);
  const delivered = lines.reduce((sum, line) => sum + Number(line.deliveredQuantity || 0), 0);
  return { ordered, delivered };
}

/**
 * Sales Orders - the customer-facing half of the order flow (the PDF's page 1).
 *
 * The list carries everything the screen needs (lines, delivery note summaries, preparer), so
 * printing never triggers an extra request and a row is enough to open the A4 sheet. Editing is
 * blocked once units have shipped - the API enforces it too, the disabled button just explains
 * why before the user types anything.
 */
function SalesOrdersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  // The letterhead printed on the order and the delivery note issued from it.
  const { company } = useCompanyInfo();

  const canCreate = hasPermission("orders", "create");
  const canUpdate = hasPermission("orders", "update");
  const canDelete = hasPermission("orders", "delete");

  const [searchTerm, setSearchTerm] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<SalesOrderFormOrder | null>(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliveryOrderId, setDeliveryOrderId] = useState<number | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{
    action: "cancel" | "delete";
    order: SalesOrderRow;
  } | null>(null);

  const { data: orders = [], isLoading } = useQuery<SalesOrderRow[]>({
    queryKey: ["/api/sales-orders"],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/delivery-notes"] });
  };

  const cancelOrder = useMutation({
    mutationFn: async (order: SalesOrderRow) => {
      const response = await fetch(`/api/sales-orders/${order.id}/cancel`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to cancel the sales order");
      }

      return response.json();
    },
    onSuccess: (_data, order) => {
      invalidate();
      toast({
        title: "Sales order cancelled",
        description: `${order.orderNumber} will not be delivered`,
        variant: "success",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteOrder = useMutation({
    mutationFn: async (order: SalesOrderRow) => {
      const response = await fetch(`/api/sales-orders/${order.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to delete the sales order");
      }

      return response.json();
    },
    onSuccess: (_data, order) => {
      invalidate();
      toast({
        title: "Sales order deleted",
        description: `${order.orderNumber} was removed`,
        variant: "success",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingOrder(null);
    setFormOpen(true);
  };

  const openEdit = (order: SalesOrderRow) => {
    setEditingOrder({
      id: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      companyName: order.companyName,
      contactPerson: order.contactPerson,
      phone: order.phone,
      deliveryAddress: order.deliveryAddress,
      orderDate: order.orderDate,
      specialInstructions: order.specialInstructions,
      items: (order.items ?? []).map((line) => ({
        id: line.id,
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        deliveredQuantity: line.deliveredQuantity,
      })),
    });
    setFormOpen(true);
  };

  const openDelivery = (order: SalesOrderRow) => {
    setDeliveryOrderId(order.id);
    setDeliveryOpen(true);
  };

  /**
   * An order whose lines already shipped, or that was cancelled, is frozen. Accepts either a
   * list row or a form order, since the edit dialog needs the same explanation.
   */
  const editBlockedReason = (order: LockableOrder | null): string | undefined => {
    if (!order) return undefined;
    if (order.status === "cancelled") {
      return "This order is cancelled - a cancelled order cannot be edited.";
    }
    if ((order.items ?? []).some((line) => Number(line.deliveredQuantity || 0) > 0)) {
      return "Units from this order have already been delivered, so its lines are locked. Cancel it and raise a new order for the change.";
    }
    return undefined;
  };

  const salesOrdersTable = useTableControls(
    orders,
    {
      orderNumber: (order) => order.orderNumber,
      customer: (order) => order.customerName,
      orderDate: (order) => (order.orderDate ? new Date(order.orderDate) : null),
      totalAmount: (order) => Number(order.totalAmount),
      status: (order) => order.status,
    },
    {
      filter: (order) => {
        const needle = searchTerm.toLowerCase();
        return (
          order.orderNumber.toLowerCase().includes(needle) ||
          order.customerName.toLowerCase().includes(needle) ||
          (order.companyName ?? "").toLowerCase().includes(needle) ||
          statusLabel(order.status).toLowerCase().includes(needle)
        );
      },
    }
  );

  const visibleOrders = salesOrdersTable.rows;

  const totals = useMemo(
    () => ({
      open: visibleOrders.filter((order) => order.status === "open").length,
      value: visibleOrders
        .filter((order) => order.status !== "cancelled")
        .reduce((sum, order) => sum + Number(order.totalAmount), 0),
    }),
    [visibleOrders]
  );
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sales Orders</h1>
          <p className="text-muted-foreground">
            Customer orders and what is still owed. Delivery notes are raised from here.
          </p>
        </div>
        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Sales Order
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Sales Order List</CardTitle>
            <p className="text-caption text-muted-foreground">
              {visibleOrders.length} order{visibleOrders.length === 1 ? "" : "s"} ·{" "}
              {formatCurrency(totals.value)} booked · {totals.open} still open
            </p>
          </div>
          <SearchInput
            containerClassName="w-full max-w-sm"
            placeholder="Search order no., customer, status..."
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-6 text-center text-muted-foreground">Loading sales orders...</div>
          ) : orders.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-muted-foreground">No sales orders yet.</p>
              {canCreate && (
                <Button variant="outline" className="mt-3" onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  Raise the first order
                </Button>
              )}
            </div>
          ) : (
            <>
              <TableControlsBar controls={salesOrdersTable} noun="sales orders" />
              <Table className="table-actions-sticky min-w-[1100px]">
                <TableHeader>
                  <TableRow>
                    <ColumnHeader controls={salesOrdersTable} columnKey="orderNumber" label="Order No." filterPlaceholder="Filter order no." />
                    <ColumnHeader controls={salesOrdersTable} columnKey="customer" label="Customer" filterPlaceholder="Filter customer" />
                    <ColumnHeader controls={salesOrdersTable} columnKey="orderDate" label="Order Date" filterPlaceholder="Filter date" />
                    <TableHead className="text-right align-top">Lines</TableHead>
                    <ColumnHeader controls={salesOrdersTable} columnKey="totalAmount" label="Total (VND)" filterPlaceholder="Filter total" />
                    <ColumnHeader controls={salesOrdersTable} columnKey="status" label="Status" filterPlaceholder="Filter status" />
                    <TableHead className="text-right align-top">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {visibleOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        No sales orders match the current search.
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleOrders.map((order) => {
                      const { ordered, delivered } = progress(order);
                      const badge = STATUS_BADGES[order.status] ?? {
                        label: order.status,
                        variant: "secondary" as const,
                      };
                      const blockedReason = editBlockedReason(order);
                      const canDeliver =
                        order.status === "open" || order.status === "partially_delivered";
                      const noteCount = order.deliveryNotes?.length ?? 0;

                      return (
                        <TableRow key={order.id}>
                          <TableCell className="font-medium">{order.orderNumber}</TableCell>
                          <TableCell>
                            <div>{order.customerName}</div>
                            {order.companyName && order.companyName !== order.customerName && (
                              <div className="text-caption text-muted-foreground">
                                {order.companyName}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>{formatDate(order.orderDate)}</TableCell>
                          <TableCell className="text-right">
                            <div>
                              {ordered} unit{ordered === 1 ? "" : "s"}
                            </div>
                            {delivered > 0 && (
                              <div className="text-caption text-muted-foreground">
                                {formatQuantity(delivered)} delivered
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(order.totalAmount)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                            {noteCount > 0 && (
                              <div className="mt-1 text-caption text-muted-foreground">
                                {noteCount} delivery note{noteCount === 1 ? "" : "s"}
                              </div>
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <SalesOrderPrintDialog order={order} company={company}>
                                <Button variant="ghost" size="sm" title="Print sales order">
                                  <Printer className="h-4 w-4" />
                                  <span className="sr-only">Print {order.orderNumber}</span>
                                </Button>
                              </SalesOrderPrintDialog>

                              <Button
                                variant="ghost"
                                size="sm"
                                title={canDeliver ? "Issue a delivery note" : "Nothing left to deliver"}
                                disabled={!canUpdate || !canDeliver}
                                onClick={() => openDelivery(order)}
                              >
                                <Truck className="h-4 w-4" />
                                <span className="sr-only">Deliver {order.orderNumber}</span>
                              </Button>

                              <Button
                                variant="ghost"
                                size="sm"
                                title={blockedReason ?? "Edit sales order"}
                                disabled={!canUpdate || Boolean(blockedReason)}
                                onClick={() => openEdit(order)}
                              >
                                <Pencil className="h-4 w-4" />
                                <span className="sr-only">Edit {order.orderNumber}</span>
                              </Button>

                              <Button
                                variant="ghost"
                                size="sm"
                                title={
                                  noteCount > 0
                                    ? "An order with delivery notes cannot be cancelled"
                                    : "Cancel sales order"
                                }
                                disabled={
                                  !canUpdate || order.status === "cancelled" || noteCount > 0
                                }
                                onClick={() => setConfirmTarget({ action: "cancel", order })}
                              >
                                <Ban className="h-4 w-4" />
                                <span className="sr-only">Cancel {order.orderNumber}</span>
                              </Button>

                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                title={
                                  noteCount > 0
                                    ? "An order with delivery notes cannot be deleted"
                                    : "Delete sales order"
                                }
                                disabled={!canDelete || noteCount > 0}
                                onClick={() => setConfirmTarget({ action: "delete", order })}
                              >
                                <Trash2 className="h-4 w-4" />
                                <span className="sr-only">Delete {order.orderNumber}</span>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <SalesOrderFormDialog
        open={formOpen}
        onOpenChange={(next) => {
          setFormOpen(next);
          if (!next) setEditingOrder(null);
        }}
        order={editingOrder}
        disabledReason={editBlockedReason(editingOrder)}
      />

      <DeliveryNoteFormDialog
        open={deliveryOpen}
        onOpenChange={(next) => {
          setDeliveryOpen(next);
          if (!next) setDeliveryOrderId(null);
        }}
        initialSalesOrderId={deliveryOrderId}
        company={company}
      />

      {/* One confirm dialog serves both destructive actions: the copy and the verb come from
          `confirmTarget`, so cancel and delete cannot drift apart. */}
      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmTarget?.action === "delete"
                ? "Delete this sales order?"
                : "Cancel this sales order?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget?.action === "delete"
                ? `${confirmTarget?.order.orderNumber} for ${confirmTarget?.order.customerName} will be removed for good. This cannot be undone.`
                : `${confirmTarget?.order.orderNumber} will be marked cancelled and can no longer be delivered or edited.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmTarget) return;
                if (confirmTarget.action === "delete") {
                  deleteOrder.mutate(confirmTarget.order);
                } else {
                  cancelOrder.mutate(confirmTarget.order);
                }
                setConfirmTarget(null);
              }}
            >
              {confirmTarget?.action === "delete" ? "Delete" : "Cancel order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default SalesOrdersPage;

