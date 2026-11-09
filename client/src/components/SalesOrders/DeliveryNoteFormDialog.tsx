import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Printer } from "lucide-react";
import { formatDate, formatQuantity } from "@/utils/format";
import { printDeliveryNote, type DeliveryNotePrintData } from "./DeliveryNotePrint";
import { toDateInputValue } from "./SalesOrderFormDialog";

/** An order line as returned by GET /api/sales-orders. */
interface SalesOrderListLine {
  id: number;
  productCode: string;
  description: string;
  quantity: number;
  deliveredQuantity: number;
}

/** An order row as returned by GET /api/sales-orders. */
interface SalesOrderListRow {
  id: number;
  orderNumber: string;
  customerName: string;
  status: string;
  orderDate?: string | null;
  items?: SalesOrderListLine[] | null;
}

/** What the user typed for one order line. */
interface DeliveryLineDraft {
  deliveredQuantity: string;
  remarks: string;
}

/** Statuses that can still ship goods. */
const DELIVERABLE_STATUSES = ["open", "partially_delivered"];

/** Units still outstanding on a line. */
function remainingFor(line: SalesOrderListLine): number {
  return Math.max(0, Number(line.quantity) - Number(line.deliveredQuantity || 0));
}

interface DeliveryNoteFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Order to preselect, e.g. when opened from a row's "Deliver" action. */
  initialSalesOrderId?: number | null;
}

/**
 * Issue a delivery note against an existing sales order.
 *
 * The note is never typed from scratch: picking the order copies its customer block and shows
 * the units still outstanding per line, which is the only number the warehouse can legitimately
 * ship. Everything on screen is a *default* - the delivered quantity is editable so a partial
 * shipment can be recorded - but the API re-checks every line against the order and refuses
 * over-delivery, so the guard does not depend on this form.
 */
export function DeliveryNoteFormDialog({
  open,
  onOpenChange,
  initialSalesOrderId = null,
}: DeliveryNoteFormDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [salesOrderId, setSalesOrderId] = useState<string | null>(null);
  const [deliveryDate, setDeliveryDate] = useState(() => toDateInputValue(null));
  const [remarks, setRemarks] = useState("");
  const [customerConfirmed, setCustomerConfirmed] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, DeliveryLineDraft>>({});
  /** The note to offer for printing once it has been issued. */
  const [issuedNote, setIssuedNote] = useState<DeliveryNotePrintData | null>(null);

  const { data: orders = [] } = useQuery<SalesOrderListRow[]>({
    queryKey: ["/api/sales-orders"],
  });

  const deliverableOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          DELIVERABLE_STATUSES.includes(order.status) &&
          (order.items ?? []).some((line) => remainingFor(line) > 0)
      ),
    [orders]
  );

  const selectedOrder = useMemo(
    () => orders.find((order) => String(order.id) === salesOrderId) ?? null,
    [orders, salesOrderId]
  );

  const orderOptions = useMemo(
    () =>
      deliverableOrders.map((order) => ({
        value: String(order.id),
        label: order.orderNumber,
        description: order.customerName,
      })),
    [deliverableOrders]
  );

  /** Outstanding lines of the selected order - the only rows this note can carry. */
  const outboundLines = useMemo(
    () => (selectedOrder?.items ?? []).filter((line) => remainingFor(line) > 0),
    [selectedOrder]
  );

  // Seed one draft row per outstanding line, defaulting to "ship everything still owed".
  useEffect(() => {
    if (!salesOrderId) {
      setDrafts({});
      return;
    }

    const next: Record<number, DeliveryLineDraft> = {};
    for (const line of outboundLines) {
      next[line.id] = { deliveredQuantity: String(remainingFor(line)), remarks: "" };
    }
    setDrafts(next);
  }, [salesOrderId, outboundLines]);

  // Reset the whole form each time the dialog is opened.
  useEffect(() => {
    if (!open) return;

    setDeliveryDate(toDateInputValue(null));
    setRemarks("");
    setCustomerConfirmed(false);
    setIssuedNote(null);
    setSalesOrderId(initialSalesOrderId ? String(initialSalesOrderId) : null);
  }, [open, initialSalesOrderId]);

  const updateDraft = (lineId: number, patch: Partial<DeliveryLineDraft>) => {
    setDrafts((current) => {
      const existing = current[lineId];
      // Explicit merge (not a blanket spread) so a required field can never be lost.
      const next: DeliveryLineDraft = {
        deliveredQuantity: patch.deliveredQuantity ?? existing?.deliveredQuantity ?? "",
        remarks: patch.remarks ?? existing?.remarks ?? "",
      };
      return { ...current, [lineId]: next };
    });
  };

  /** Lines the user actually wants to ship (> 0) - this is what gets sent. */
  const shippingLines = outboundLines
    .map((line) => ({ line, draft: drafts[line.id] }))
    .filter(({ draft }) => Number(draft?.deliveredQuantity || 0) > 0);

  const totalUnits = shippingLines.reduce(
    (sum, { draft }) => sum + Number(draft?.deliveredQuantity || 0),
    0
  );

  // Cheap mirror of the server rules so a bad quantity is caught before the request.
  const invalidLine = outboundLines.find((line) => {
    const typed = Number(drafts[line.id]?.deliveredQuantity || 0);
    return !Number.isInteger(typed) || typed < 0 || typed > remainingFor(line);
  });

  const createNote = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/delivery-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          salesOrderId: Number(salesOrderId),
          // Noon local time so the printed date never slips to the day before.
          deliveryDate: new Date(`${deliveryDate}T12:00:00`).toISOString(),
          remarks: remarks.trim() || null,
          customerConfirmed,
          items: shippingLines.map(({ line, draft }) => ({
            salesOrderItemId: line.id,
            deliveredQuantity: Number(draft.deliveredQuantity),
            remarks: draft.remarks.trim() || null,
          })),
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to create the delivery note");
      }

      return response.json();
    },
    onSuccess: (result: { deliveryNote?: { deliveryNoteNumber?: string; deliveryDate?: string } }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/delivery-notes"] });
      // The order status and the per-line tallies moved inside the same transaction.
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });

      const number = result?.deliveryNote?.deliveryNoteNumber;
      toast({
        title: "Delivery note issued",
        description: number ? `${number} is ready to print` : "The delivery note has been saved",
        variant: "success",
      });

      // Offer the sheet straight away - the customer signs it on the spot.
      if (selectedOrder && number) {
        setIssuedNote({
          deliveryNoteNumber: number,
          deliveryDate: result.deliveryNote?.deliveryDate ?? new Date().toISOString(),
          customerName: selectedOrder.customerName,
          customerConfirmed,
          remarks: remarks.trim() || null,
          salesOrder: { orderNumber: selectedOrder.orderNumber },
          items: shippingLines.map(({ line, draft }) => ({
            productCode: line.productCode,
            description: line.description,
            orderedQuantity: Number(line.quantity),
            deliveredQuantity: Number(draft.deliveredQuantity),
            remarks: draft.remarks.trim() || null,
          })),
        });
      }

      // Stay open so the user can print the sheet they just issued.
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const canSubmit =
    Boolean(salesOrderId) && shippingLines.length > 0 && !invalidLine && !createNote.isPending;

  const handlePrintIssued = () => {
    if (!issuedNote) return;

    if (!printDeliveryNote(issuedNote)) {
      toast({
        title: "Print Blocked",
        description: "Allow pop-ups for this site to print the delivery note",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {issuedNote ? `Delivery Note ${issuedNote.deliveryNoteNumber}` : "New Delivery Note"}
          </DialogTitle>
          <DialogDescription>
            {issuedNote
              ? "Issued. Print the sheet and have the customer sign it on arrival."
              : "Deliver against an existing sales order - ordered quantities are copied from the order."}
          </DialogDescription>
        </DialogHeader>

        {issuedNote ? (
          <div className="space-y-4">
            <div className="rounded-md border bg-success-subtle px-4 py-3 text-sm text-success-subtle-foreground">
              <p className="font-medium">{issuedNote.deliveryNoteNumber} issued successfully.</p>
              <p>
                {formatQuantity(
                  issuedNote.items?.reduce((sum, line) => sum + line.deliveredQuantity, 0) ?? 0
                )}{" "}
                unit(s) shipped against order {issuedNote.salesOrder?.orderNumber ?? "—"}.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <Button onClick={handlePrintIssued}>
                <Printer className="mr-2 h-4 w-4" />
                Print Delivery Note
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2 space-y-2">
                <Label>Sales Order *</Label>
                <SearchableSelect
                  value={salesOrderId}
                  onChange={setSalesOrderId}
                  options={orderOptions}
                  placeholder="Pick an open sales order"
                  searchPlaceholder="Search by order number or customer..."
                  emptyMessage="No sales orders have units outstanding."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="delivery-date">Delivery Date *</Label>
                <Input
                  id="delivery-date"
                  type="date"
                  value={deliveryDate}
                  onChange={(event) => setDeliveryDate(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Order Summary</Label>
                <p className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                  {selectedOrder
                    ? `${selectedOrder.customerName} · ${formatDate(selectedOrder.orderDate)}`
                    : "Pick an order to see its outstanding lines"}
                </p>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Lines to Ship</h3>

              {!selectedOrder ? (
                <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  Pick a sales order to load its outstanding lines.
                </p>
              ) : outboundLines.length === 0 ? (
                <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  Everything on {selectedOrder.orderNumber} has already been delivered.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="hidden grid-cols-12 gap-2 text-xs font-medium uppercase text-muted-foreground sm:grid">
                    <div className="col-span-5">Product</div>
                    <div className="col-span-2 text-right">Ordered</div>
                    <div className="col-span-2 text-right">Remaining</div>
                    <div className="col-span-3 text-right">Delivering</div>
                  </div>

                  {outboundLines.map((line) => {
                    const draft = drafts[line.id];
                    const typed = Number(draft?.deliveredQuantity ?? "");
                    const over = Number.isInteger(typed) && typed > remainingFor(line);

                    return (
                      <div key={line.id} className="space-y-1">
                        <div className="grid grid-cols-12 items-center gap-2">
                          <div className="col-span-12 text-sm sm:col-span-5">
                            <span className="font-medium">{line.productCode}</span>
                            <span className="text-muted-foreground"> · {line.description}</span>
                          </div>
                          <div className="col-span-4 text-right text-sm sm:col-span-2">
                            {formatQuantity(line.quantity)}
                          </div>
                          <div className="col-span-4 text-right text-sm sm:col-span-2">
                            {formatQuantity(remainingFor(line))}
                          </div>
                          <div className="col-span-4 sm:col-span-3">
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              max={remainingFor(line)}
                              aria-label={`Delivered quantity for ${line.productCode}`}
                              className={over ? "border-destructive" : undefined}
                              value={draft?.deliveredQuantity ?? ""}
                              onChange={(event) =>
                                updateDraft(line.id, { deliveredQuantity: event.target.value })
                              }
                            />
                          </div>
                        </div>
                        {over ? (
                          <p className="text-right text-xs text-destructive">
                            Only {formatQuantity(remainingFor(line))} left to deliver
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end gap-6 border-t pt-3 text-sm">
                <span className="text-muted-foreground">Units on this note</span>
                <span className="font-semibold">{formatQuantity(totalUnits)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="delivery-remarks">Remarks</Label>
              <Textarea
                id="delivery-remarks"
                rows={3}
                placeholder="Anything the receiver should know (short delivery, damaged carton...)"
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
              />
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="customer-confirmed"
                checked={customerConfirmed}
                onCheckedChange={(checked) => setCustomerConfirmed(checked === true)}
              />
              <Label htmlFor="customer-confirmed" className="text-sm font-normal leading-5">
                Customer confirmed receipt - goods received in good condition
              </Label>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="create"
                onClick={() => createNote.mutate()}
                disabled={!canSubmit}
              >
                {createNote.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Issue Delivery Note
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default DeliveryNoteFormDialog;
