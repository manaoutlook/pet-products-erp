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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Plus, Pencil, Trash2, AlertCircle, Eye, Upload, Download } from "lucide-react";
import { formatPrice } from "@/utils/price";
import { exportProducts, type ExportFormat } from "@/utils/product-spreadsheet";
import { ImportProductsDialog } from "@/components/products/ImportProductsDialog";
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
      toast({ title: "Success", description: "Product deleted successfully" });
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
    },
  });


  const filteredProducts = products?.filter(product => 
    product.name.toLowerCase().includes(search.toLowerCase()) ||
    product.sku.toLowerCase().includes(search.toLowerCase()) ||
    product.category.name.toLowerCase().includes(search.toLowerCase())
  );

  const getStockStatus = (product: Product) => {
    const quantity = product.inventory[0]?.quantity ?? 0;
    if (quantity <= 0) return { label: 'Out of Stock', class: 'bg-red-100 text-red-800' };
    if (quantity <= product.minStock) return { label: 'Low Stock', class: 'bg-yellow-100 text-yellow-800' };
    return { label: 'In Stock', class: 'bg-green-100 text-green-800' };
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
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Product Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">Name</label>
                <p className="mt-1 text-sm text-gray-900">{product.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">SKU</label>
                <p className="mt-1 text-sm text-gray-900">{product.sku}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Category</label>
                <p className="mt-1 text-sm text-gray-900">{product.category.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Brand</label>
                <p className="mt-1 text-sm text-gray-900">{product.brand?.name || 'Not specified'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Supplier</label>
                <p className="mt-1 text-sm text-gray-900">{product.supplier?.name || 'Not specified'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Landing Price</label>
                <p className="mt-1 text-sm text-gray-900">
                  {product.landingPrice != null ? formatPrice(product.landingPrice) : 'Not set'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">B2B Price</label>
                <p className="mt-1 text-sm text-gray-900">
                  {product.b2bPrice != null ? formatPrice(product.b2bPrice) : 'Not set'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">B2C Price</label>
                <p className="mt-1 text-sm text-gray-900">
                  {product.b2cPrice != null ? formatPrice(product.b2cPrice) : 'Not set'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Stock Status</label>
                <div className="mt-1">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${stockStatus.class}`}>
                    {stockStatus.label}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Current Stock</label>
                <p className="mt-1 text-sm text-gray-900">{product.inventory[0]?.quantity ?? 0}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Minimum Stock</label>
                <p className="mt-1 text-sm text-gray-900">{product.minStock}</p>
              </div>
            </div>
            {product.description && (
              <div>
                <label className="text-sm font-medium text-gray-500">Description</label>
                <p className="mt-1 text-sm text-gray-900">{product.description}</p>
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
      <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <h1 className="text-2xl font-bold text-gray-900">Access Denied</h1>
            </div>
            <p className="mt-4 text-sm text-gray-600">
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
                <Button onClick={() => {
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
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
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
