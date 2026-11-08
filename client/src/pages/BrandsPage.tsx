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
import { Checkbox } from "@/components/ui/checkbox";
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
import { Loader2, Plus, Pencil, Trash2, AlertCircle, Eye, Download, Upload } from "lucide-react";
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

function BrandsPage() {
  const [search, setSearch] = useState("");
  const [editingBrand, setEditingBrand] = useState<SelectBrand | null>(null);
  const [viewingBrand, setViewingBrand] = useState<SelectBrand | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canDeleteBrands = hasPermission('masterData', 'delete');

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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Brand Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Brand Name</label>
                <p className="mt-1 text-sm text-foreground">{brand.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Description</label>
                <p className="mt-1 text-sm text-foreground">{brand.description || 'Not specified'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Created At</label>
                <p className="mt-1 text-sm text-foreground">{new Date(brand.createdAt!).toLocaleString()}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Updated At</label>
                <p className="mt-1 text-sm text-foreground">{new Date(brand.updatedAt!).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </DialogContent>
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
      toast({ title: "Success", description: "Brand created successfully", variant: "success" });
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
      toast({ title: "Success", description: "Brand updated successfully", variant: "success" });
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
      toast({ title: "Success", description: "Brand deleted successfully", variant: "success" });
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

  // Header controls: click a column header to sort it (asc -> desc -> none) and
  // use the small input under a header to filter that single column.
  const brandsTable = useTableControls(
    brands,
    {
      name: (brand) => brand.name,
      description: (brand) => brand.description,
    },
    {
      // The page level search box stays the primary, whole row search.
      filter: (brand) =>
        brand.name.toLowerCase().includes(search.toLowerCase()) ||
        (brand.description?.toLowerCase() || "").includes(search.toLowerCase()),
    }
  );

  // Rows currently visible (search + column filters + sorting).
  const filteredBrands: SelectBrand[] = brandsTable.rows;

  // Checkbox multi-select for the bulk delete action - only the rows that are
  // currently visible can be selected, so a filtered-out brand is never deleted.
  const bulkDelete = useMasterDataBulkDelete({
    endpoint: '/api/brands',
    singular: 'brand',
    plural: 'brands',
    onDeleted: () => refetch(),
  });

  const visibleBrandIds = (filteredBrands ?? []).map((brand) => brand.id);
  const visibleSelection = bulkDelete.selectionState(visibleBrandIds);

  // Export the rows currently shown (the search filter is respected) to an
  // .xlsx or .csv file. SheetJS is loaded lazily by the export helper.
  const handleExport = async (format: SpreadsheetFormat) => {
    const rows = filteredBrands ?? [];

    if (rows.length === 0) {
      toast({
        title: "Nothing to export",
        description: "No brands match the current search.",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    try {
      const fileName = await exportMasterData("brands", rows, format);
      toast({
        title: "Export ready",
        description: `${fileName} · ${rows.length} ${rows.length === 1 ? "brand" : "brands"}`,
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
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setIsImportDialogOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="create" onClick={handleAddBrand}>
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
                    <Button variant={editingBrand ? 'update' : 'create'}
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
          </div>
        )}
      </div>

      {/* CSV / Excel import - opened from the Import button above */}
      <MasterDataImportDialog
        kind="brands"
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        onImported={() => refetch()}
      />

      <Card>
        <CardHeader>
          <CardTitle>Brand List</CardTitle>
          <div className="flex items-center gap-4">
            <SearchInput
              containerClassName="flex-1 max-w-sm"
              placeholder="Search brands..."
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
          {canDeleteBrands && (
            <MasterDataBulkDeleteToolbar
              count={bulkDelete.selectedCount}
              plural="brands"
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
            <TableControlsBar controls={brandsTable} noun="brands" />
            <Table>
              <TableHeader>
                <TableRow>
                  {canDeleteBrands && (
                    <TableHead className="w-10 align-top">
                      <Checkbox
                        aria-label="Select all brands"
                        checked={
                          visibleSelection.allSelected
                            ? true
                            : visibleSelection.someSelected
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={() => bulkDelete.toggleSelectAll(visibleBrandIds)}
                        disabled={visibleBrandIds.length === 0}
                      />
                    </TableHead>
                  )}
                  <ColumnHeader controls={brandsTable} columnKey="name" label="Brand Name" filterPlaceholder="Filter brand" />
                  <ColumnHeader controls={brandsTable} columnKey="description" label="Description" filterPlaceholder="Filter description" />
                  <TableHead className="align-top">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBrands?.map((brand: SelectBrand) => (
                  <TableRow
                    key={brand.id}
                    data-state={bulkDelete.isSelected(brand.id) ? "selected" : undefined}
                  >
                    {canDeleteBrands && (
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${brand.name}`}
                          checked={bulkDelete.isSelected(brand.id)}
                          onCheckedChange={() => bulkDelete.toggleSelection(brand.id)}
                        />
                      </TableCell>
                    )}
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
            </>
          )}
        </CardContent>
      </Card>

      <MasterDataBulkDeleteDialog
        open={bulkDelete.isDeleteDialogOpen}
        onOpenChange={bulkDelete.setIsDeleteDialogOpen}
        count={bulkDelete.selectedCount}
        singular="brand"
        plural="brands"
        isPending={bulkDelete.isPending}
        onConfirm={bulkDelete.confirmDelete}
      />

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
