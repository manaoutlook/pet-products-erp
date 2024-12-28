import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Plus, Pencil, Trash2 } from "lucide-react";
import { z } from "zod";
import { validatePrice, formatPrice, normalizePrice } from "@/utils/price";

// Product schema for form validation
const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  sku: z.string().min(1, "SKU is required"),
  price: z.number()
    .min(0, "Price must be positive")
    .transform((val) => normalizePrice(val))
    .refine(
      (val) => validatePrice(val).isValid,
      (val) => ({ message: validatePrice(val).error || "Invalid price" })
    ),
  category: z.string().min(1, "Category is required"),
  minStock: z.number().int().min(0, "Minimum stock must be positive"),
});

type ProductFormData = z.infer<typeof productSchema>;

// Update the Product interface to specify price type
interface Product {
  id: number;
  name: string;
  description: string;
  sku: string;
  price: string | number; // Update to handle both string and number
  category: string;
  minStock: number;
  inventory: {
    quantity: number;
  }[];
}

function ProductsPage() {
  const [search, setSearch] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const { toast } = useToast();

  const { data: products, isLoading, refetch } = useQuery<Product[]>({
    queryKey: ['/api/products'],
  });

  const createMutation = useMutation({
    mutationFn: async (data: ProductFormData) => {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Success", description: "Product created successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Error", 
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ProductFormData> }) => {
      const res = await fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Success", description: "Product updated successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Error", 
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "",
      description: "",
      sku: "",
      price: 0,
      category: "",
      minStock: 10,
    },
  });

  const filteredProducts = products?.filter(product => 
    product.name.toLowerCase().includes(search.toLowerCase()) ||
    product.sku.toLowerCase().includes(search.toLowerCase()) ||
    product.category.toLowerCase().includes(search.toLowerCase())
  );

  const getStockStatus = (product: Product) => {
    const quantity = product.inventory[0]?.quantity ?? 0;
    if (quantity <= 0) return { label: 'Out of Stock', class: 'bg-red-100 text-red-800' };
    if (quantity <= product.minStock) return { label: 'Low Stock', class: 'bg-yellow-100 text-yellow-800' };
    return { label: 'In Stock', class: 'bg-green-100 text-green-800' };
  };

  const onSubmit = async (data: ProductFormData) => {
    try {
      if (editingProduct) {
        await updateMutation.mutateAsync({ 
          id: editingProduct.id, 
          data: data
        });
        setEditingProduct(null);
      } else {
        await createMutation.mutateAsync(data);
      }
      form.reset();
      // Close the dialog after successful operation
      const dialogCloseButton = document.querySelector('[data-state="open"] button[type="button"]');
      if (dialogCloseButton instanceof HTMLElement) {
        dialogCloseButton.click();
      }
    } catch (error) {
      // Error is handled by the mutation
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Products</h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button onClick={() => {
              setEditingProduct(null);
              form.reset();
            }}>
              <Plus className="mr-2 h-4 w-4" />
              Add Product
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingProduct ? 'Edit Product' : 'Add New Product'}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sku"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SKU</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.01"
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="minStock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum Stock</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {editingProduct ? 'Update Product' : 'Create Product'}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Product List</CardTitle>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant="outline">Export</Button>
          </div>
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
                  <TableHead>Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts?.map((product) => {
                  const stockStatus = getStockStatus(product);
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div>{product.name}</div>
                        <div className="text-sm text-muted-foreground">{product.description}</div>
                      </TableCell>
                      <TableCell>{product.sku}</TableCell>
                      <TableCell>{product.category}</TableCell>
                      <TableCell>{formatPrice(product.price)}</TableCell>
                      <TableCell>{product.inventory[0]?.quantity ?? 0}</TableCell>
                      <TableCell>
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${stockStatus.class}`}>
                          {stockStatus.label}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => {
                                  setEditingProduct(product);
                                  form.reset({
                                    name: product.name,
                                    description: product.description,
                                    sku: product.sku,
                                    price: Number(product.price), // Parse price as number
                                    category: product.category,
                                    minStock: product.minStock,
                                  });
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Edit Product</DialogTitle>
                              </DialogHeader>
                              <Form {...form}>
                                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                                  <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>Name</FormLabel>
                                        <FormControl>
                                          <Input {...field} />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                  <FormField
                                    control={form.control}
                                    name="description"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>Description</FormLabel>
                                        <FormControl>
                                          <Input {...field} />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                  <FormField
                                    control={form.control}
                                    name="sku"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>SKU</FormLabel>
                                        <FormControl>
                                          <Input {...field} />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                  <FormField
                                    control={form.control}
                                    name="price"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>Price</FormLabel>
                                        <FormControl>
                                          <Input 
                                            type="number" 
                                            step="0.01"
                                            {...field}
                                            onChange={(e) => field.onChange(parseFloat(e.target.value))}
                                          />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                  <FormField
                                    control={form.control}
                                    name="category"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>Category</FormLabel>
                                        <FormControl>
                                          <Input {...field} />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                  <FormField
                                    control={form.control}
                                    name="minStock"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>Minimum Stock</FormLabel>
                                        <FormControl>
                                          <Input 
                                            type="number" 
                                            {...field}
                                            onChange={(e) => field.onChange(parseInt(e.target.value))}
                                          />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                  <Button
                                    type="submit"
                                    className="w-full"
                                    disabled={form.formState.isSubmitting}
                                  >
                                    {form.formState.isSubmitting && (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    )}
                                    Update Product
                                  </Button>
                                </form>
                              </Form>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default ProductsPage;