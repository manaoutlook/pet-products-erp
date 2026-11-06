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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  parentId: z.string().optional(),
});

type CategoryFormData = z.infer<typeof categorySchema>;

// Blank values for the "Add Category" form. Kept as a constant so every reset
// goes back to a truly empty form.
const emptyCategoryForm: CategoryFormData = {
  name: "",
  description: "",
  parentId: "",
};

// AI Agent Note: Category names are sometimes copy-pasted from documents/PDFs and
// end up with Unicode whitespace variants (U+00A0, U+202F narrow no-break space, ...)
// instead of a regular space. Collapse every whitespace variant into a single plain
// space so "Smart G" still matches "Smart\u202FGadgets".
function normalizeSearchText(value: string | null | undefined): string {
  return (value || "")
    .replace(/[\s\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u3000]+/g, " ")
    .trim()
    .toLowerCase();
}

// API errors are returned as JSON ({ code, message, ... }), but some endpoints
// still reply with plain text, so read both shapes and surface a readable message.
async function getResponseErrorMessage(res: Response, fallback: string): Promise<string> {
  let raw = "";
  try {
    raw = await res.text();
  } catch {
    return fallback;
  }

  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
    return fallback;
  } catch {
    return raw;
  }
}

interface Category {
  id: number;
  name: string;
  description: string | null;
  parentId: number | null;
  createdAt: string;
  updatedAt: string;
}

function CategoryPage() {
  const [search, setSearch] = useState("");
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [viewingCategory, setViewingCategory] = useState<Category | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

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

  const categoryMap = categories?.reduce((map, category) => {
    map[category.id] = category.name;
    return map;
  }, {} as Record<number, string>);

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
      if (!res.ok) throw new Error(await getResponseErrorMessage(res, "Failed to create category"));
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
      if (!res.ok) throw new Error(await getResponseErrorMessage(res, "Failed to update category"));
      return res.json();
    },
    onSuccess: (response: { message?: string; category?: Category }) => {
      // Keep the cached list in sync with the saved record so the table (and the
      // Parent Category column) reflects the change immediately
      const updatedCategory = response?.category;
      if (updatedCategory) {
        queryClient.setQueryData<Category[]>(['/api/categories'], (previous) =>
          previous?.map((category) =>
            category.id === updatedCategory.id ? { ...category, ...updatedCategory } : category
          )
        );
      }
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
      if (!res.ok) throw new Error(await getResponseErrorMessage(res, "Failed to delete category"));
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Success", description: "Category deleted successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Cannot Delete Category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const form = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
    defaultValues: { ...emptyCategoryForm },
  });

  const normalizedSearch = normalizeSearchText(search);

  const filteredCategories = categories?.filter((category) => {
    if (!normalizedSearch) return true;

    return (
      normalizeSearchText(category.name).includes(normalizedSearch) ||
      normalizeSearchText(category.description).includes(normalizedSearch)
    );
  });

  const onSubmit = async (data: CategoryFormData) => {
    try {
      if (editingCategory) {
        await updateMutation.mutateAsync({
          id: editingCategory.id,
          data: data
        });

        // Sync the form with the values that were just saved (instead of the stale
        // `editingCategory` snapshot), otherwise the fields - the Parent Category
        // dropdown in particular - fall back to the old values in the UI.
        // keepDefaultValues stops these values becoming the form defaults, which
        // would leak into the next "Add Category" dialog.
        form.reset(
          {
            name: data.name,
            description: data.description || "",
            parentId: data.parentId || "",
          },
          { keepDefaultValues: true }
        );

        // Close the edit dialog through its controlled state
        setEditingCategory(null);
        setIsEditDialogOpen(false);
      } else {
        await createMutation.mutateAsync(data);
        // Clear the fields and close the dialog through its controlled state so the
        // next "Add Category" always starts from a blank form
        form.reset(emptyCategoryForm);
        setIsCreateDialogOpen(false);
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
          <Dialog
            open={isCreateDialogOpen}
            onOpenChange={(open) => {
              setIsCreateDialogOpen(open);
              if (open) {
                // Always start the Add dialog from a blank form
                setEditingCategory(null);
                form.reset(emptyCategoryForm);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Category
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Category</DialogTitle>
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
                    name="parentId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Parent Category</FormLabel>
                        <Select
                          onValueChange={(value) =>
                            field.onChange(value === "root" ? "" : value)
                          }
                          value={field.value || "root"}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select parent category" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="root">No parent (Root category)</SelectItem>
                            {isLoading ? (
                              <div className="h-20 w-full flex items-center justify-center">
                                <Loader2 className="h-4 w-4 animate-spin" />
                              </div>
                            ) : categories?.map((category) => (
                              <SelectItem
                                key={category.id}
                                value={category.id.toString()}
                              >
                                {category.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                  <TableHead>Parent Category</TableHead>
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
                    <TableCell>{category.parentId ? categoryMap?.[category.parentId] || 'Parent Category' : 'Root category'}</TableCell>
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
                          <Dialog
                            open={isEditDialogOpen && editingCategory?.id === category.id}
                            onOpenChange={(open) => {
                              setIsEditDialogOpen(open);
                              if (!open) setEditingCategory(null);
                            }}
                          >
                            <DialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => {
                                  setEditingCategory(category);
                                  // keepDefaultValues keeps the Add form defaults blank
                                  form.reset(
                                    {
                                      name: category.name,
                                      description: category.description || "",
                                      parentId: category.parentId?.toString() || "",
                                    },
                                    { keepDefaultValues: true }
                                  );
                                  setIsEditDialogOpen(true);
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
                                  <FormField
                                    control={form.control}
                                    name="parentId"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>Parent Category</FormLabel>
                                        <Select
                                          onValueChange={(value) =>
                                            field.onChange(value === "root" ? "" : value)
                                          }
                                          value={field.value || "root"}
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder="Select parent category" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="root">No parent (Root category)</SelectItem>
                                            {isLoading ? (
                                              <div className="h-20 w-full flex items-center justify-center">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                              </div>
                                            ) : categories?.map((category) => (
                                              <SelectItem
                                                key={category.id}
                                                value={category.id.toString()}
                                              >
                                                {category.name}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
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
