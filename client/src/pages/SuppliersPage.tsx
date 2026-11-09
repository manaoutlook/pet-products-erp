import { useQuery, useMutation } from "@tanstack/react-query";
import { formatDateTime } from "@/utils/format";
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
import type { InsertSupplier, SelectSupplier } from "@db/schema";
import { insertSupplierSchema } from "@db/schema";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2, AlertCircle, Eye, Download, Upload } from "lucide-react";
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

function SuppliersPage() {
  const [search, setSearch] = useState("");
  const [editingSupplier, setEditingSupplier] = useState<SelectSupplier | null>(null);
  const [viewingSupplier, setViewingSupplier] = useState<SelectSupplier | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canDeleteSuppliers = hasPermission('masterData', 'delete');

  // View Supplier Dialog Component
  function ViewSupplierDialog({
    supplier,
    open,
    onOpenChange
  }: {
    supplier: SelectSupplier | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) {
    if (!supplier) return null;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Supplier Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Supplier Name</label>
                <p className="mt-1 text-sm text-foreground">{supplier.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Contact Information</label>
                <p className="mt-1 text-sm text-foreground">{supplier.contactInfo}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Address</label>
                <p className="mt-1 text-sm text-foreground">{supplier.address}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Created At</label>
                <p className="mt-1 text-sm text-foreground">{formatDateTime(supplier.createdAt)}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Updated At</label>
                <p className="mt-1 text-sm text-foreground">{formatDateTime(supplier.updatedAt)}</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const { data: suppliers, isLoading, refetch } = useQuery<SelectSupplier[]>({
    queryKey: ['/api/suppliers'],
    enabled: hasPermission('masterData', 'read'),
  });

  const form = useForm<InsertSupplier>({
    resolver: zodResolver(insertSupplierSchema),
    defaultValues: {
      name: "",
      contactInfo: "",
      address: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertSupplier) => {
      const res = await fetch('/api/suppliers', {
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
      toast({ title: "Success", description: "Supplier created successfully", variant: "success" });
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
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertSupplier> }) => {
      const res = await fetch(`/api/suppliers/${id}`, {
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
      toast({ title: "Success", description: "Supplier updated successfully", variant: "success" });
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
      const res = await fetch(`/api/suppliers/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Success", description: "Supplier deleted successfully", variant: "success" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const onSubmit = async (data: InsertSupplier) => {
    try {
      if (editingSupplier) {
        await updateMutation.mutateAsync({
          id: editingSupplier.id,
          data
        });
      } else {
        await createMutation.mutateAsync(data);
      }
      form.reset();
    } catch (error) {
      // Error is handled by the mutation
    }
  };

  const handleAddSupplier = () => {
    setEditingSupplier(null);
    form.reset({
      name: "",
      contactInfo: "",
      address: "",
    });
    setDialogOpen(true);
  };

  const handleEditSupplier = (supplier: SelectSupplier) => {
    setEditingSupplier(supplier);
    form.reset({
      name: supplier.name,
      contactInfo: supplier.contactInfo,
      address: supplier.address,
    });
    setDialogOpen(true);
  };

  // Header controls: click a column header to sort it (asc -> desc -> none) and
  // use the small input under a header to filter that single column.
  const suppliersTable = useTableControls(
    suppliers,
    {
      name: (supplier) => supplier.name,
      contactInfo: (supplier) => supplier.contactInfo,
      address: (supplier) => supplier.address,
    },
    {
      // The page level search box stays the primary, whole row search.
      filter: (supplier) =>
        supplier.name.toLowerCase().includes(search.toLowerCase()) ||
        supplier.contactInfo.toLowerCase().includes(search.toLowerCase()) ||
        supplier.address.toLowerCase().includes(search.toLowerCase()),
    }
  );

  // Rows currently visible (search + column filters + sorting).
  const filteredSuppliers: SelectSupplier[] = suppliersTable.rows;

  // Checkbox multi-select for the bulk delete action - only the rows that are
  // currently visible can be selected, so a filtered-out supplier is never deleted.
  const bulkDelete = useMasterDataBulkDelete({
    endpoint: '/api/suppliers',
    singular: 'supplier',
    plural: 'suppliers',
    onDeleted: () => refetch(),
  });

  const visibleSupplierIds = (filteredSuppliers ?? []).map((supplier) => supplier.id);
  const visibleSelection = bulkDelete.selectionState(visibleSupplierIds);

  // Export the rows currently shown (the search filter is respected) to an
  // .xlsx or .csv file. SheetJS is loaded lazily by the export helper.
  const handleExport = async (format: SpreadsheetFormat) => {
    const rows = filteredSuppliers ?? [];

    if (rows.length === 0) {
      toast({
        title: "Nothing to export",
        description: "No suppliers match the current search.",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    try {
      const fileName = await exportMasterData("suppliers", rows, format);
      toast({
        title: "Export ready",
        description: `${fileName} · ${rows.length} ${rows.length === 1 ? "supplier" : "suppliers"}`,
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
              You don't have permission to view suppliers.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Suppliers</h1>
        {hasPermission('masterData', 'create') && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setIsImportDialogOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="create" onClick={handleAddSupplier}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Supplier
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Supplier Name</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="Enter supplier name"
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
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Address</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="Enter supplier address"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button variant={editingSupplier ? 'update' : 'create'}
                      type="submit"
                      className="w-full"
                      disabled={form.formState.isSubmitting}
                    >
                      {form.formState.isSubmitting && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {editingSupplier ? 'Update Supplier' : 'Create Supplier'}
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
        kind="suppliers"
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        onImported={() => refetch()}
      />

      <Card>
        <CardHeader>
          <CardTitle>Supplier List</CardTitle>
          <div className="flex items-center gap-4">
            <SearchInput
              containerClassName="flex-1 max-w-sm"
              placeholder="Search suppliers..."
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
          {canDeleteSuppliers && (
            <MasterDataBulkDeleteToolbar
              count={bulkDelete.selectedCount}
              plural="suppliers"
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
            <TableControlsBar controls={suppliersTable} noun="suppliers" />
            <Table className="table-actions-sticky min-w-[940px]">
              <TableHeader>
                <TableRow>
                  {canDeleteSuppliers && (
                    <TableHead className="w-10 align-top">
                      <Checkbox
                        aria-label="Select all suppliers"
                        checked={
                          visibleSelection.allSelected
                            ? true
                            : visibleSelection.someSelected
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={() => bulkDelete.toggleSelectAll(visibleSupplierIds)}
                        disabled={visibleSupplierIds.length === 0}
                      />
                    </TableHead>
                  )}
                  <ColumnHeader controls={suppliersTable} columnKey="name" label="Supplier Name" filterPlaceholder="Filter supplier" />
                  <ColumnHeader controls={suppliersTable} columnKey="contactInfo" label="Contact Information" filterPlaceholder="Filter contact" />
                  <ColumnHeader controls={suppliersTable} columnKey="address" label="Address" filterPlaceholder="Filter address" />
                  <TableHead className="align-top">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSuppliers?.map((supplier: SelectSupplier) => (
                  <TableRow
                    key={supplier.id}
                    data-state={bulkDelete.isSelected(supplier.id) ? "selected" : undefined}
                  >
                    {canDeleteSuppliers && (
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${supplier.name}`}
                          checked={bulkDelete.isSelected(supplier.id)}
                          onCheckedChange={() => bulkDelete.toggleSelection(supplier.id)}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium">{supplier.name}</TableCell>
                    <TableCell>{supplier.contactInfo}</TableCell>
                    <TableCell>{supplier.address}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            setViewingSupplier(supplier);
                            setIsViewDialogOpen(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {hasPermission('masterData', 'update') && (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleEditSupplier(supplier)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {hasPermission('masterData', 'delete') && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="text-destructive"
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this supplier?')) {
                                deleteMutation.mutate(supplier.id);
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
        singular="supplier"
        plural="suppliers"
        isPending={bulkDelete.isPending}
        onConfirm={bulkDelete.confirmDelete}
      />

      <ViewSupplierDialog
        supplier={viewingSupplier}
        open={isViewDialogOpen}
        onOpenChange={(open) => {
          setIsViewDialogOpen(open);
          if (!open) setViewingSupplier(null);
        }}
      />
    </div>
  );
}

export default SuppliersPage;
