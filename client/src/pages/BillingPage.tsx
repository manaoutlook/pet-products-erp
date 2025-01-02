import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Plus, Barcode, X } from "lucide-react";
import { createBillSchema } from "@db/schema";
import type { z } from "zod";
import JsBarcode from "jsbarcode";

// Types for the billing form
type BillItem = {
  productId: number;
  quantity: number;
  unitPrice: number;
  productName: string;
  categoryName: string;
  brandName: string;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
};

type BillFormValues = z.infer<typeof createBillSchema> & {
  customerPhone?: string;
};

// Component to handle barcode scanning
function BarcodeScanner({ onScan }: { onScan: (code: string) => void }) {
  const [isScanning, setIsScanning] = useState(false);

  // In a real implementation, this would use a camera API
  // For now, we'll simulate scanning with manual input
  return (
    <div className="flex items-center gap-2">
      <Input
        type="text"
        placeholder={isScanning ? "Scan barcode..." : "Enter barcode manually"}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const input = e.currentTarget;
            onScan(input.value);
            input.value = '';
          }
        }}
        disabled={!isScanning}
      />
      <Button
        variant={isScanning ? "destructive" : "default"}
        size="icon"
        onClick={() => setIsScanning(!isScanning)}
      >
        {isScanning ? <X className="h-4 w-4" /> : <Barcode className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function BillingPage() {
  const [items, setItems] = useState<BillItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<BillFormValues>({
    resolver: zodResolver(createBillSchema),
    defaultValues: {
      items: [],
      customerPhone: "",
    },
  });

  const { data: bills, isLoading } = useQuery({
    queryKey: ['/api/bills'],
  });

  const createBillMutation = useMutation({
    mutationFn: async (data: BillFormValues) => {
      const res = await fetch('/api/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bills'] });
      setDialogOpen(false);
      toast({ title: "Success", description: "Bill created successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const handleScan = async (barcode: string) => {
    try {
      const res = await fetch(`/api/products/barcode/${barcode}`);
      if (!res.ok) throw new Error("Product not found");
      const product = await res.json();
      
      // Add item to the bill
      setItems(prev => [...prev, {
        productId: product.id,
        quantity: 1,
        unitPrice: product.price,
        productName: product.name,
        categoryName: product.category.name,
        brandName: product.brand?.name || '',
        subtotal: product.price,
        vatAmount: product.price * 0.1, // 10% VAT
        totalAmount: product.price * 1.1,
      }]);
    } catch (error) {
      toast({
        title: "Error",
        description: "Product not found",
        variant: "destructive"
      });
    }
  };

  const calculateTotals = () => {
    return items.reduce((acc, item) => ({
      subtotal: acc.subtotal + item.subtotal,
      vatAmount: acc.vatAmount + item.vatAmount,
      totalAmount: acc.totalAmount + item.totalAmount,
    }), { subtotal: 0, vatAmount: 0, totalAmount: 0 });
  };

  const onSubmit = async (data: BillFormValues) => {
    try {
      const totals = calculateTotals();
      await createBillMutation.mutateAsync({
        ...data,
        items: items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      });
      setItems([]);
      form.reset();
    } catch (error) {
      // Error is handled by the mutation
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Billing Management</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Bill
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Create New Bill</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="customerPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customer Phone</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Enter customer phone"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div>
                    <FormLabel>Scan Barcode</FormLabel>
                    <BarcodeScanner onScan={handleScan} />
                  </div>
                </div>

                <div className="border rounded-lg p-4">
                  <h3 className="font-medium mb-2">Items</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Brand</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                        <TableHead className="text-right">VAT</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell>{item.productName}</TableCell>
                          <TableCell>{item.categoryName}</TableCell>
                          <TableCell>{item.brandName}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => {
                                const quantity = parseInt(e.target.value) || 1;
                                setItems(prev => prev.map((i, idx) => 
                                  idx === index ? {
                                    ...i,
                                    quantity,
                                    subtotal: i.unitPrice * quantity,
                                    vatAmount: i.unitPrice * quantity * 0.1,
                                    totalAmount: i.unitPrice * quantity * 1.1,
                                  } : i
                                ));
                              }}
                              className="w-20"
                            />
                          </TableCell>
                          <TableCell className="text-right">{item.unitPrice.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{item.subtotal.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{item.vatAmount.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{item.totalAmount.toLocaleString()}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setItems(prev => prev.filter((_, idx) => idx !== index))}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {items.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center text-muted-foreground">
                            No items added. Scan products to add them to the bill.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {items.length > 0 && (
                  <div className="flex justify-end">
                    <div className="w-72 space-y-2">
                      <div className="flex justify-between">
                        <span>Subtotal:</span>
                        <span>{calculateTotals().subtotal.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>VAT:</span>
                        <span>{calculateTotals().vatAmount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between font-bold">
                        <span>Total:</span>
                        <span>{calculateTotals().totalAmount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Points to be awarded:</span>
                        <span>{Math.floor(calculateTotals().totalAmount / 1000)}</span>
                      </div>
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={items.length === 0 || form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Create Bill
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Bills</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill Number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Points Awarded</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills?.map((bill) => (
                  <TableRow key={bill.id}>
                    <TableCell className="font-mono">{bill.billNumber}</TableCell>
                    <TableCell>{bill.customerProfile?.name || 'Walk-in Customer'}</TableCell>
                    <TableCell>{bill.store.name}</TableCell>
                    <TableCell className="text-right">{bill.totalAmount.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{bill.pointsAwarded}</TableCell>
                    <TableCell>{new Date(bill.createdAt).toLocaleDateString()}</TableCell>
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

export default BillingPage;
