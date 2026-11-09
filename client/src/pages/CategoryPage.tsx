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
import { SearchInput } from "@/components/ui/search-input";
import { ColumnHeader, TableControlsBar } from "@/components/ui/table-controls";
import { useTableControls } from "@/hooks/use-table-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2, AlertCircle, Eye, Download, Upload } from "lucide-react";
import { z } from "zod";
import { usePermissions } from "@/hooks/use-permissions";
import { MasterDataImportDialog } from "@/components/master-data/MasterDataImportDialog";
import {
  MasterDataBulkDeleteDialog,
  MasterDataBulkDeleteToolbar,
  useMasterDataBulkDelete,
} from "@/components/master-data/MasterDataBulkDelete";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportMasterData, type SpreadsheetFormat } from "@/utils/master-data-spreadsheet";
import { formatDateTime } from "@/utils/format";

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
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const canDeleteCategories = hasPermission('masterData', 'delete');

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
                <label className="text-sm font-medium text-muted-foreground">Name</label>
                <p className="mt-1 text-sm text-foreground">{category.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Description</label>
                <p className="mt-1 text-sm text-foreground">{category.description || 'Not specified'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Created At</label>
                <p className="mt-1 text-sm text-foreground">{formatDateTime(category.createdAt)}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Updated At</label>
                <p className="mt-1 text-sm text-foreground">{formatDateTime(category.updatedAt)}</p>
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
      toast({ title: "Success", description: "Category created successfully", variant: "success" });
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
      toast({ title: "Success", description: "Category updated successfully", variant: "success" });
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
      toast({ title: "Success", description: "Category deleted successfully", variant: "success" });
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

  // Header controls: click a column header to sort it (asc -> desc -> none) and
  // use the small input under a header to filter that single column.
  const categoriesTable = useTableControls(
    categories,
    {
      name: (category) => category.name,
      description: (category) => category.description,
      parent: (category) =>
        category.parentId ? categoryMap?.[category.parentId] || "Parent Category" : "Root category",
      createdAt: (category) => new Date(category.createdAt),
      updatedAt: (category) => new Date(category.updatedAt),
    },
    {
      // The page level search box stays the primary, whole row search.
      filter: (category) =>
        !normalizedSearch ||
        normalizeSearchText(category.name).includes(normalizedSearch) ||
        normalizeSearchText(category.description).includes(normalizedSearch),
    }
  );

  // Rows currently visible (search + column filters + sorting).
  const filteredCategories = categoriesTable.rows;

  // Checkbox multi-select for the bulk delete action. Only ids of the rows that
  // are currently shown are ever selected, so a hidden search result cannot be
  // deleted by accident.
  const bulkDelete = useMasterDataBulkDelete({
    endpoint: '/api/categories',
    singular: 'category',
    plural: 'categories',
    onDeleted: () => refetch(),
  });

  const visibleCategoryIds = (filteredCategories ?? []).map((category) => category.id);
  const visibleSelection = bulkDelete.selectionState(visibleCategoryIds);

  // Export the rows currently shown (the search filter is respected) to an
  // .xlsx or .csv file. SheetJS is loaded lazily by the export helper.
  const handleExport = async (format: SpreadsheetFormat) => {
    const rows = filteredCategories ?? [];

    if (rows.length === 0) {
      toast({
        title: "Nothing to export",
        description: "No categories match the current search.",
        variant: "destructive",
      });
      return;
    }

    // The list only carries parentId, so the parent column is resolved from the
    // (unfiltered) category list - a parent hidden by the search still exports.
    setIsExporting(true);
    try {
      const fileName = await exportMasterData("categories", rows, format, {
        categoryNames: categoryMap,
      });
      toast({
        title: "Export ready",
        description: `${fileName} · ${rows.length} ${rows.length === 1 ? "category" : "categories"}`,
        variant: "success",
      });
    } catch {
      toast({
        title: "Export failed",
        description: "The export file could not be created.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

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
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
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
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setIsImportDialogOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
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
                <Button variant="create">
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
                    <Button variant={editingCategory ? 'update' : 'create'}
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
          </div>
        )}
      </div>

      {/* CSV / Excel import - opened from the Import button above */}
      <MasterDataImportDialog
        kind="categories"
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        onImported={() => refetch()}
      />

      <Card>
        <CardHeader>
          <CardTitle>Category List</CardTitle>
          <div className="flex items-center gap-4">
            <SearchInput
              containerClassName="flex-1 max-w-sm"
              placeholder="Search categories..."
              value={search}
              onValueChange={setSearch}
            />
            {hasPermission('masterData', 'read') && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={isExporting}>
                    {isExporting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => handleExport("xlsx")}>
                    Excel (.xlsx)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleExport("csv")}>
                    CSV (.csv)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {canDeleteCategories && (
            <MasterDataBulkDeleteToolbar
              count={bulkDelete.selectedCount}
              plural="categories"
              onClear={bulkDelete.clearSelection}
              onRequestDelete={() => bulkDelete.setIsDeleteDialogOpen(true)}
              isPending={bulkDelete.isPending}
            />
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
            <TableControlsBar controls={categoriesTable} noun="categories" />
            <Table className="table-actions-sticky min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  {canDeleteCategories && (
                    <TableHead className="w-10 align-top">
                      <Checkbox
                        aria-label="Select all categories"
                        checked={
                          visibleSelection.allSelected
                            ? true
                            : visibleSelection.someSelected
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={() => bulkDelete.toggleSelectAll(visibleCategoryIds)}
                        disabled={visibleCategoryIds.length === 0}
                      />
                    </TableHead>
                  )}
                  <ColumnHeader controls={categoriesTable} columnKey="name" label="Name" filterPlaceholder="Filter name" />
                  <ColumnHeader controls={categoriesTable} columnKey="description" label="Description" filterPlaceholder="Filter description" />
                  <ColumnHeader controls={categoriesTable} columnKey="parent" label="Parent Category" filterPlaceholder="Filter parent" />
                  <ColumnHeader controls={categoriesTable} columnKey="createdAt" label="Created At" filterPlaceholder="Filter created" />
                  <ColumnHeader controls={categoriesTable} columnKey="updatedAt" label="Updated At" filterPlaceholder="Filter updated" />
                  <TableHead className="align-top">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCategories?.map((category: any) => (
                  <TableRow
                    key={category.id}
                    data-state={bulkDelete.isSelected(category.id) ? "selected" : undefined}
                  >
                    {canDeleteCategories && (
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${category.name}`}
                          checked={bulkDelete.isSelected(category.id)}
                          onCheckedChange={() => bulkDelete.toggleSelection(category.id)}
                        />
                      </TableCell>
                    )}
                    <TableCell>{category.name}</TableCell>
                    <TableCell>{category.description}</TableCell>
                    <TableCell>{category.parentId ? categoryMap?.[category.parentId] || 'Parent Category' : 'Root category'}</TableCell>
                    <TableCell>{formatDateTime(category.createdAt)}</TableCell>
                    <TableCell>{formatDateTime(category.updatedAt)}</TableCell>
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
                                  <Button variant="update"
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
            </>
          )}
        </CardContent>
      </Card>

      <MasterDataBulkDeleteDialog
        open={bulkDelete.isDeleteDialogOpen}
        onOpenChange={bulkDelete.setIsDeleteDialogOpen}
        count={bulkDelete.selectedCount}
        singular="category"
        plural="categories"
        isPending={bulkDelete.isPending}
        onConfirm={bulkDelete.confirmDelete}
      />

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
