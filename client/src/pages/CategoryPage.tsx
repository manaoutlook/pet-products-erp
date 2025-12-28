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
import { Loader2, Search, Plus, Pencil, Trash2, AlertCircle, Eye } from "lucide-react";
import { z } from "zod";
import { usePermissions } from "@/hooks/use-permissions";

// Category schema for form validation
const categorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

type CategoryFormData = z.infer<typeof categorySchema>;

interface Category {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

function CategoryPage() {
  const [search, setSearch] = useState("");
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [viewingCategory, setViewingCategory] = useState<Category | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const { toast } = useToast();
  const { hasPermission } = usePermissions();

  // View Category Dialog Component
  function ViewCategoryDialog({
    category,
    open,
    onOpenChange
  }: {
    category: Category | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) {
    if (!category) return null;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Category Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">Name</label>
                <p className="mt-1 text-sm text-gray-900">{category.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Description</label>
                <p className="mt-1 text-sm text-gray-900">{category.description || 'Not specified'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Created At</label>
                <p className="mt-1 text-sm text-gray-900">{new Date(category.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Updated At</label>
                <p className="mt-1 text-sm text-gray-900">{new Date(category.updatedAt).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const { data: categories, isLoading, refetch } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
    enabled: hasPermission('masterData', 'read'),
  });

  const createMutation = useMutation({
    mutationFn: async (data: CategoryFormData) => {
      if (!hasPermission('masterData', 'create')) {
        throw new Error("You don't have permission to create categories");
      }
      const res = await fetch('/api/categories', {
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
      toast({ title: "Success", description: "Category created successfully" });
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
    mutationFn: async ({ id, data }: { id: number; data: CategoryFormData }) => {
      if (!hasPermission('masterData', 'update')) {
        throw new Error("You don't have permission to update categories");
      }
      const res = await fetch(`/api/categories/${id}`, {
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
      toast({ title: "Success", description: "Category updated successfully" });
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
      if (!hasPermission('masterData', 'delete')) {
        throw new Error("You don't have permission to delete categories");
      }
      const res = await fetch(`/api/categories/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Success", description: "Category deleted successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const form = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const filteredCategories = categories?.filter(category =>
    category.name.toLowerCase().includes(search.toLowerCase()) ||
    (category.description?.toLowerCase() || "").includes(search.toLowerCase())
  );

  const onSubmit = async (data: CategoryFormData) => {
    try {
      if (editingCategory) {
        await updateMutation.mutateAsync({
          id: editingCategory.id,
          data: data
        });
      } else {
        await createMutation.mutateAsync(data);
      }

      form.reset();
      // Close dialog using our standard implementation
      const dialogCloseButton = document.querySelector('[data-state="open"] button[type="button"]');
      if (dialogCloseButton instanceof HTMLElement) {
        dialogCloseButton.click();
      }
    } catch (error) {
      // Error is handled by the mutation
    }
  };

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
              You don't have permission to view categories.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Categories</h1>
        {hasPermission('masterData', 'create') && (
          <Dialog>
            <DialogTrigger asChild>
              <Button onClick={() => {
                setEditingCategory(null);
                form.reset();
              }}>
                <Plus className="mr-2 h-4 w-4" />
                Add Category
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingCategory ? 'Edit Category' : 'Add New Category'}</DialogTitle>
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
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={form.formState.isSubmitting}
                  >
                    {form.formState.isSubmitting && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {editingCategory ? 'Update Category' : 'Create Category'}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Category List</CardTitle>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search categories..."
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
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Updated At</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCategories?.map((category: any) => (
                  <TableRow key={category.id}>
                    <TableCell>{category.name}</TableCell>
                    <TableCell>{category.description}</TableCell>
                    <TableCell>{new Date(category.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{new Date(category.updatedAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            setViewingCategory(category);
                            setIsViewDialogOpen(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {hasPermission('masterData', 'update') && (
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => {
                                  setEditingCategory(category);
                                  form.reset({
                                    name: category.name,
                                    description: category.description || "",
                                  });
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Edit Category</DialogTitle>
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
                                  <Button
                                    type="submit"
                                    className="w-full"
                                    disabled={form.formState.isSubmitting}
                                  >
                                    {form.formState.isSubmitting && (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    )}
                                    Update Category
                                  </Button>
                                </form>
                              </Form>
                            </DialogContent>
                          </Dialog>
                        )}
                        {hasPermission('masterData', 'delete') && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="text-destructive"
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this category?')) {
                                deleteMutation.mutate(category.id);
                              }
                            }}
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

      <ViewCategoryDialog
        category={viewingCategory}
        open={isViewDialogOpen}
        onOpenChange={(open) => {
          setIsViewDialogOpen(open);
          if (!open) setViewingCategory(null);
        }}
      />
    </div>
  );
}

export default CategoryPage;
