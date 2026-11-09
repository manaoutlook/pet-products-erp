import { useMemo, useState } from "react";
import { useForm, useFormState } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDateTime } from "@/utils/format";
import { Loader2, Package } from "lucide-react";

/**
 * "Receive Goods" - the Goods Receipt Note (GRN) form.
 *
 * AI Agent Note: this replaces the old one-click "goods receipt" button. Receiving is the
 * only moment these numbers exist, so they are captured here and written to `goods_receipts`
 * (never onto the purchase order, which keeps the *expected* delivery date).
 *
 * The quantity grid is the point of the screen: a supplier can deliver short, or in several
 * shipments, so each line needs its own "how many actually arrived" box. The server spreads
 * *this shipment's* fees over exactly those units and keeps the order open until every line is
 * complete. No money is computed here - the totals below are a preview only.
 */
const moneyField = (label: string) =>
  z
    .string()
    .optional()
    .refine(
      (value) => !value || (!Number.isNaN(Number(value)) && Number(value) >= 0),
      `${label} must be a non-negative number`
    );

/**
 * Built per order, because the per-line limits ("only N still outstanding") are order data.
 */
const buildReceiveGoodsSchema = (outstandingByItem: Map<number, number>) =>
  z
    .object({
      actualDeliveryDate: z.string().min(1, "Actual delivery date is required"),
      shippingFee: moneyField("Shipping fee"),
      customsDuty: moneyField("Customs duty"),
      customsTax: moneyField("Customs tax"),
      brokerageFee: moneyField("Brokerage fee"),
      additionalFee: moneyField("Additional fee"),
      additionalFeeNote: z.string().max(500).optional(),
      notes: z.string().max(2000).optional(),
      /** Keyed by purchase order item id; strings because inputs hold text. */
      receivedQuantities: z.record(z.string(), z.string().optional()),
    })
    .superRefine((data, ctx) => {
      let total = 0;

      for (const [itemId, raw] of Object.entries(data.receivedQuantities)) {
        const outstanding = outstandingByItem.get(Number(itemId)) ?? 0;
        const quantity = raw === undefined || raw === "" ? 0 : Number(raw);

        if (!Number.isInteger(quantity) || quantity < 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["receivedQuantities", itemId],
            message: "Whole units only",
          });
          continue;
        }

        // The server refuses this too - failing here only saves a round trip.
        if (quantity > outstanding) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["receivedQuantities", itemId],
            message: `Only ${outstanding} outstanding`,
          });
        }

        total += quantity;
      }

      if (total <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["receivedQuantities"],
          message: "Enter at least one received unit",
        });
      }
    });

interface FormData {
  actualDeliveryDate: string;
  shippingFee?: string;
  customsDuty?: string;
  customsTax?: string;
  brokerageFee?: string;
  additionalFee?: string;
  additionalFeeNote?: string;
  notes?: string;
  receivedQuantities: Record<string, string | undefined>;
}

/** A purchase order line as the dialog needs it to decide what can still be received. */
export interface ReceivableItem {
  id: number;
  product: { id: number; name: string; sku: string };
  quantity: number;
  unitPrice: number | string;
  deliveredQuantity?: number | null;
}

interface ReceiveGoodsDialogProps {
  purchaseOrderId: number;
  orderNumber: string;
  /** The date the supplier promised - shown next to the actual one for comparison. */
  expectedDeliveryDate?: string | null;
  /** The order's lines, so the receipt can say what actually arrived. */
  items?: ReceivableItem[];
  disabled?: boolean;
  disabledReason?: string;
}

/** Local datetime string for `datetime-local` inputs (no timezone, no seconds). */
function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ReceiveGoodsDialog({
  purchaseOrderId,
  orderNumber,
  expectedDeliveryDate,
  items = [],
  disabled,
  disabledReason,
}: ReceiveGoodsDialogProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // What is still owed per line: ordered minus everything already booked in.
  const lines = useMemo(
    () =>
      items.map((item) => {
        const alreadyReceived = item.deliveredQuantity ?? 0;
        return {
          item,
          alreadyReceived,
          outstanding: Math.max(0, item.quantity - alreadyReceived),
        };
      }),
    [items]
  );

  const outstandingByItem = useMemo(
    () => new Map(lines.map((line) => [line.item.id, line.outstanding])),
    [lines]
  );

  const schema = useMemo(() => buildReceiveGoodsSchema(outstandingByItem), [outstandingByItem]);

  /** Fresh defaults: every line pre-filled with the quantity still outstanding. */
  const defaultValues = (): FormData => ({
    actualDeliveryDate: toLocalInputValue(new Date()),
    shippingFee: "",
    customsDuty: "",
    customsTax: "",
    brokerageFee: "",
    additionalFee: "",
    additionalFeeNote: "",
    notes: "",
    receivedQuantities: Object.fromEntries(
      lines.map((line) => [String(line.item.id), String(line.outstanding)])
    ),
  });

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(),
  });

  // "No units at all" is raised against the whole grid, so React Hook Form parks it under
  // `receivedQuantities.root` - no single line has a FormMessage that could show it.
  const { errors } = useFormState({ control: form.control });
  const gridErrors = errors.receivedQuantities as
    | { message?: string; root?: { message?: string } }
    | undefined;
  const gridErrorMessage = gridErrors?.root?.message ?? gridErrors?.message;

  // Live preview of what the delivery cost on top of the invoice.
  const watched = form.watch();
  const totalAdditionalCost =
    Number(watched.shippingFee || 0) +
    Number(watched.customsDuty || 0) +
    Number(watched.customsTax || 0) +
    Number(watched.brokerageFee || 0) +
    Number(watched.additionalFee || 0);

  // ... and of how much of the order this shipment covers.
  const receivingUnits = lines.reduce(
    (sum, line) => sum + Number(watched.receivedQuantities?.[String(line.item.id)] || 0),
    0
  );
  const outstandingUnits = lines.reduce((sum, line) => sum + line.outstanding, 0);
  const completesOrder = outstandingUnits > 0 && receivingUnits >= outstandingUnits;

  const receiveGoods = useMutation({
    mutationFn: async (data: FormData) => {
      // Only the lines that actually arrived are sent; a zero means "still on the way".
      const receivedItems = lines
        .map((line) => ({
          itemId: line.item.id,
          quantity: Number(data.receivedQuantities?.[String(line.item.id)] || 0),
        }))
        .filter((line) => line.quantity > 0);

      const response = await fetch(`/api/purchase-orders/${purchaseOrderId}/goods-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          actualDeliveryDate: new Date(data.actualDeliveryDate).toISOString(),
          shippingFee: Number(data.shippingFee || 0),
          customsDuty: Number(data.customsDuty || 0),
          customsTax: Number(data.customsTax || 0),
          brokerageFee: Number(data.brokerageFee || 0),
          additionalFee: Number(data.additionalFee || 0),
          additionalFeeNote: data.additionalFeeNote || undefined,
          notes: data.notes || undefined,
          items: receivedItems,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.errors) {
          throw new Error(
            errorData.errors.map((err: any) => `${err.field}: ${err.message}`).join("\n")
          );
        }
        throw new Error(errorData.suggestion || errorData.message || "Failed to receive goods");
      }

      return response.json();
    },
    onSuccess: (result: any) => {
      // The PO list, the order detail and inventory all changed.
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });

      const outstanding = Number(result?.outstandingQuantity ?? 0);
      toast({
        title: result?.fullyReceived ? "Goods received" : "Partially received",
        description: result?.receipt?.receiptNumber
          ? `Receipt ${result.receipt.receiptNumber} created and stock updated.${
              outstanding > 0
                ? ` ${outstanding} unit(s) still outstanding - receive them when they arrive.`
                : ""
            }`
          : "Stock has been updated.",
        variant: "success",
      });
      setOpen(false);
      form.reset(defaultValues());
    },
    onError: (error: Error) => {
      toast({ title: "Could not receive goods", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Re-snapshot the outstanding quantities every time the form is opened, so a dialog
        // left open across a receipt never re-sends a quantity that is no longer owed.
        if (next) form.reset(defaultValues());
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          title={disabled && disabledReason ? disabledReason : "Receive Goods"}
        >
          <Package className="h-4 w-4" />
          <span>Receive</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive Goods - {orderNumber}</DialogTitle>
          <DialogDescription>
            Record what actually arrived and what the delivery cost. You can receive part of the
            order now and the rest later - the order only closes once every line is complete.
          </DialogDescription>
        </DialogHeader>

        {expectedDeliveryDate && (
          <div className="rounded-md border bg-muted/50 p-3 text-sm">
            <span className="font-medium">Expected delivery: </span>
            {formatDateTime(expectedDeliveryDate)}
          </div>
        )}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => receiveGoods.mutate(data))}
            className="space-y-6"
          >
            <FormField
              control={form.control}
              name="actualDeliveryDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Actual Delivery Date</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-3">
              <h3 className="text-lg font-medium">What arrived</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="w-32 text-right">Receiving Now</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map(({ item, alreadyReceived, outstanding }) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium">{item.product.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {item.product.sku}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{alreadyReceived}</TableCell>
                      <TableCell className="text-right">
                        <span className={outstanding === 0 ? "text-green-600" : "text-orange-600"}>
                          {outstanding}
                        </span>
                      </TableCell>
                      <TableCell>
                        <FormField
                          control={form.control}
                          name={`receivedQuantities.${item.id}`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="0"
                                  max={outstanding}
                                  step="1"
                                  className="text-right"
                                  disabled={outstanding === 0}
                                  {...field}
                                  value={field.value ?? ""}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex justify-between rounded-md border bg-muted/50 p-3 text-sm font-medium">
                <span>
                  {receivingUnits} of {outstandingUnits} outstanding unit(s) on this receipt
                </span>
                <span className={completesOrder ? "text-green-600" : "text-orange-600"}>
                  {completesOrder ? "Completes the order" : "Order stays open"}
                </span>
              </div>

              {/* The "no units at all" check belongs to the grid as a whole, so it has no single
                  line to sit under - without this the form would refuse to submit silently. */}
              {gridErrorMessage && (
                <p className="text-sm font-medium text-destructive">{gridErrorMessage}</p>
              )}
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-medium">Costs on arrival</h3>
              <p className="text-sm text-muted-foreground">
                These are spread across the units on this receipt, so each product carries its true
                cost.
              </p>

              <div className="grid grid-cols-2 gap-4">
                {(
                  [
                    ["shippingFee", "Shipping Fee"],
                    ["customsDuty", "Customs Duty"],
                    ["customsTax", "Customs Tax"],
                    ["brokerageFee", "Brokerage Fee"],
                    ["additionalFee", "Additional Fee"],
                  ] as const
                ).map(([name, label]) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{label} (VND)</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" step="0.01" placeholder="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>

              <FormField
                control={form.control}
                name="additionalFeeNote"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Additional Fee - what for?</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. fumigation certificate" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-between rounded-md border bg-muted/50 p-3 font-medium">
                <span>Total additional cost</span>
                <span>{formatCurrency(totalAdditionalCost)}</span>
              </div>
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Receipt Notes</FormLabel>
                  <FormControl>
                    <Input placeholder="Condition of the goods, missing items, ..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="create" type="submit" disabled={receiveGoods.isPending}>
                {receiveGoods.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Receive Goods
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

