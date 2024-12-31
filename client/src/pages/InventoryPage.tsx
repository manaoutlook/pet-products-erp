import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Search, Pencil, Trash2, Filter, RefreshCw } from "lucide-react";
import { useForm, FormProvider } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Barcode } from "@/components/ui/barcode";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const inventorySchema = z.object({
  productId: z.string().min(1, "Product is required"),
  storeId: z.string().optional(),
  supplierId: z.string().optional(),
  quantity: z.string().min(1, "Quantity is required"),
  location: z.string().optional(),
  inventoryType: z.enum(["DC", "STORE"], { required_error: "Inventory type is required" }),
});

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sku: z.string().min(1, "SKU is required"),
  price: z.string().min(1, "Price is required"),
  categoryId: z.string().min(1, "Category is required"),
  minStock: z.string().optional(),
  description: z.string().optional(),
});

const supplierSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contactInfo: z.string().min(1, "Contact information is required"),
  address: z.string().min(1, "Address is required"),
});

type InventoryFormValues = z.infer<typeof inventorySchema>;
type ProductFormValues = z.infer<typeof productSchema>;
type SupplierFormValues = z.infer<typeof supplierSchema>;

interface Product {
  id: number;
  name: string;
  sku: string;
  minStock: number;
}

interface Store {
  id: number;
  name: string;
}

interface Supplier {
  id: number;
  name: string;
  contactInfo: string;
  address: string;
}

interface InventoryItem {
  id: number;
  productId: number;
  storeId: number | null;
  supplierId: number | null;
  quantity: number;
  location: string | null;
  inventoryType: 'DC' | 'STORE';
  centerId: string | null;
  barcode: string;
  product: Product;
  store: Store | null;
  supplier: Supplier | null;
}

interface FilterState {
  inventoryType: string;
  storeId: string;
  supplierId: string;
  stockStatus: string;
}

interface Category {
  id: number;
  name: string;
}

function InventoryPage() {
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const [filters, setFilters] = useState<FilterState>({
    inventoryType: '',
    storeId: '',
    supplierId: '',
    stockStatus: '',
  });
  const [showQuickAddProduct, setShowQuickAddProduct] = useState(false);
  const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false);
  const queryClient = useQueryClient();

  const canCreate = hasPermission('inventory', 'create');
  const canUpdate = hasPermission('inventory', 'update');
  const canDelete = hasPermission('inventory', 'delete');

  const form = useForm<InventoryFormValues>({
    resolver: zodResolver(inventorySchema),
    defaultValues: {
      productId: '',
      storeId: '',
      supplierId: '',
      quantity: '',
      location: '',
      inventoryType: 'DC',
    },
  });

  const productForm = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "",
      sku: "",
      price: "",
      categoryId: "",
      minStock: "10",
      description: "",
    },
  });

  const supplierForm = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: "",
      contactInfo: "",
      address: "",
    },
  });

  const { data: inventory, isLoading, refetch: refetchInventory } = useQuery<InventoryItem[]>({
    queryKey: ['/api/inventory'],
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ['/api/products'],
  });

  const { data: stores } = useQuery<Store[]>({
    queryKey: ['/api/stores'],
  });

  const { data: suppliers } = useQuery<Supplier[]>({
    queryKey: ['/api/suppliers'],
  });

  const { data: categories } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
  });

  const createInventoryMutation = useMutation({
    mutationFn: async (data: InventoryFormValues) => {
      if (!canCreate) {
        throw new Error("You don't have permission to create inventory items");
      }
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          productId: parseInt(data.productId),
          storeId: data.storeId ? parseInt(data.storeId) : null,
          supplierId: data.supplierId ? parseInt(data.supplierId) : null,
          quantity: parseInt(data.quantity),
        }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetchInventory();
      setDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Inventory item created successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const updateInventoryMutation = useMutation({
    mutationFn: async (data: InventoryFormValues & { id: number }) => {
      if (!canUpdate) {
        throw new Error("You don't have permission to update inventory items");
      }
      const res = await fetch(`/api/inventory/${data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          productId: parseInt(data.productId),
          storeId: data.storeId ? parseInt(data.storeId) : null,
          supplierId: data.supplierId ? parseInt(data.supplierId) : null,
          quantity: parseInt(data.quantity),
        }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetchInventory();
      setDialogOpen(false);
      setSelectedItem(null);
      form.reset();
      toast({ title: "Success", description: "Inventory item updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const deleteInventoryMutation = useMutation({
    mutationFn: async (id: number) => {
      if (!canDelete) {
        throw new Error("You don't have permission to delete inventory items");
      }
      const res = await fetch(`/api/inventory/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetchInventory();
      toast({ title: "Success", description: "Inventory item deleted successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const createProductMutation = useMutation({
    mutationFn: async (data: ProductFormValues) => {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          price: parseFloat(data.price),
          minStock: data.minStock ? parseInt(data.minStock) : 10,
          categoryId: parseInt(data.categoryId),
        }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      setShowQuickAddProduct(false);
      productForm.reset();
      form.setValue('productId', data.id.toString());
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

  const createSupplierMutation = useMutation({
    mutationFn: async (data: SupplierFormValues) => {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
      setShowQuickAddSupplier(false);
      supplierForm.reset();
      form.setValue('supplierId', data.id.toString());
      toast({ title: "Success", description: "Supplier created successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const onSubmit = async (data: InventoryFormValues) => {
    try {
      if (selectedItem) {
        if (!canUpdate) {
          throw new Error("You don't have permission to update inventory items");
        }
        await updateInventoryMutation.mutateAsync({ ...data, id: selectedItem.id });
      } else {
        if (!canCreate) {
          throw new Error("You don't have permission to create inventory items");
        }
        await createInventoryMutation.mutateAsync(data);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const onSubmitProduct = async (data: ProductFormValues) => {
    try {
      await createProductMutation.mutateAsync(data);
    } catch (error: any) {
      // Error is handled by the mutation
    }
  };

  const onSubmitSupplier = async (data: SupplierFormValues) => {
    try {
      await createSupplierMutation.mutateAsync(data);
    } catch (error: any) {
      // Error is handled by the mutation
    }
  };

  const handleEdit = (item: InventoryItem) => {
    if (!canUpdate) {
      toast({
        title: "Error",
        description: "You don't have permission to update inventory items",
        variant: "destructive"
      });
      return;
    }
    setSelectedItem(item);
    form.reset({
      productId: item.productId.toString(),
      storeId: item.storeId?.toString() || '',
      supplierId: item.supplierId?.toString() || '',
      quantity: item.quantity.toString(),
      location: item.location || '',
      inventoryType: item.inventoryType,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!canDelete) {
      toast({
        title: "Error",
        description: "You don't have permission to delete inventory items",
        variant: "destructive"
      });
      return;
    }
    if (confirm('Are you sure you want to delete this inventory item?')) {
      await deleteInventoryMutation.mutateAsync(id);
    }
  };

  const filteredInventory = inventory?.filter(item => {
    const matchesSearch = search.toLowerCase().trim() === '' ||
      item.product.name.toLowerCase().includes(search.toLowerCase()) ||
      item.product.sku.toLowerCase().includes(search.toLowerCase()) ||
      item.location?.toLowerCase().includes(search.toLowerCase()) ||
      item.store?.name.toLowerCase().includes(search.toLowerCase()) ||
      item.supplier?.name.toLowerCase().includes(search.toLowerCase());

    const matchesType = !filters.inventoryType || item.inventoryType === filters.inventoryType;
    const matchesStore = !filters.storeId || item.storeId?.toString() === filters.storeId;
    const matchesSupplier = !filters.supplierId || item.supplierId?.toString() === filters.supplierId;
    const matchesStockStatus = !filters.stockStatus ||
      (filters.stockStatus === 'low' && item.quantity <= item.product.minStock) ||
      (filters.stockStatus === 'inStock' && item.quantity > item.product.minStock);

    return matchesSearch && matchesType && matchesStore && matchesSupplier && matchesStockStatus;
  });

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    const actualValue = value === 'all' ? '' : value;
    setFilters(prev => ({ ...prev, [key]: actualValue }));
  };

  const clearFilters = () => {
    setFilters({
      inventoryType: '',
      storeId: '',
      supplierId: '',
      stockStatus: '',
    });
    setSearch('');
    filterForm.reset({
      inventoryType: 'all',
      storeId: 'all',
      supplierId: 'all',
      stockStatus: 'all',
    });
  };

  const isPending = createInventoryMutation.isPending || updateInventoryMutation.isPending;
  const filterForm = useForm({
    defaultValues: {
      inventoryType: 'all',
      storeId: 'all',
      supplierId: 'all',
      stockStatus: 'all',
    },
  });


  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Inventory Management</h1>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setSelectedItem(null);
                form.reset();
                setShowQuickAddProduct(false);
                setShowQuickAddSupplier(false);
              }
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Inventory
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {selectedItem ? 'Edit Inventory Item' : 'Add Inventory Item'}
                  </DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="inventoryType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Inventory Type</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select inventory type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="DC">Distribution Center</SelectItem>
                              <SelectItem value="STORE">Store</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="productId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Product</FormLabel>
                          <div className="space-y-4">
                            <div className="flex items-center gap-2">
                              <Select
                                value={field.value}
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select a product" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {products?.map((product) => (
                                    <SelectItem key={product.id} value={product.id.toString()}>
                                      {product.name} ({product.sku})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => setShowQuickAddProduct(!showQuickAddProduct)}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>

                            <Collapsible open={showQuickAddProduct} onOpenChange={setShowQuickAddProduct}>
                              <CollapsibleContent>
                                <div className="space-y-4 border rounded-md p-4">
                                  <h4 className="font-medium">Quick Add Product</h4>
                                  <FormProvider {...productForm}>
                                    <form onSubmit={productForm.handleSubmit(onSubmitProduct)} className="space-y-4">
                                      <FormField
                                        control={productForm.control}
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
                                        control={productForm.control}
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
                                        control={productForm.control}
                                        name="price"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Price</FormLabel>
                                            <FormControl>
                                              <Input type="number" min="0" step="0.01" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />

                                      <FormField
                                        control={productForm.control}
                                        name="categoryId"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Category</FormLabel>
                                            <Select
                                              value={field.value}
                                              onValueChange={field.onChange}
                                            >
                                              <FormControl>
                                                <SelectTrigger>
                                                  <SelectValue placeholder="Select a category" />
                                                </SelectTrigger>
                                              </FormControl>
                                              <SelectContent>
                                                {categories?.map((category) => (
                                                  <SelectItem key={category.id} value={category.id.toString()}>
                                                    {category.name}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />

                                      <FormField
                                        control={productForm.control}
                                        name="minStock"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Minimum Stock</FormLabel>
                                            <FormControl>
                                              <Input type="number" min="0" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />

                                      <Button
                                        type="submit"
                                        className="w-full"
                                        disabled={createProductMutation.isPending}
                                      >
                                        {createProductMutation.isPending && (
                                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        )}
                                        Create Product
                                      </Button>
                                    </form>
                                  </FormProvider>
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          </div>
                        </FormItem>
                      )}
                    />

                    {form.watch('inventoryType') === 'STORE' && (
                      <FormField
                        control={form.control}
                        name="storeId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Store</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select a store" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {stores?.map((store) => (
                                  <SelectItem key={store.id} value={store.id.toString()}>
                                    {store.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    <FormField
                      control={form.control}
                      name="supplierId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Supplier</FormLabel>
                          <div className="space-y-4">
                            <div className="flex items-center gap-2">
                              <Select
                                value={field.value}
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select a supplier" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {suppliers?.map((supplier) => (
                                    <SelectItem key={supplier.id} value={supplier.id.toString()}>
                                      {supplier.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => setShowQuickAddSupplier(!showQuickAddSupplier)}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>

                            <Collapsible open={showQuickAddSupplier} onOpenChange={setShowQuickAddSupplier}>
                              <CollapsibleContent>
                                <div className="space-y-4 border rounded-md p-4">
                                  <h4 className="font-medium">Quick Add Supplier</h4>
                                  <FormProvider {...supplierForm}>
                                    <form onSubmit={supplierForm.handleSubmit(onSubmitSupplier)} className="space-y-4">
                                      <FormField
                                        control={supplierForm.control}
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
                                        control={supplierForm.control}
                                        name="contactInfo"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Contact Information</FormLabel>
                                            <FormControl>
                                              <Input {...field} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />

                                      <FormField
                                        control={supplierForm.control}
                                        name="address"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Address</FormLabel>
                                            <FormControl>
                                              <Input {...field} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />

                                      <Button
                                        type="submit"
                                        className="w-full"
                                        disabled={createSupplierMutation.isPending}
                                      >
                                        {createSupplierMutation.isPending && (
                                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        )}
                                        Create Supplier
                                      </Button>
                                    </form>
                                  </FormProvider>
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          </div>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="quantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Quantity</FormLabel>
                          <FormControl>
                            <Input type="number" min="0" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="location"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Location</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isPending}
                    >
                      {isPending && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {selectedItem ? 'Update' : 'Create'} Inventory Item
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inventory List</CardTitle>
          <div className="space-y-4">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="filters">
                <AccordionTrigger>
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4" />
                    Advanced Filters
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <FormProvider {...filterForm}>
                    <form className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-4">
                        <FormField
                          control={filterForm.control}
                          name="inventoryType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Inventory Type</FormLabel>
                              <Select
                                value={field.value}
                                onValueChange={(value) => {
                                  field.onChange(value);
                                  handleFilterChange('inventoryType', value);
                                }}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="All Types" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="all">All Types</SelectItem>
                                  <SelectItem value="DC">Distribution Center</SelectItem>
                                  <SelectItem value="STORE">Store</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={filterForm.control}
                          name="storeId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Store</FormLabel>
                              <Select
                                value={field.value}
                                onValueChange={(value) => {
                                  field.onChange(value);
                                  handleFilterChange('storeId', value);
                                }}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="All Stores" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="all">All Stores</SelectItem>
                                  {stores?.map((store) => (
                                    <SelectItem key={store.id} value={store.id.toString()}>
                                      {store.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={filterForm.control}
                          name="supplierId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Supplier</FormLabel>
                              <Select
                                value={field.value}
                                onValueChange={(value) => {
                                  field.onChange(value);
                                  handleFilterChange('supplierId', value);
                                }}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="All Suppliers" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="all">All Suppliers</SelectItem>
                                  {suppliers?.map((supplier) => (
                                    <SelectItem key={supplier.id} value={supplier.id.toString()}>
                                      {supplier.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={filterForm.control}
                          name="stockStatus"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Stock Status</FormLabel>
                              <Select
                                value={field.value}
                                onValueChange={(value) => {
                                  field.onChange(value);
                                  handleFilterChange('stockStatus', value);
                                }}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="All Status" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="all">All Status</SelectItem>
                                  <SelectItem value="low">Low Stock</SelectItem>
                                  <SelectItem value="inStock">In Stock</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="flex justify-end px-4 pt-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            clearFilters();
                            filterForm.reset({
                              inventoryType: 'all',
                              storeId: 'all',
                              supplierId: 'all',
                              stockStatus: 'all',
                            });
                          }}
                          className="flex items-center gap-2"
                        >
                          <RefreshCw className="h-4 w-4" />
                          Clear Filters
                        </Button>
                      </div>
                    </form>
                  </FormProvider>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search inventory..."
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
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
                  <TableHead>Type</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Quantity</TableHead>
                  {(canUpdate || canDelete) && <TableHead>Actions</TableHead>}
                  <TableHead>Barcode</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInventory?.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.inventoryType === 'DC' ? 'Distribution Center' : 'Store'}</TableCell>
                    <TableCell>{item.product.name}</TableCell>
                    <TableCell>{item.location || '-'}</TableCell>
                    <TableCell>{item.store?.name || '-'}</TableCell>
                    <TableCell>{item.supplier?.name || '-'}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    {(canUpdate || canDelete) && (
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {canUpdate && (
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => handleEdit(item)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => handleDelete(item.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                    <TableCell>
                      <Barcode value={item.barcode} />
                    </TableCell>
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

export default InventoryPage;