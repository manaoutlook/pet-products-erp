import { useEffect, useMemo } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useVatCompanies } from "@/hooks/use-vat-companies";
import { Loader2, Check, Plus, Trash2 } from "lucide-react";
import { formatCurrency, formatPercent } from "@/utils/format";
import { computeSaleTotals, VAT_RATE } from "@shared/tax";

/** A line as the form edits it - `unitPrice` may be omitted to keep the catalogue price. */
export interface SalesOrderFormLine {
  id?: number;
  productId: number;
  quantity: number;
  unitPrice: number | string;
  deliveredQuantity?: number;
}

/** The order being edited. Omit (or pass null) to create a new one. */
export interface SalesOrderFormOrder {
  id: number;
  orderNumber: string;
  customerProfileId?: number | null;
  customerName: string;
  companyName?: string | null;
  contactPerson?: string | null;
  customerTaxId?: string | null;
  phone?: string | null;
  deliveryAddress?: string | null;
  orderDate?: string | null;
  specialInstructions?: string | null;
  /** The licensed company that issues this order's paperwork, or null for "No VAT". */
  vatCompanyId?: number | null;
  vatCompanyCode?: string | null;
  vatCompanyName?: string | null;
  vatCompanyTaxId?: string | null;
  vatCompanyAddress?: string | null;
  items?: SalesOrderFormLine[] | null;
}

interface CustomerProfile {
  id: number;
  companyName?: string | null;
  contactPerson: string;
  mobileNumber: string;
  address: string;
  /** The business's tax code - printed against the buyer on a VAT invoice. */
  taxId?: string | null;
}

interface CatalogueProduct {
  id: number;
  name: string;
  sku: string;
  price: number | string;
}

const salesOrderSchema = z.object({
  customerProfileId: z.string().optional(),
  customerName: z
    .string()
    .trim()
    .min(1, "Customer name is required")
    .max(200, "Customer name is too long"),
  companyName: z.string().optional(),
  contactPerson: z.string().optional(),
  customerTaxId: z.string().optional(),
  phone: z.string().optional(),
  deliveryAddress: z.string().optional(),
  orderDate: z.string().min(1, "Order date is required"),
  specialInstructions: z.string().optional(),
  // "No VAT" / "With VAT" - mirroring the two buttons in the form. The company id is a string
  // because it comes from a select, and it is only required when VAT is switched on.
  withVat: z.boolean(),
  vatCompanyId: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, "Pick a product for every line"),
        quantity: z
          .string()
          .min(1, "Quantity is required")
          .refine(
            (value) => Number.isInteger(Number(value)) && Number(value) > 0,
            "Quantity must be a whole number above zero"
          ),
        unitPrice: z
          .string()
          .min(1, "Unit price is required")
          .refine(
            (value) => Number.isFinite(Number(value)) && Number(value) >= 0,
            "Unit price cannot be negative"
          ),
      })
    )
    .min(1, "Add at least one product to the order"),
}).superRefine((values, ctx) => {
  if (values.withVat && !values.vatCompanyId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vatCompanyId"],
      message: "Select the company that issues the VAT documents",
    });
  }
});

type SalesOrderFormValues = z.infer<typeof salesOrderSchema>;

/** Local `yyyy-mm-dd` for a date input - never the UTC slice, which can slip a day. */
export function toDateInputValue(value: string | Date | null | undefined): string {
  const parsed = value ? new Date(value) : new Date();
  const safe = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const month = String(safe.getMonth() + 1).padStart(2, "0");
  const day = String(safe.getDate()).padStart(2, "0");
  return `${safe.getFullYear()}-${month}-${day}`;
}

function emptyLine(): SalesOrderFormValues["items"][number] {
  return { productId: "", quantity: "", unitPrice: "" };
}

function formDefaults(order?: SalesOrderFormOrder | null): SalesOrderFormValues {
  return {
    customerProfileId: order?.customerProfileId ? String(order.customerProfileId) : "",
    customerName: order?.customerName ?? "",
    companyName: order?.companyName ?? "",
    contactPerson: order?.contactPerson ?? "",
    customerTaxId: order?.customerTaxId ?? "",
    phone: order?.phone ?? "",
    deliveryAddress: order?.deliveryAddress ?? "",
    orderDate: toDateInputValue(order?.orderDate),
    specialInstructions: order?.specialInstructions ?? "",
    withVat: Boolean(order?.vatCompanyId),
    vatCompanyId: order?.vatCompanyId ? String(order.vatCompanyId) : "",
    items:
      order?.items && order.items.length > 0
        ? order.items.map((line) => ({
            productId: String(line.productId),
            quantity: String(line.quantity),
            unitPrice: String(Number(line.unitPrice)),
          }))
        : [emptyLine()],
  };
}

interface SalesOrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Order to edit. Editing is only offered while nothing has been delivered. */
  order?: SalesOrderFormOrder | null;
  /** Shown instead of the save button once the order can no longer be changed. */
  disabledReason?: string;
}

/**
 * Create / edit a sales order.
 *
 * Line money is only *previewed* here: the API recomputes every `totalPrice` from
 * quantity x unit price (`buildSalesOrderLines`), so a stale tab cannot store an order that
 * does not add up. The same endpoint refuses the edit once a delivery note exists, which is
 * why the save button is disabled with an explanation instead of failing on submit.
 */
export function SalesOrderFormDialog({
  open,
  onOpenChange,
  order = null,
  disabledReason,
}: SalesOrderFormDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = Boolean(order);

  const form = useForm<SalesOrderFormValues>({
    resolver: zodResolver(salesOrderSchema),
    defaultValues: formDefaults(order),
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });

  // Re-seed whenever the dialog opens for a different order (or for a new one).
  useEffect(() => {
    if (open) {
      form.reset(formDefaults(order));
    }
  }, [open, order, form]);

  const { data: products = [] } = useQuery<CatalogueProduct[]>({
    queryKey: ["/api/products"],
  });

  const { data: customers = [] } = useQuery<CustomerProfile[]>({
    queryKey: ["/api/customer-profiles"],
  });

  // The licensed companies (CI / HI) that may issue this order's VAT paperwork.
  const { activeCompanies: vatCompanies, isLoading: vatCompaniesLoading } = useVatCompanies();
  const withVat = form.watch("withVat");
  const selectedVatCompanyId = form.watch("vatCompanyId");

  const productOptions = useMemo(
    () =>
      products.map((product) => ({
        value: String(product.id),
        label: product.name,
        description: product.sku,
      })),
    [products]
  );

  const customerOptions = useMemo(
    () =>
      customers.map((customer) => ({
        value: String(customer.id),
        // The company is what the paperwork is addressed to, so lead with it when there is one.
        label: customer.companyName
          ? `${customer.companyName} — ${customer.contactPerson}`
          : customer.contactPerson,
        description: customer.mobileNumber,
      })),
    [customers]
  );

  const watchedItems = form.watch("items");
  const previewTotal = (watchedItems ?? []).reduce(
    (sum, line) => sum + Number(line?.quantity || 0) * Number(line?.unitPrice || 0),
    0
  );

  const saveOrder = useMutation({
    mutationFn: async (values: SalesOrderFormValues) => {
      const payload = {
        customerProfileId: values.customerProfileId ? Number(values.customerProfileId) : null,
        customerName: values.customerName.trim(),
        companyName: values.companyName?.trim() || null,
        contactPerson: values.contactPerson?.trim() || null,
        customerTaxId: values.customerTaxId?.trim() || null,
        phone: values.phone?.trim() || null,
        deliveryAddress: values.deliveryAddress?.trim() || null,
        // Noon local time: midnight would land on the previous day in some zones once the
        // timestamp is converted back for display.
        orderDate: new Date(`${values.orderDate}T12:00:00`).toISOString(),
        specialInstructions: values.specialInstructions?.trim() || null,
        // Null means "No VAT": the order (and every delivery note and invoice after it)
        // prints the shop's own letterhead. The server snapshots the company block.
        vatCompanyId: values.withVat ? Number(values.vatCompanyId) : null,
        items: values.items.map((line) => ({
          productId: Number(line.productId),
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
        })),
      };

      const response = await fetch(
        isEdit ? `/api/sales-orders/${order!.id}` : "/api/sales-orders",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to save the sales order");
      }

      return response.json();
    },
    onSuccess: (saved: { orderNumber?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
      toast({
        title: isEdit ? "Sales order updated" : "Sales order created",
        description: saved?.orderNumber
          ? `${saved.orderNumber} saved`
          : "The sales order has been saved",
        variant: "success",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const applyCustomer = (customerId: string | null) => {
    form.setValue("customerProfileId", customerId ?? "");

    if (!customerId) return;

    const customer = customers.find((entry) => String(entry.id) === customerId);
    if (!customer) return;

    // Prefill only what the profile knows; anything already typed wins.
    if (!form.getValues("customerName")) {
      form.setValue("customerName", customer.companyName || customer.contactPerson);
    }
    if (customer.companyName && !form.getValues("companyName")) {
      form.setValue("companyName", customer.companyName);
    }
    if (!form.getValues("contactPerson")) form.setValue("contactPerson", customer.contactPerson);
    if (!form.getValues("phone")) form.setValue("phone", customer.mobileNumber);
    if (!form.getValues("deliveryAddress")) form.setValue("deliveryAddress", customer.address);
    if (customer.taxId && !form.getValues("customerTaxId")) {
      form.setValue("customerTaxId", customer.taxId);
    }
  };

  const applyProduct = (index: number, productId: string | null) => {
    form.setValue(`items.${index}.productId`, productId ?? "", { shouldValidate: true });

    const product = products.find((entry) => String(entry.id) === productId);
    if (product) {
      // Catalogue price is the starting point; a negotiated price may still be typed over it.
      form.setValue(`items.${index}.unitPrice`, String(Number(product.price)));
    }
  };

  const onSubmit = (values: SalesOrderFormValues) => saveOrder.mutate(values);
  const saving = saveOrder.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit Sales Order ${order?.orderNumber ?? ""}` : "New Sales Order"}
          </DialogTitle>
          <DialogDescription>
            The customer block and product details are copied onto the order, so a reprint always
            matches what was signed.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="customerProfileId"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Customer Profile (optional)</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value || null}
                        onChange={applyCustomer}
                        options={customerOptions}
                        placeholder="Pick a saved customer"
                        searchPlaceholder="Search by name or phone..."
                        emptyMessage="No customer profiles found."
                        clearLabel="Not a saved customer - type the details"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="customerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Nguyen Van A" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="companyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Smart ERP Co., Ltd" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="contactPerson"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Person</FormLabel>
                    <FormControl>
                      <Input placeholder="Who receives the goods" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input placeholder="0901234567" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="deliveryAddress"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Delivery Address</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Where the goods are dropped off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="orderDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Order Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* The VAT company is chosen HERE, when the order is raised - not at the till.
                Every document that follows (sales order, delivery note, invoice) prints the
                letterhead of the company selected here. */}
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">VAT Documents</h3>
                <p className="text-caption text-muted-foreground">
                  Choose the licensed company that issues the Sales Order, Delivery Note and
                  VAT invoice for this order. Leave it on "No VAT" for a retail order.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={withVat ? "outline" : "default"}
                  onClick={() => {
                    form.setValue("withVat", false, { shouldValidate: true });
                    form.setValue("vatCompanyId", "");
                  }}
                >
                  {!withVat && <Check className="mr-2 h-4 w-4" />}
                  No VAT
                </Button>
                <Button
                  type="button"
                  variant={withVat ? "default" : "outline"}
                  onClick={() => form.setValue("withVat", true, { shouldValidate: true })}
                >
                  {withVat && <Check className="mr-2 h-4 w-4" />}
                  With VAT
                </Button>
              </div>

              {withVat && (
                <div className="space-y-2">
                  {vatCompaniesLoading ? (
                    <p className="text-sm text-muted-foreground">Loading VAT companies...</p>
                  ) : vatCompanies.length === 0 ? (
                    <p className="text-sm text-destructive">
                      No VAT company is configured. Add one in Master Data &rarr; VAT Companies.
                    </p>
                  ) : (
                    vatCompanies.map((vatCompany) => {
                      const unusable = vatCompany.missingFields.length > 0;
                      const selected = selectedVatCompanyId === String(vatCompany.id);

                      return (
                        <Button
                          key={vatCompany.id}
                          type="button"
                          variant={selected ? "default" : "outline"}
                          className="w-full justify-start h-auto py-2"
                          disabled={unusable}
                          onClick={() =>
                            form.setValue("vatCompanyId", String(vatCompany.id), {
                              shouldValidate: true,
                            })
                          }
                        >
                          <span className="font-mono mr-2">{vatCompany.code}</span>
                          <span className="flex-1 text-left">
                            <span className="block">{vatCompany.name}</span>
                            <span className="block text-xs font-normal opacity-80">
                              {unusable
                                ? `Incomplete: ${vatCompany.missingFields.join(", ")}`
                                : `Tax code: ${vatCompany.taxId}`}
                            </span>
                          </span>
                          {selected && <Check className="ml-2 h-4 w-4" />}
                        </Button>
                      );
                    })
                  )}

                  <FormField
                    control={form.control}
                    name="customerTaxId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Buyer Tax Code (VAT invoice)</FormLabel>
                        <FormControl>
                          <Input placeholder="Buyer's tax code" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {form.formState.errors.vatCompanyId?.message ? (
                    <p className="text-sm font-medium text-destructive">
                      {form.formState.errors.vatCompanyId.message}
                    </p>
                  ) : null}

                  <p className="text-xs text-muted-foreground">
                    The company&apos;s name, tax code and address are copied onto this order and
                    onto every delivery note issued from it, so a reprint always matches the
                    signed document.
                  </p>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Products</h3>
                <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine())}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add line
                </Button>
              </div>

              {fields.map((field, index) => {
                const line = watchedItems?.[index];
                const amount = Number(line?.quantity || 0) * Number(line?.unitPrice || 0);

                return (
                  <div key={field.id} className="grid grid-cols-12 items-start gap-2">
                    <FormField
                      control={form.control}
                      name={`items.${index}.productId`}
                      render={({ field: productField }) => (
                        <FormItem className="col-span-12 sm:col-span-5">
                          <FormControl>
                            <SearchableSelect
                              value={productField.value || null}
                              onChange={(value) => applyProduct(index, value)}
                              options={productOptions}
                              placeholder="Select product"
                              searchPlaceholder="Search by name or SKU..."
                              emptyMessage="No products found."
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`items.${index}.quantity`}
                      render={({ field: quantityField }) => (
                        <FormItem className="col-span-4 sm:col-span-2">
                          <FormControl>
                            <Input type="number" min="1" step="1" placeholder="Qty" {...quantityField} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`items.${index}.unitPrice`}
                      render={({ field: priceField }) => (
                        <FormItem className="col-span-5 sm:col-span-2">
                          <FormControl>
                            <Input type="number" min="0" step="0.01" placeholder="Unit price" {...priceField} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="col-span-2 sm:col-span-2 flex h-10 items-center justify-end text-sm font-medium">
                      {formatCurrency(amount)}
                    </div>

                    <div className="col-span-1 flex h-10 items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(index)}
                        disabled={fields.length === 1}
                        title="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}

              {form.formState.errors.items?.message ? (
                <p className="text-sm font-medium text-destructive">
                  {form.formState.errors.items.message}
                </p>
              ) : null}

              <div className="space-y-1 border-t pt-3 text-sm">
                <div className="flex justify-end gap-6">
                  <span className="text-muted-foreground">
                    {withVat ? "Subtotal (excl. VAT)" : "Total"}
                  </span>
                  <span className="font-semibold">{formatCurrency(previewTotal)}</span>
                </div>
                {withVat
                  ? (() => {
                      // The order stores the VAT-exclusive total; VAT is added on top, using
                      // the same rule the till and the invoice use (shared/tax.ts).
                      const totals = computeSaleTotals(previewTotal, true, VAT_RATE);
                      return (
                        <>
                          <div className="flex justify-end gap-6">
                            <span className="text-muted-foreground">
                              VAT ({formatPercent(VAT_RATE)})
                            </span>
                            <span className="font-semibold">
                              {formatCurrency(totals.vatAmount)}
                            </span>
                          </div>
                          <div className="flex justify-end gap-6">
                            <span className="text-muted-foreground">Total incl. VAT</span>
                            <span className="font-semibold">{formatCurrency(totals.total)}</span>
                          </div>
                        </>
                      );
                    })()
                  : null}
              </div>
            </div>

            <FormField
              control={form.control}
              name="specialInstructions"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Special Instructions</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Delivery window, gate code, paperwork..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {disabledReason ? (
              <p className="rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground">
                {disabledReason}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="create" disabled={saving || Boolean(disabledReason)}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? "Save Changes" : "Create Sales Order"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default SalesOrderFormDialog;
