import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import {
  BACK_DATED_PURCHASE_ORDER_MESSAGE,
  isBackDatedPurchaseOrderDate,
} from "@shared/purchase-order-dates";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@shared/invoice-payment";
import { vietnamDayOf } from "@shared/vietnam-day";
import { Loader2, Pencil } from "lucide-react";

/**
 * Correct the dates of an existing purchase order.
 *
 * A purchase order has no full edit form - its lines are priced once and the stock it brings in is
 * driven by the goods receipts. The dates, though, are typed by hand and are regularly wrong (the
 * order was placed on the phone on Monday, entered on Thursday), so they can be corrected here:
 *
 *   - Order date       - the day the order was placed. It is also the day the order's
 *                        "Supplier purchases" expense sits on in Finance, so changing it moves that
 *                        expense; the month a purchase belongs to must not depend on typing speed.
 *   - Expected delivery - the date the supplier promised. It drives the overdue report and every
 *                        receipt's "days late".
 *
 * Back-dating either date is an administrator's call, exactly as when the order is created: the
 * form blocks it and `PUT /api/purchase-orders/:id` enforces it.
 */

/** Local datetime string for `datetime-local` inputs (no timezone, no seconds). */
function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** Tomorrow, as a `datetime-local` value - the default for an order with no expected date. */
function tomorrowInput(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return toLocalInputValue(tomorrow);
}

const editPurchaseOrderSchema = z.object({
  // The shape of the two dates is all this checks; whether a past date is allowed is a permission
  // question answered in `onSubmit`, where the role is known (the same split as the create form).
  orderDate: z
    .string()
    .min(1, "Order date is required")
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "Enter a valid order date"),
  deliveryDate: z
    .string()
    .min(1, "Delivery date is required")
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "Enter a valid delivery date"),
  // Correcting how the order was paid also corrects the expense it posted, which is what splits
  // "money on hand" into cash and bank.
  paymentMethod: z.string().min(1, "Choose how the supplier is paid"),
  notes: z.string().max(2000, "Note is too long").optional(),
});

type FormData = z.infer<typeof editPurchaseOrderSchema>;

export interface EditablePurchaseOrder {
  id: number;
  orderNumber: string;
  /** The day the order was placed. Rows created before the column was filled fall back to createdAt. */
  orderDate?: string | null;
  createdAt: string;
  /** The date the supplier promised. */
  deliveryDate?: string | null;
  /** How the supplier is paid. Rows created before the column was filled were all cash. */
  paymentMethod?: string | null;
  notes?: string | null;
}

interface EditPurchaseOrderDialogProps {
  order: EditablePurchaseOrder;
}


export function EditPurchaseOrderDialog({ order }: EditPurchaseOrderDialogProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = usePermissions();

  // What the stored order currently says, in the same units the form works in. A row created
  // before `order_date` was recorded has no date of its own, so its creation time stands in.
  const storedOrderDate = order.orderDate ?? order.createdAt;
  const storedDeliveryDate = order.deliveryDate ?? null;

  /** The saved values, as the form shows them. */
  const savedValues = (): FormData => ({
    orderDate: toLocalInputValue(new Date(storedOrderDate)),
    deliveryDate: storedDeliveryDate
      ? toLocalInputValue(new Date(storedDeliveryDate))
      : tomorrowInput(),
    paymentMethod: order.paymentMethod ?? "CASH",
    notes: order.notes ?? "",
  });

  const form = useForm<FormData>({
    resolver: zodResolver(editPurchaseOrderSchema),
    defaultValues: savedValues(),
  });

  /** Reset to the saved values every time the dialog opens - a cancelled edit must not linger. */
  const openDialog = () => {
    form.reset(savedValues());
    setOpen(true);
  };

  /** Only what actually changed is sent; an untouched field stays out of the request. */
  const buildPayload = (data: FormData) => {
    const payload: {
      orderDate?: string;
      deliveryDate?: string;
      paymentMethod?: string;
      notes?: string | null;
    } = {};

    if (vietnamDayOf(new Date(data.orderDate)) !== vietnamDayOf(new Date(storedOrderDate))) {
      payload.orderDate = new Date(data.orderDate).toISOString();
    }
    if (
      !storedDeliveryDate ||
      vietnamDayOf(new Date(data.deliveryDate)) !== vietnamDayOf(new Date(storedDeliveryDate))
    ) {
      payload.deliveryDate = new Date(data.deliveryDate).toISOString();
    }
    if (data.paymentMethod !== (order.paymentMethod ?? "CASH")) {
      payload.paymentMethod = data.paymentMethod;
    }
    if ((data.notes ?? "") !== (order.notes ?? "")) {
      payload.notes = data.notes?.trim() ? data.notes : null;
    }

    return payload;
  };

  const updatePurchaseOrder = useMutation({
    mutationFn: async (payload: ReturnType<typeof buildPayload>) => {
      const response = await fetch(`/api/purchase-orders/${order.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.errors) {
          throw new Error(
            errorData.errors
              .map((err: { field: string; message: string }) => `${err.field}: ${err.message}`)
              .join("\n")
          );
        }
        throw new Error(errorData.message || "Failed to update purchase order");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      // The order's expense may have moved to another day, so the money book and the report are
      // stale until they are read again.
      queryClient.invalidateQueries({ queryKey: ["/api/finance"] });

      toast({
        title: "Success",
        description: `Purchase order ${order.orderNumber} updated`,
        variant: "success",
      });
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    const payload = buildPayload(data);

    if (Object.keys(payload).length === 0) {
      toast({
        title: "Nothing to save",
        description: "Change the order date, the expected delivery date or the note first",
        variant: "destructive",
      });
      return;
    }

    // The server enforces the same rule; checking here turns a 403 into a message next to the
    // field that caused it.
    if (!isAdmin && payload.orderDate && isBackDatedPurchaseOrderDate(payload.orderDate)) {
      form.setError("orderDate", { message: BACK_DATED_PURCHASE_ORDER_MESSAGE });
      return;
    }
    if (!isAdmin && payload.deliveryDate && isBackDatedPurchaseOrderDate(payload.deliveryDate)) {
      form.setError("deliveryDate", { message: BACK_DATED_PURCHASE_ORDER_MESSAGE });
      return;
    }

    updatePurchaseOrder.mutate(payload);
  };

  const watchedOrderDate = form.watch("orderDate");
  const orderDateMoved =
    Boolean(watchedOrderDate) &&
    vietnamDayOf(new Date(watchedOrderDate)) !== vietnamDayOf(new Date(storedOrderDate));


  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" onClick={openDialog} title="Edit order dates">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Purchase Order {order.orderNumber}</DialogTitle>
          <DialogDescription>
            The dates, how the supplier was paid, and the note can be changed. The supplier, the
            lines and the amounts stay as they were ordered.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="orderDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Order Date</FormLabel>
                  <FormControl>
                    {/* No `min` here on purpose: an existing order may already be dated in the
                        past, and a `min` would block saving an unrelated change (the note) with a
                        native browser error. A date that *moves* backwards is caught below and by
                        PUT /api/purchase-orders/:id. */}
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormDescription>
                    {isAdmin
                      ? "The day the order was placed. It also dates the order's expense in Finance."
                      : "Today or later. Ask an administrator to back-date an order entered late."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="deliveryDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Expected Delivery Date</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormDescription>
                    The date the supplier promised. Late deliveries are measured against it.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paymentMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Paid by</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="How the supplier is paid" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PAYMENT_METHODS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {PAYMENT_METHOD_LABELS[method] ?? method}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    The order's expense in Finance moves to this method, so cash and bank stay
                    right in "money on hand".
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {orderDateMoved && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                The purchase's expense in Finance will move to this order date, so the money is
                counted in the right period.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updatePurchaseOrder.isPending}>
                {updatePurchaseOrder.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
