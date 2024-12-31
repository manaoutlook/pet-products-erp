import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";

// Schema for the purchase order form
const purchaseOrderSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  deliveryDate: z.string().refine((date) => {
    const deliveryDate = new Date(date);
    const now = new Date();
    return deliveryDate > now;
  }, "Delivery date must be in the future"),
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

export function CreatePurchaseOrderDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Set default delivery date to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDeliveryDate = tomorrow.toISOString().slice(0, 16); // Format: YYYY-MM-DDTHH:mm

  const form = useForm<FormData>({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues: {
      items: [{ productId: "", quantity: "", unitPrice: "" }],
      deliveryDate: defaultDeliveryDate,
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['/api/suppliers'],
  });

  const { data: products = [] } = useQuery({
    queryKey: ['/api/products'],
  });

  const createPurchaseOrder = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          supplierId: parseInt(data.supplierId),
          deliveryDate: new Date(data.deliveryDate).toISOString(),
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      toast({
        title: "Success",
        description: "Purchase order created successfully",
      });
      setOpen(false);
      form.reset({
        items: [{ productId: "", quantity: "", unitPrice: "" }],
        deliveryDate: defaultDeliveryDate,
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
    createPurchaseOrder.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Purchase Order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Purchase Order</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Supplier</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select supplier" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {suppliers.map((supplier: any) => (
                        <SelectItem key={supplier.id} value={supplier.id.toString()}>
                          {supplier.name}
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
                  <FormLabel>Delivery Date</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      {...field}
                      min={new Date().toISOString().slice(0, 16)}
                    />
                  </FormControl>
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
                      <FormItem className="flex-1">
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select product" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {products.map((product: any) => (
                              <SelectItem key={product.id} value={product.id.toString()}>
                                {product.name}
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

            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
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