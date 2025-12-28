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
import type { InsertBrand, SelectBrand } from "@db/schema";
import { insertBrandSchema } from "@db/schema";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { Loader2, Search, Plus, Pencil, Trash2, AlertCircle, Eye } from "lucide-react";

function BrandsPage() {
  const [search, setSearch] = useState("");
  const [editingBrand, setEditingBrand] = useState<SelectBrand | null>(null);
  const [viewingBrand, setViewingBrand] = useState<SelectBrand | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const { toast } = useToast();
  const { hasPermission } = usePermissions();

  // View Brand Dialog Component
  function ViewBrandDialog({
    brand,
    open,
    onOpenChange
  }: {
    brand: SelectBrand | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) {
    if (!brand) return null;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Brand Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500">Brand Name</label>
              <p className="mt-1 text-sm text-gray-900">{brand.name}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Description</label>
              <p className="mt-1 text-sm text-gray-900">{brand.description || 'Not specified'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Created At</label>
              <p className="mt-1 text-sm text-gray-900">{new Date(brand.createdAt!).toLocaleString()}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Updated At</label>
              <p className="mt-1 text-sm text-gray-900">{new Date(brand.updatedAt!).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </Dialog>
    );
  }

  const { data: brands, isLoading, refetch } = useQuery<SelectBrand[]>({
    queryKey: ['/api/brands'],
    enabled: hasPermission('masterData', 'read'),
  });

  const form = useForm<InsertBrand>({
    resolver: zodResolver(insertBrandSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertBrand) => {
      const res = await fetch('/api/brands', {
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
      setDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Brand created successfully" });
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
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertBrand> }) => {
      const res = await fetch(`/api/brands/${id}`, {
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
      setDialogOpen(false);
      setEditingBrand(null);
      toast({ title: "Success", description: "Brand updated successfully" });
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
      const res = await fetch(`/api/brands/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Success", description: "Brand deleted successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const onSubmit = async (data: InsertBrand) => {
    try {
      if (editingBrand) {
        await updateMutation.mutateAsync({
          id: editingBrand.id,
          data: data
        });
      } else {
        await createMutation.mutateAsync(data);
      }
      form.reset();
    } catch (error) {
      // Error is handled by the mutation
    }
  };

  const handleAddBrand = () => {
    setEditingBrand(null);
    form.reset({
      name: "",
      description: "",
    });
    setDialogOpen(true);
  };

  const handleEditBrand = (brand: SelectBrand) => {
    setEditingBrand(brand);
    form.reset({
      name: brand.name,
      description: brand.description || "",
    });
    setDialogOpen(true);
  };

  const handleDeleteBrand = async (id: number) => {
    if (confirm('Are you sure you want to delete this brand?')) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const filteredBrands = brands?.filter(brand =>
    brand.name.toLowerCase().includes(search.toLowerCase()) ||
    (brand.description?.toLowerCase() || "").includes(search.toLowerCase())
  );

  // If user doesn't have read permission, show access denied
  if (!hasPermission('masterData', 'read')) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <h1 className="text-2xl font-bold text-gray-900">Access Denied</h1>
            </div>
            <p className="mt-4 text-sm text-gray-600">
              You don't have permission to view brands.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Brands</h1>
        {hasPermission('masterData', 'create') && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleAddBrand}>
                <Plus className="mr-2 h-4 w-4" />
                Add Brand
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingBrand ? 'Edit Brand' : 'Add New Brand'}</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Brand Name</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Enter brand name"
                          />
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
                          <Input
                            {...field}
                            value={field.value || ""}
                            placeholder="Enter brand description"
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
                    {editingBrand ? 'Update Brand' : 'Create Brand'}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Brand List</CardTitle>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search brands..."
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
                  <TableHead>Brand Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBrands?.map((brand: SelectBrand) => (
                  <TableRow key={brand.id}>
                    <TableCell className="font-medium">{brand.name}</TableCell>
                    <TableCell>{brand.description}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            setViewingBrand(brand);
                            setIsViewDialogOpen(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {hasPermission('masterData', 'update') && (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleEditBrand(brand)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {hasPermission('masterData', 'delete') && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="text-destructive"
                            onClick={() => handleDeleteBrand(brand.id)}
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
          )}
        </CardContent>
      </Card>

      <ViewBrandDialog
        brand={viewingBrand}
        open={isViewDialogOpen}
        onOpenChange={(open) => {
          setIsViewDialogOpen(open);
          if (!open) setViewingBrand(null);
        }}
      />
    </div>
  );
}

export default BrandsPage;
