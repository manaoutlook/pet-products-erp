import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PendingAttachmentPicker } from "@/components/attachments/AttachmentUploader";
import { uploadAttachmentFiles } from "@/components/attachments/attachment-api";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import {
  BACK_DATED_PURCHASE_ORDER_MESSAGE,
  isBackDatedPurchaseOrderDate,
  todayInVietnam,
} from "@shared/purchase-order-dates";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@shared/invoice-payment";
import { Loader2, Plus, Trash2 } from "lucide-react";

// Schema for the purchase order form
const purchaseOrderSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  // AI Agent Note: destinationStoreId is mandatory for multiple DC support.
  destinationStoreId: z.string().min(1, "Destination Warehouse is required"),
  // AI Agent Note: the shape of the expected delivery date is all this checks. Whether a past
  // date may be used is a permission question (administrators only - see
  // shared/purchase-order-dates.ts), answered in `onSubmit` where the role is known; a schema
  // built at module load cannot see the logged-in user.
  deliveryDate: z
    .string()
    .min(1, "Delivery date is required")
    .refine((date) => !Number.isNaN(new Date(date).getTime()), "Enter a valid delivery date"),
  // How the supplier is paid. It also decides whether the expense the order posts counts as cash
  // or as bank money in Finance, so it is part of the order rather than an afterthought.
  paymentMethod: z.string().min(1, "Choose how the supplier is paid"),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().min(1, "Product is required"),
    quantity: z.string().min(1, "Quantity is required")
      .refine((val) => !isNaN(parseInt(val)) && parseInt(val) > 0, "Quantity must be a positive number"),
    unitPrice: z.string().min(1, "Unit price is required")
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Unit price must be a positive number"),
  })).min(1, "At least one item is required"),
});

type FormData = z.infer<typeof purchaseOrderSchema>;

/**
 * The rows this dialog reads from the API. Typing them is what lets `warehouses`, the product
 * price lookup and the selects below be checked: an untyped `useQuery` makes the data `unknown`,
 * and every `.filter`/`.find` on it then fails the type check (or silently works on `any`).
 */
interface SupplierOption {
  id: number;
  name: string;
}

interface ProductOption {
  id: number;
  name: string;
  price: string;
  /** Catalogue code, shown next to the name and searchable. Optional: older rows may be blank. */
  sku?: string | null;
}

interface StoreOption {
  id: number;
  name: string;
  type: string | null;
}


export function CreatePurchaseOrderDialog() {
  const [open, setOpen] = useState(false);
  // Pictures picked before the order exists (supplier invoice, transfer screenshot). They are
  // uploaded right after the POST returns the new order id - the API needs a transaction to hang
  // them on.
  const [documents, setDocuments] = useState<File[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Back-dating an order is an administrator's call: the expected date drives the overdue report.
  const { isAdmin } = usePermissions();

  // Set default delivery date to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDeliveryDate = tomorrow.toISOString().slice(0, 16); // Format: YYYY-MM-DDTHH:mm

  const form = useForm<FormData>({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues: {
      items: [{ productId: "", quantity: "", unitPrice: "" }],
      deliveryDate: defaultDeliveryDate,
      destinationStoreId: "", // Default empty
      paymentMethod: "CASH",
    },
  });

  const { data: suppliers = [] } = useQuery<SupplierOption[]>({
    queryKey: ['/api/suppliers'],
  });

  const supplierOptions = useMemo(
    () => suppliers.map((supplier) => ({ value: supplier.id.toString(), label: supplier.name })),
    [suppliers]
  );

  const { data: products = [] } = useQuery<ProductOption[]>({
    queryKey: ['/api/products'],
  });

  const { data: stores = [] } = useQuery<StoreOption[]>({
    queryKey: ['/api/stores'],
  });

  // AI Agent Note: Filter stores for those with type 'WAREHOUSE' (Distribution Center)
  const warehouses = stores.filter((s) => s.type === 'WAREHOUSE');

  // AI Agent Note: the catalogue is longer than a native select can be scanned, so the item
  // picker is a searchable combobox. The SKU is indexed too - the product name alone is not
  // enough when several variants share a prefix ("SmartLife ... Pen").
  const productOptions = useMemo(
    () =>
      products.map((product) => ({
        value: String(product.id),
        label: product.name,
        description: product.sku ?? null,
      })),
    [products]
  );

  const createPurchaseOrder = useMutation({
    mutationFn: async (data: FormData): Promise<{ purchaseOrder: { id: number; orderNumber: string } }> => {
      const response = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          supplierId: parseInt(data.supplierId),
          destinationStoreId: parseInt(data.destinationStoreId), // New field for multi-DC support
          deliveryDate: new Date(data.deliveryDate).toISOString(),
          paymentMethod: data.paymentMethod,
          notes: data.notes,
          items: data.items.map(item => ({
            productId: parseInt(item.productId),
            quantity: parseInt(item.quantity),
            unitPrice: parseFloat(item.unitPrice),
          })),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.errors) {
          throw new Error(
            errorData.errors.map((err: any) => `${err.field}: ${err.message}`).join('\n')
          );
        }
        throw new Error(errorData.message || 'Failed to create purchase order');
      }

      return response.json();
    },
    onSuccess: async (result) => {
      // The order now exists, so the pictures picked above can be attached to it. A failure here
      // never undoes the order - the message says which picture has to be added again from the
      // register.
      const uploaded = documents.length
        ? await uploadAttachmentFiles("purchase_order", result.purchaseOrder.id, documents)
        : null;

      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });

      if (uploaded && uploaded.failures.length > 0) {
        toast({
          title: `Order ${result.purchaseOrder.orderNumber} created, but ${uploaded.failures.length} picture(s) were not saved`,
          description: uploaded.failures.join(" "),
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: "Purchase order created successfully",
          variant: "success",
        });
      }

      setOpen(false);
      setDocuments([]);
      form.reset({
        items: [{ productId: "", quantity: "", unitPrice: "" }],
        deliveryDate: defaultDeliveryDate,
        paymentMethod: "CASH",
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

  const onSubmit = (data: FormData) => {
    // The server enforces the same rule (POST /api/purchase-orders); checking here turns a 403
    // after the whole payload is built into an inline message next to the date field.
    if (!isAdmin && isBackDatedPurchaseOrderDate(data.deliveryDate)) {
      form.setError("deliveryDate", { message: BACK_DATED_PURCHASE_ORDER_MESSAGE });
      return;
    }
    createPurchaseOrder.mutate(data);
  };

  const handleProductChange = (index: number, productId: string | null) => {
    // The picker has no "clear" entry, so this only guards the `null` its onChange type allows.
    if (!productId) return;
    form.setValue(`items.${index}.productId`, productId, { shouldValidate: true });
    const selectedProduct = products.find((p) => p.id.toString() === productId);
    if (selectedProduct) {
      form.setValue(`items.${index}.unitPrice`, selectedProduct.price.toString());
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing without saving drops the staged pictures, so a later order cannot inherit them.
        if (!next) setDocuments([]);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="create">
          <Plus className="mr-2 h-4 w-4" />
          Create Purchase Order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Purchase Order</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Two columns: the four header fields are short, and stacking them pushed Items and the
                pictures below the fold. Falls back to one column on a narrow screen. */}
            <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Supplier</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      value={field.value || null}
                      onChange={(value) => field.onChange(value ?? "")}
                      options={supplierOptions}
                      placeholder="Select supplier"
                      searchPlaceholder="Search suppliers..."
                      emptyMessage="No suppliers found."
                      aria-label="Supplier"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="destinationStoreId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Destination Warehouse (DC)</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select destination warehouse" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {warehouses.map((warehouse: any) => (
                        <SelectItem key={warehouse.id} value={warehouse.id.toString()}>
                          {warehouse.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                    <Input
                      type="datetime-local"
                      {...field}
                      // Everyone else can only pick from today on; an administrator may reach
                      // back, because entering an order after the goods arrived is normal
                      // bookkeeping. The API enforces the same boundary.
                      min={isAdmin ? undefined : `${todayInVietnam()}T00:00`}
                    />
                  </FormControl>
                  <FormDescription>
                    {isAdmin
                      ? "Past dates are allowed - use them when you are entering an order that was already delivered."
                      : "Today or a later. Only an administrator can back-date a purchase order."}
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
                    Cash comes out of the till, bank transfer out of the bank - Finance keeps them
                    apart in "money on hand".
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
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Items</h3>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const items = form.getValues("items");
                    form.setValue("items", [
                      ...items,
                      { productId: "", quantity: "", unitPrice: "" },
                    ]);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Item
                </Button>
              </div>

              {form.watch("items").map((_, index) => (
                <div key={index} className="flex gap-4">
                  <FormField
                    control={form.control}
                    name={`items.${index}.productId`}
                    render={({ field }) => (
                      // The product name is the long value in this row, so it takes twice the width
                      // of the two numbers beside it - that is what stops every row reading
                      // "SmartLif... PW...".
                      <FormItem className="min-w-0 flex-[2]">
                        <FormControl>
                          <SearchableSelect
                            value={field.value || null}
                            onChange={(value) => handleProductChange(index, value)}
                            options={productOptions}
                            placeholder="Select product"
                            searchPlaceholder="Search by name or SKU..."
                            emptyMessage="No products found."
                            aria-label={`Product ${index + 1}`}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`items.${index}.quantity`}
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="Quantity"
                            min="1"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`items.${index}.unitPrice`}
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="Unit Price (VND)"
                            min="0.01"
                            step="0.01"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="self-start"
                    onClick={() => {
                      const items = form.getValues("items");
                      if (items.length > 1) {
                        form.setValue(
                          "items",
                          items.filter((_, i) => i !== index)
                        );
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <PendingAttachmentPicker
              files={documents}
              onFilesChange={setDocuments}
              label="Supplier invoice / bank-transfer pictures"
              description="Photograph or screenshot the supplier invoice, the transfer confirmation or any paperwork that belongs to this order - up to 10 pictures, 5 MB each. They are saved with the order when you create it."
              disabled={createPurchaseOrder.isPending}
            />

            <p className="text-xs text-muted-foreground">
              Creating this order records a "Supplier purchases" expense for its total in Finance,
              dated today and paid by the method chosen above. Cancelling the order voids that
              entry.
            </p>

            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button variant="create"
                type="submit"
                disabled={createPurchaseOrder.isPending}
              >
                {createPurchaseOrder.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create Purchase Order
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
