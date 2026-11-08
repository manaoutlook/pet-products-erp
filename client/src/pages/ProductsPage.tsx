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
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { ColumnHeader, TableControlsBar } from "@/components/ui/table-controls";
import { useTableControls } from "@/hooks/use-table-controls";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2, AlertCircle, Eye, Upload, Download } from "lucide-react";
import { formatPrice } from "@/utils/price";
import { exportProducts, type ExportFormat } from "@/utils/product-spreadsheet";
import { ImportProductsDialog } from "@/components/products/ImportProductsDialog";
import { RichText } from "@/components/RichText";
import { toPlainText } from "@/utils/rich-text";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePermissions } from "@/hooks/use-permissions";
import {
  ProductFormDialog,
  productSchema,
  toOptionalPrice,
  type ProductFormData,
} from "@/components/products/ProductFormDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";

// The product form schema and the shared create/edit dialog live in
// components/products/ProductFormDialog so both screens share one layout.

interface Brand {
  id: number;
  name: string;
  description: string | null;
}

// Update Product interface to include category
interface Product {
  id: number;
  name: string;
  description: string | null;
  sku: string;
  price: string | number;
  // Optional price tiers (NULL in the DB when not set)
  landingPrice?: string | number | null;
  b2bPrice?: string | number | null;
  b2cPrice?: string | number | null;
  categoryId: number;
  category: {
    id: number;
    name: string;
  };
  minStock: number;
  inventory: {
    quantity: number;
  }[];
  brandId?: number | null; // Brands are optional — API returns null when unset
  brand?: {
    id: number;
    name: string;
  }; // Add brand to Product interface
  supplierId?: number | null; // Suppliers are required for new products; legacy rows may be null
  supplier?: {
    id: number;
    name: string;
    contactInfo?: string | null;
  } | null;
  // Optional physical attributes (NULL when not set). Weight is in kilograms,
  // length/width/height in centimetres (stored as decimal strings by the API).
  weightKg?: string | number | null;
  lengthCm?: string | number | null;
  widthCm?: string | number | null;
  heightCm?: string | number | null;
}

interface Supplier {
  id: number;
  name: string;
  contactInfo: string;
  address: string;
}


interface Category {
  id: number;
  name: string;
  description: string | null;
}

// API errors are returned as JSON ({ message, suggestion, errors }), but some
// endpoints still reply with plain text. Read both shapes and surface a
// readable message instead of dumping raw JSON into the toast.
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

    if (parsed && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const details = parsed.errors
        .map((err: { field?: string; message?: string }) =>
          err?.message ? (err.field ? `${err.field}: ${err.message}` : err.message) : null
        )
        .filter(Boolean)
        .join("; ");
      if (details) return details;
    }

    if (parsed && typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.suggestion ? `${parsed.message} ${parsed.suggestion}` : parsed.message;
    }

    return fallback;
  } catch {
    return raw;
  }
}

function ProductsPage() {
  const [search, setSearch] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const { toast } = useToast();
  const { hasPermission, isAdmin } = usePermissions();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  // Multi-select state for the bulk delete action. Only ids of rows the user can
  // see are ever added, so switching the search filter never deletes surprises.
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const canDeleteProducts = hasPermission('products', 'delete') || isAdmin;


  const { data: products, isLoading, refetch } = useQuery<Product[]>({
    queryKey: ['/api/products'],
    enabled: hasPermission('products', 'read'), // Only fetch if user has read permission
  });

  const createMutation = useMutation({
    mutationFn: async (data: ProductFormData) => {
      if (!hasPermission('products', 'create')) {
        throw new Error("You don't have permission to create products");
      }
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await getResponseErrorMessage(res, "Failed to create product"));
      return res.json();
    },
    // Name the saved product in the confirmation so it is obvious which row the
    // toast refers to, and show it on the green (success) toast style.
    onSuccess: (created: Product | undefined, variables) => {
      refetch();
      const name = created?.name ?? variables.name;
      toast({
        title: "Success",
        description: `Product "${name}" created successfully`,
        variant: "success",
      });
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
      if (!hasPermission('products', 'update')) {
        throw new Error("You don't have permission to update products");
      }
      const res = await fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await getResponseErrorMessage(res, "Failed to update product"));
      return res.json();
    },
    // The API replies with the saved product, so the toast can name the product
    // that was modified (falling back to the submitted form data).
    onSuccess: (updated: Product | undefined, variables) => {
      refetch();
      const name = updated?.name ?? variables.data.name;
      toast({
        title: "Success",
        description: `Product "${name}" updated successfully`,
        variant: "success",
      });
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
      if (!hasPermission('products', 'delete')) {
        throw new Error("You don't have permission to delete products");
      }
      const res = await fetch(`/api/products/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await getResponseErrorMessage(res, "Failed to delete product"));
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({
        title: "Success",
        description: productToDelete?.name
          ? `Product "${productToDelete.name}" deleted successfully`
          : "Product deleted successfully",
        variant: "success",
      });
      setIsDeleteDialogOpen(false); // Close the dialog after successful deletion
      setProductToDelete(null); //Reset product to delete
    },
    onError: (error: Error) => {
      toast({ 
        title: "Error", 
        description: error.message,
        variant: "destructive"
      });
      setIsDeleteDialogOpen(false); // Close the dialog after failed deletion
      setProductToDelete(null); //Reset product to delete
    },
  });

  // Bulk delete used by the checkbox selection in the product list. The API
  // deletes what it can and reports the products it had to skip (e.g. ones used
  // in orders) so the toast can explain the partial result.
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      if (!hasPermission('products', 'delete') && !isAdmin) {
        throw new Error("You don't have permission to delete products");
      }
      const res = await fetch('/api/products/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await getResponseErrorMessage(res, "Failed to delete products"));
      return (await res.json()) as {
        message: string;
        deletedCount: number;
        failedCount: number;
        deleted: number[];
        failed: { id: number; name: string | null; message: string }[];
      };
    },
    onSuccess: (result) => {
      refetch();
      // Keep the ids that could not be deleted selected so the user can retry.
      const deleted = new Set(result.deleted);
      setSelectedIds((prev) => prev.filter((id) => !deleted.has(id)));
      setIsBulkDeleteDialogOpen(false);

      if (result.failedCount > 0) {
        const details = result.failed
          .slice(0, 3)
          .map((item) => `${item.name ?? `#${item.id}`}: ${item.message}`)
          .join(" · ");
        toast({
          title: result.deletedCount > 0 ? "Products deleted" : "Nothing was deleted",
          description: `${result.message}. ${details}${result.failed.length > 3 ? " …" : ""}`,
          variant: result.deletedCount > 0 ? "success" : "destructive",
        });
        return;
      }

      toast({ title: "Success", description: result.message, variant: "success" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
      setIsBulkDeleteDialogOpen(false);
    },
  });

  // Add categories query
  const { data: categories } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
    enabled: hasPermission('products', 'read'),
  });

  // Add brands query
  const { data: brands, refetch: refetchBrands } = useQuery<Brand[]>({
    queryKey: ['/api/brands'],
    enabled: hasPermission('products', 'read'),
  });

  // Suppliers power the searchable supplier dropdown of the product form
  const { data: suppliers } = useQuery<Supplier[]>({
    queryKey: ['/api/suppliers'],
    enabled: hasPermission('products', 'read'),
  });

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "",
      description: "",
      sku: "",
      landingPrice: null,
      b2bPrice: null,
      b2cPrice: null,
      categoryId: 0,
      brandId: null, // Brand is optional
      supplierId: null, // Supplier is mandatory - the user has to pick one
      minStock: 10,
      weightKg: null,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
    },
  });


  const getStockStatus = (product: Product) => {
    const quantity = product.inventory[0]?.quantity ?? 0;
    if (quantity <= 0) return { label: 'Out of Stock', class: 'bg-destructive-subtle text-destructive-subtle-foreground' };
    if (quantity <= product.minStock) return { label: 'Low Stock', class: 'bg-warning-subtle text-warning-subtle-foreground' };
    return { label: 'In Stock', class: 'bg-success-subtle text-success-subtle-foreground' };
  };

  // Header controls: clicking a column header sorts it (asc -> desc -> none) and
  // the small input under each header filters that single column.
  const productsTable = useTableControls(
    products,
    {
      name: (product) => product.name,
      sku: (product) => product.sku,
      category: (product) => product.category.name,
      price: (product) => Number(product.price),
      stock: (product) => product.inventory[0]?.quantity ?? 0,
      status: (product) => getStockStatus(product).label,
    },
    {
      // The page level search box stays the primary, whole row search.
      filter: (product) =>
        product.name.toLowerCase().includes(search.toLowerCase()) ||
        product.sku.toLowerCase().includes(search.toLowerCase()) ||
        product.category.name.toLowerCase().includes(search.toLowerCase()),
    }
  );

  // Rows currently visible (search + column filters + sorting). Export and bulk
  // selection both read from this list, so a hidden row is never deleted.
  const filteredProducts = productsTable.rows;

  // Bulk selection helpers. "Select all" only ever selects the rows that are
  // currently visible so a hidden search result cannot be deleted by accident.
  const visibleProductIds = (filteredProducts ?? []).map((product) => product.id);
  const visibleSelectedCount = visibleProductIds.filter((id) => selectedIds.includes(id)).length;
  const allVisibleSelected =
    visibleProductIds.length > 0 && visibleSelectedCount === visibleProductIds.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;

  const toggleProductSelection = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const visible = new Set(visibleProductIds);
      const everyVisibleSelected = visibleProductIds.every((id) => prev.includes(id));
      if (everyVisibleSelected) {
        return prev.filter((id) => !visible.has(id));
      }
      return Array.from(new Set([...prev, ...visibleProductIds]));
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      await bulkDeleteMutation.mutateAsync(selectedIds);
    } catch {
      // Reported by the mutation's onError handler.
    }
  };

  // Export the rows currently shown (the search filter is respected) to an
  // .xlsx or .csv file. SheetJS is loaded lazily by the export helper.
  const handleExport = async (format: ExportFormat) => {
    const rows = filteredProducts ?? [];

    if (rows.length === 0) {
      toast({
        title: "Nothing to export",
        description: "No products match the current search.",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    try {
      const fileName = await exportProducts(rows, format);
      toast({
        title: "Export ready",
        description: `${fileName} · ${rows.length} product${rows.length === 1 ? "" : "s"}`,
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

  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);

  // View Product Dialog Component
  function ViewProductDialog({
    product,
    open,
    onOpenChange
  }: {
    product: Product | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) {
    if (!product) return null;

    const stockStatus = getStockStatus(product);

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Product Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Name</label>
                <p className="mt-1 text-sm text-foreground">{product.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">SKU</label>
                <p className="mt-1 text-sm text-foreground">{product.sku}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Category</label>
                <p className="mt-1 text-sm text-foreground">{product.category.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Brand</label>
                <p className="mt-1 text-sm text-foreground">{product.brand?.name || 'Not specified'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Supplier</label>
                <p className="mt-1 text-sm text-foreground">{product.supplier?.name || 'Not specified'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Landing Price</label>
                <p className="mt-1 text-sm text-foreground">
                  {product.landingPrice != null ? formatPrice(product.landingPrice) : 'Not set'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">B2B Price</label>
                <p className="mt-1 text-sm text-foreground">
                  {product.b2bPrice != null ? formatPrice(product.b2bPrice) : 'Not set'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">B2C Price</label>
                <p className="mt-1 text-sm text-foreground">
                  {product.b2cPrice != null ? formatPrice(product.b2cPrice) : 'Not set'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Stock Status</label>
                <div className="mt-1">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${stockStatus.class}`}>
                    {stockStatus.label}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Current Stock</label>
                <p className="mt-1 text-sm text-foreground">{product.inventory[0]?.quantity ?? 0}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Minimum Stock</label>
                <p className="mt-1 text-sm text-foreground">{product.minStock}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Weight</label>
                <p className="mt-1 text-sm text-foreground">
                  {product.weightKg != null ? `${Number(product.weightKg)} kg` : 'Not set'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Length</label>
                <p className="mt-1 text-sm text-foreground">
                  {product.lengthCm != null ? `${Number(product.lengthCm)} cm` : 'Not set'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Width</label>
                <p className="mt-1 text-sm text-foreground">
                  {product.widthCm != null ? `${Number(product.widthCm)} cm` : 'Not set'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Height</label>
                <p className="mt-1 text-sm text-foreground">
                  {product.heightCm != null ? `${Number(product.heightCm)} cm` : 'Not set'}
                </p>
              </div>
            </div>
            {product.description && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Description</label>
                {/* Descriptions may be plain text or HTML - RichText sanitises the
                    HTML and keeps the formatting so the details look right. */}
                <RichText
                  value={product.description}
                  className="mt-1 text-foreground"
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const onSubmit = async (data: ProductFormData) => {
    try {
      if (editingProduct) {
        await updateMutation.mutateAsync({ 
          id: editingProduct.id, 
          data: data
        });
      } else {
        await createMutation.mutateAsync(data);
      }

      form.reset();
      setEditingProduct(null);
      setIsEditDialogOpen(false); // Close the edit dialog
      setIsCreateDialogOpen(false); // Close the create dialog
    } catch (error) {
      // Error is handled by the mutation
    }
  };

  const handleDelete = async () => {
    if(productToDelete){
      await deleteMutation.mutateAsync(productToDelete.id);
    }
  };

  const handleDeleteClick = (id: number) => {
    // Find the product to get its name for the confirmation message
    const productToDelete = products?.find(product => product.id === id);
    setProductToDelete(productToDelete || null);
    setIsDeleteDialogOpen(true);
  };

  const handleViewClick = (product: Product) => {
    setViewingProduct(product);
    setIsViewDialogOpen(true);
  };

  // If user doesn't have read permission, show access denied
  if (!hasPermission('products', 'read')) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              You don't have permission to view products.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Products</h1>
        {hasPermission('products', 'create') && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setIsImportDialogOpen(true)}>
              <Download className="mr-2 h-4 w-4" />
              Import
            </Button>
            <ProductFormDialog
              mode="create"
              open={isCreateDialogOpen}
              onOpenChange={setIsCreateDialogOpen}
              form={form}
              categories={categories}
              brands={brands}
              suppliers={suppliers}
              isPending={createMutation.isPending}

              onSubmit={onSubmit}
              trigger={
                <Button variant="create" onClick={() => {
                  setEditingProduct(null);
                  form.reset({
                    name: "",
                    description: "",
                    sku: "",
                    landingPrice: null,
                    b2bPrice: null,
                    b2cPrice: null,
                    categoryId: 0,
                    brandId: null,
                    supplierId: null,
                    minStock: 10,
                    weightKg: null,
                    lengthCm: null,
                    widthCm: null,
                    heightCm: null,
                  });

                  setIsCreateDialogOpen(true);
                }}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Product
                </Button>
              }
            />
          </div>
        )}
      </div>

      {/* CSV / Excel import - opened from the Import button above */}
      <ImportProductsDialog
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        onImported={() => refetch()}
      />

      <Card>
        <CardHeader>
          <CardTitle>Product List</CardTitle>
          <div className="flex items-center gap-4">
            <SearchInput
              containerClassName="flex-1 max-w-sm"
              placeholder="Search products..."
              value={search}
              onValueChange={setSearch}
            />
            {hasPermission('products', 'read') && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={isExporting}>
                    {isExporting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
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
          {canDeleteProducts && selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <span className="text-sm font-medium">{selectedIds.length} selected</span>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                Clear selection
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setIsBulkDeleteDialogOpen(true)}
                disabled={bulkDeleteMutation.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete selected
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
            <TableControlsBar controls={productsTable} noun="products" />
            <Table>
              <TableHeader>
                <TableRow>
                  {canDeleteProducts && (
                    <TableHead className="w-10 align-top">
                      <Checkbox
                        aria-label="Select all products"
                        checked={
                          allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false
                        }
                        onCheckedChange={toggleSelectAllVisible}
                        disabled={visibleProductIds.length === 0}
                      />
                    </TableHead>
                  )}
                  <ColumnHeader controls={productsTable} columnKey="name" label="Name" filterPlaceholder="Filter name" />
                  <ColumnHeader controls={productsTable} columnKey="sku" label="SKU" filterPlaceholder="Filter SKU" />
                  <ColumnHeader controls={productsTable} columnKey="category" label="Category" filterPlaceholder="Filter category" />
                  <ColumnHeader controls={productsTable} columnKey="price" label="Price" filterPlaceholder="Filter price" />
                  <ColumnHeader controls={productsTable} columnKey="stock" label="Stock" filterPlaceholder="Filter stock" />
                  <ColumnHeader controls={productsTable} columnKey="status" label="Status" filterPlaceholder="Filter status" />
                  <TableHead className="align-top">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts?.map((product) => {
                  const stockStatus = getStockStatus(product);
                  return (
                    <TableRow key={product.id} data-state={selectedIds.includes(product.id) ? "selected" : undefined}>
                      {canDeleteProducts && (
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${product.name}`}
                            checked={selectedIds.includes(product.id)}
                            onCheckedChange={() => toggleProductSelection(product.id)}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <div>{product.name}</div>
                        {/* Compact single-line preview - strips any HTML markup. */}
                        <div className="line-clamp-2 text-sm text-muted-foreground">
                          {toPlainText(product.description)}
                        </div>
                      </TableCell>
                      <TableCell>{product.sku}</TableCell>
                      <TableCell>{product.category.name}</TableCell>
                      <TableCell>{formatPrice(product.price)}</TableCell>
                      <TableCell>{product.inventory[0]?.quantity ?? 0}</TableCell>
                      <TableCell>
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${stockStatus.class}`}>
                          {stockStatus.label}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleViewClick(product)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {hasPermission('products', 'update') && (
                            <ProductFormDialog
                              mode="edit"
                              open={isEditDialogOpen && editingProduct?.id === product.id}
                              onOpenChange={(nextOpen) => {
                                setIsEditDialogOpen(nextOpen);
                                if (!nextOpen) setEditingProduct(null);
                              }}
                              form={form}
                              categories={categories}
                              brands={brands}
                              suppliers={suppliers}
                              isPending={updateMutation.isPending}

                              onSubmit={onSubmit}
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setEditingProduct(product);
                                    // Pre-populate the form with the product details
                                    form.reset({
                                      name: product.name,
                                      description: product.description ?? "",
                                      sku: product.sku,
                                      landingPrice: toOptionalPrice(product.landingPrice),
                                      b2bPrice: toOptionalPrice(product.b2bPrice),
                                      b2cPrice: toOptionalPrice(product.b2cPrice),
                                      categoryId: product.categoryId,
                                      brandId: product.brandId ?? null,
                                      supplierId: product.supplierId ?? null,
                                      minStock: product.minStock,
                                      weightKg: product.weightKg != null ? Number(product.weightKg) : null,
                                      lengthCm: product.lengthCm != null ? Number(product.lengthCm) : null,
                                      widthCm: product.widthCm != null ? Number(product.widthCm) : null,
                                      heightCm: product.heightCm != null ? Number(product.heightCm) : null,

                                    });
                                    setIsEditDialogOpen(true);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              }
                            />
                          )}
                          {(hasPermission('products', 'delete') || isAdmin) && (
                            <Button
                              onClick={() => handleDeleteClick(product.id)}
                              variant="ghost"
                              size="icon"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this product?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the product
              {productToDelete ? ` "${productToDelete.name}"` : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setProductToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isBulkDeleteDialogOpen} onOpenChange={setIsBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.length} selected product{selectedIds.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Products that are already used in orders will be
              skipped and reported after the deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Keep the dialog open while the request is in flight so the
                // pending state is visible.
                event.preventDefault();
                void handleBulkDelete();
              }}
              disabled={bulkDeleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete selected"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ViewProductDialog
        product={viewingProduct}
        open={isViewDialogOpen}
        onOpenChange={(open) => {
          setIsViewDialogOpen(open);
          if (!open) setViewingProduct(null);
        }}
      />
    </div>
  );
}

export default ProductsPage;
