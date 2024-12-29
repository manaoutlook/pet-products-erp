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
import { Loader2, Plus, Search, Pencil, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Barcode } from "@/components/ui/barcode";
import { usePermissions } from "@/hooks/use-permissions";

const inventorySchema = z.object({
  productId: z.string().min(1, "Product is required"),
  storeId: z.string().optional(),
  quantity: z.string().min(1, "Quantity is required"),
  location: z.string().optional(),
  inventoryType: z.enum(["DC", "STORE"], { required_error: "Inventory type is required" }),
});

type InventoryFormValues = z.infer<typeof inventorySchema>;

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

interface InventoryItem {
  id: number;
  productId: number;
  storeId: number | null;
  quantity: number;
  location: string | null;
  inventoryType: 'DC' | 'STORE';
  centerId: string | null;
  barcode: string;
  product: Product;
  store: Store | null;
}

function InventoryPage() {
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();
  const { hasPermission } = usePermissions();

  const canCreate = hasPermission('inventory', 'create');
  const canUpdate = hasPermission('inventory', 'update');
  const canDelete = hasPermission('inventory', 'delete');

  const form = useForm<InventoryFormValues>({
    resolver: zodResolver(inventorySchema),
    defaultValues: {
      productId: '',
      storeId: '',
      quantity: '',
      location: '',
      inventoryType: 'STORE',
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

  const filteredInventory = inventory?.filter(item =>
    item.product.name.toLowerCase().includes(search.toLowerCase()) ||
    item.product.sku.toLowerCase().includes(search.toLowerCase()) ||
    item.location?.toLowerCase().includes(search.toLowerCase()) ||
    item.store?.name.toLowerCase().includes(search.toLowerCase())
  );

  const isPending = createInventoryMutation.isPending || updateInventoryMutation.isPending;

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Inventory Management</h1>
        {canCreate && (
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setSelectedItem(null);
              form.reset();
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
                        <FormMessage />
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

      <Card>
        <CardHeader>
          <CardTitle>Inventory List</CardTitle>
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
                  <TableHead>Quantity</TableHead>
                  <TableHead>Status</TableHead>
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
                    <TableCell>{item.store?.name || (item.inventoryType === 'DC' ? 'DC001' : '-')}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>
                      <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        item.quantity <= item.product.minStock
                          ? 'bg-red-100 text-red-800'
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {item.quantity <= item.product.minStock ? 'Low Stock' : 'In Stock'}
                      </div>
                    </TableCell>
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
                              className="text-destructive"
                              onClick={() => handleDelete(item.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                    <TableCell className="min-w-[200px]">
                      {item.barcode && <Barcode value={item.barcode} height={50} fontSize={12} margin={5} />}
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