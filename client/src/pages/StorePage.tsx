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
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { ColumnHeader, TableControlsBar } from "@/components/ui/table-controls";
import { useTableControls } from "@/hooks/use-table-controls";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { SelectStore } from "@db/schema";
import { insertStoreSchema } from "@db/schema";
import { z } from "zod";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { readApiError } from "@/lib/apiError";
import { Loader2, Plus, Pencil, Trash2, Warehouse, Store, AlertCircle } from "lucide-react";

// AI Agent Note: The base insert schema allows regionId to be null, which is
// exactly how stores ended up with NULL region_id. The form requires a region
// so every store is tied to a region for hierarchical access control.
const storeFormSchema = insertStoreSchema.extend({
  regionId: z
    .number({ required_error: "Please select a region", invalid_type_error: "Please select a region" })
    .int("Please select a region")
    .positive("Please select a region"),
});

type StoreFormValues = z.infer<typeof storeFormSchema>;

interface RegionOption {
  id: number;
  name: string;
}

function StorePage() {
  const [search, setSearch] = useState("");
  const [editingStore, setEditingStore] = useState<SelectStore | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();
  const { hasPermission } = usePermissions();

  const { data: stores, isLoading, refetch } = useQuery<SelectStore[]>({
    queryKey: ['/api/stores'],
    queryFn: async () => {
      const response = await fetch('/api/stores', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json();
    }
  });

  const { data: regions } = useQuery<RegionOption[]>({
    queryKey: ['/api/regions'],
    queryFn: async () => {
      const response = await fetch('/api/regions', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json();
    }
  });

  const form = useForm<StoreFormValues>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: {
      name: "",
      type: "RETAIL", // AI Agent Note: Default type is RETAIL for standard stores.
      regionId: undefined,
      location: "",
      contactInfo: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: StoreFormValues) => {
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await readApiError(res));
      return res.json();
    },
    onSuccess: () => {
      refetch();
      setDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Store created successfully", variant: "success" });
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
    mutationFn: async ({ id, data }: { id: number; data: StoreFormValues }) => {
      const res = await fetch(`/api/stores/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await readApiError(res));
      return res.json();
    },
    onSuccess: () => {
      refetch();
      setDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Store updated successfully", variant: "success" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/stores/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await readApiError(res));
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Success", description: "Store deleted successfully", variant: "success" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const onSubmit = async (data: StoreFormValues) => {
    try {
      if (editingStore) {
        await updateMutation.mutateAsync({
          id: editingStore.id,
          data
        });
      } else {
        await createMutation.mutateAsync(data);
      }
    } catch (error) {
      // Error is handled by the mutation
    }
  };

  const handleAddStore = () => {
    setEditingStore(null);
    form.reset({
      name: "",
      type: "RETAIL",
      regionId: undefined,
      location: "",
      contactInfo: "",
    });
    setDialogOpen(true);
  };

  const handleEditStore = (store: SelectStore) => {
    setEditingStore(store);
    form.reset({
      name: store.name,
      type: store.type as "RETAIL" | "WAREHOUSE",
      regionId: store.regionId ?? undefined,
      location: store.location,
      contactInfo: store.contactInfo,
    });
    setDialogOpen(true);
  };

  const handleDeleteStore = async (store: SelectStore) => {
    if (confirm('Are you sure you want to delete this store?')) {
      try {
        await deleteMutation.mutateAsync(store.id);
      } catch (error) {
        // Error is handled by the mutation
      }
    }
  };

  // Header controls: click a column header to sort it (asc -> desc -> none) and
  // use the small input under a header to filter that single column.
  const storesTable = useTableControls(
    stores,
    {
      name: (store) => store.name,
      type: (store) => (store.type === 'WAREHOUSE' ? 'Warehouse / DC' : 'Retail Store'),
      region: (store) => regions?.find((region) => region.id === store.regionId)?.name,
      location: (store) => store.location,
      contactInfo: (store) => store.contactInfo,
    },
    {
      // The page level search box stays the primary, whole row search.
      filter: (store) =>
        store.name.toLowerCase().includes(search.toLowerCase()) ||
        store.location.toLowerCase().includes(search.toLowerCase()) ||
        store.contactInfo.toLowerCase().includes(search.toLowerCase()),
    }
  );

  // Rows currently visible (search + column filters + sorting).
  const filteredStores: SelectStore[] = storesTable.rows;

  // If user doesn't have read permission, show access denied
  if (!hasPermission('stores', 'read')) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              You don't have permission to view stores.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Stores</h1>
        {hasPermission('stores', 'create') && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="create" onClick={handleAddStore}>
              <Plus className="mr-2 h-4 w-4" />
              Add Store
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingStore ? 'Edit Store' : 'Add New Store'}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Store Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Enter store name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select store type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="RETAIL">Retail Store</SelectItem>
                          <SelectItem value="WAREHOUSE">Warehouse (Distribution Center)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="regionId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Region</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(Number(value))}
                        value={field.value != null ? String(field.value) : undefined}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a region" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {regions?.map((region) => (
                            <SelectItem key={region.id} value={String(region.id)}>
                              {region.name}
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
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Enter store location"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contactInfo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Information</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Enter contact information"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button variant={editingStore ? 'update' : 'create'}
                  type="submit"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {editingStore ? 'Update Store' : 'Create Store'}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Store List</CardTitle>
          <div className="flex items-center gap-4">
            <SearchInput
              containerClassName="flex-1 max-w-sm"
              placeholder="Search stores..."
              value={search}
              onValueChange={setSearch}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
            <TableControlsBar controls={storesTable} noun="stores" />
            <Table className="table-actions-sticky min-w-[1000px]">
              <TableHeader>
                <TableRow>
                  <ColumnHeader controls={storesTable} columnKey="name" label="Store Name" filterPlaceholder="Filter store" />
                  <ColumnHeader controls={storesTable} columnKey="type" label="Type" filterPlaceholder="Filter type" />
                  <ColumnHeader controls={storesTable} columnKey="region" label="Region" filterPlaceholder="Filter region" />
                  <ColumnHeader controls={storesTable} columnKey="location" label="Location" filterPlaceholder="Filter location" />
                  <ColumnHeader controls={storesTable} columnKey="contactInfo" label="Contact Information" filterPlaceholder="Filter contact" />
                  <TableHead className="align-top">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStores?.map((store: SelectStore) => (
                  <TableRow key={store.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {store.type === 'WAREHOUSE' ? <Warehouse className="h-4 w-4 text-blue-500" /> : <Store className="h-4 w-4 text-green-500" />}
                        {store.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      {store.type === 'WAREHOUSE' ? 'Warehouse / DC' : 'Retail Store'}
                    </TableCell>
                    <TableCell>
                      {regions?.find((region) => region.id === store.regionId)?.name ?? '—'}
                    </TableCell>
                    <TableCell>{store.location}</TableCell>
                    <TableCell>{store.contactInfo}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {hasPermission('stores', 'update') && (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleEditStore(store)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {hasPermission('stores', 'delete') && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="text-destructive"
                            onClick={() => handleDeleteStore(store)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default StorePage;