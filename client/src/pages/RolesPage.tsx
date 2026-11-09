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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { InsertRole, SelectRole } from "@db/schema";
import { insertRoleSchema } from "@db/schema";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";

function RolesPage() {
  const [search, setSearch] = useState("");
  const [editingRole, setEditingRole] = useState<SelectRole | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: roles, isLoading, refetch } = useQuery<SelectRole[]>({
    queryKey: ['/api/roles'],
  });


  const createMutation = useMutation({
    mutationFn: async (data: InsertRole) => {
      // Add default permissions with Products Module view access for all users
      const dataWithPermissions = {
        ...data,
        permissions: {
          products: { create: false, read: true, update: false, delete: false },
          orders: { create: false, read: false, update: false, delete: false },
          inventory: { create: false, read: false, update: false, delete: false },
          users: { create: false, read: false, update: false, delete: false },
          stores: { create: false, read: false, update: false, delete: false },
          masterData: { create: false, read: false, update: false, delete: false },
          pos: { create: false, read: false, update: false, delete: false },
          receipts: { create: false, read: false, update: false, delete: false }
        }
      };

      console.log("Sending create role request with data:", dataWithPermissions);
      const res = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataWithPermissions),
        credentials: 'include',
      });

      console.log("Create role response status:", res.status);

      if (!res.ok) {
        const errorText = await res.text();
        console.error("API error response:", errorText);
        throw new Error(errorText);
      }

      const responseData = await res.json();
      console.log("Create role success response:", responseData);
      return responseData;
    },
    onSuccess: (data) => {
      console.log("Role created successfully:", data);
      refetch();
      toast({ title: "Success", description: "Role created successfully", variant: "success" });
    },
    onError: (error: Error) => {
      console.error("Create role mutation error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create role",
        variant: "destructive"
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      // Preserve existing permissions when updating
      const roleData = {
        ...data,
        permissions: editingRole?.permissions || {
          products: { create: false, read: true, update: false, delete: false },
          orders: { create: false, read: true, update: false, delete: false },
          inventory: { create: false, read: true, update: false, delete: false },
          users: { create: false, read: false, update: false, delete: false },
          stores: { create: false, read: true, update: false, delete: false },
          masterData: { create: false, read: false, update: false, delete: false },
          pos: { create: false, read: false, update: false, delete: false },
          receipts: { create: false, read: false, update: false, delete: false }
        }
      };

      const res = await fetch(`/api/roles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roleData),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetch();
      setDialogOpen(false);
      toast({ title: "Success", description: "Role updated successfully", variant: "success" });
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
      const res = await fetch(`/api/roles/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Success", description: "Role deleted successfully", variant: "success" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const form = useForm<InsertRole>({
    resolver: zodResolver(insertRoleSchema),
    defaultValues: {
      name: "",
      description: "",
      isSystemAdmin: false,
    },
  });

  // Header controls: click a column header to sort it (asc -> desc -> none) and
  // use the small input under a header to filter that single column.
  const rolesTable = useTableControls(
    roles,
    {
      name: (role) => role.name,
      description: (role) => role.description,
      isSystemAdmin: (role) => role.isSystemAdmin,
    },
    {
      // The page level search box stays the primary, whole row search.
      filter: (role) =>
        role.name.toLowerCase().includes(search.toLowerCase()) ||
        (role.description?.toLowerCase() || "").includes(search.toLowerCase()),
    }
  );

  // Rows currently visible (search + column filters + sorting).
  const filteredRoles = rolesTable.rows;

  const onSubmit = async (data: any) => {
    try {
      console.log("⭐ Form submission triggered with data:", data);
      console.log("Form state:", form.formState);

      // Validation
      if (!data.name) {
        console.error("Name is required");
        toast({
          title: "Validation Error",
          description: "Name is required",
          variant: "destructive"
        });
        return;
      }


      // Add default permissions for new roles
      const formData = {
        ...data,
        permissions: {
          products: { create: false, read: true, update: false, delete: false },
          orders: { create: false, read: true, update: false, delete: false },
          inventory: { create: false, read: true, update: false, delete: false },
          users: { create: false, read: false, update: false, delete: false },
          stores: { create: false, read: true, update: false, delete: false },
          masterData: { create: false, read: false, update: false, delete: false },
          pos: { create: false, read: false, update: false, delete: false },
          receipts: { create: false, read: false, update: false, delete: false }
        }
      };

      console.log("About to submit role creation with:", formData);

      if (editingRole) {
        await updateMutation.mutateAsync({ id: editingRole.id, data: formData });
      } else {
        await createMutation.mutateAsync(formData);
      }

      // Close dialog and reset form on success
      setDialogOpen(false);
      form.reset();
    } catch (error) {
      console.error("Error submitting role:", error);
      toast({
        title: "Error",
        description: "Failed to create/update role. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleAddRole = () => {
    setEditingRole(null);
    form.reset({
      name: "",
      description: "",
      isSystemAdmin: false,
    });
    setDialogOpen(true);
  };

  const handleEditRole = (role: SelectRole) => {
    setEditingRole(role);
    form.reset({
      name: role.name,
      description: role.description || "",
      isSystemAdmin: role.isSystemAdmin,
    });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Roles</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="create" onClick={handleAddRole}>
              <Plus className="mr-2 h-4 w-4" />
              Add Role
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingRole ? 'Edit Role' : 'Add New Role'}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <div className="space-y-4">
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
                        <Input {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="isSystemAdmin"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Input
                          type="checkbox"
                          checked={field.value}
                          onChange={field.onChange}
                          className="w-4 h-4"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>
                          System Administrator
                        </FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  className="w-full"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  onClick={() => {
                    console.log("Submit button clicked directly");
                    const formData = form.getValues();
                    console.log("Form data:", formData);

                    // Directly handle submit without relying on form submission
                    onSubmit(formData);
                  }}
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {editingRole ? 'Update Role' : 'Create Role'}
                </Button>
              </div>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Role List</CardTitle>
          <div className="flex items-center gap-4">
            <SearchInput
              containerClassName="flex-1 max-w-sm"
              placeholder="Search roles..."
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
            <TableControlsBar controls={rolesTable} noun="roles" />
            <Table className="table-actions-sticky min-w-[880px]">
              <TableHeader>
                <TableRow>
                  <ColumnHeader controls={rolesTable} columnKey="name" label="Name" filterPlaceholder="Filter name" />
                  <ColumnHeader controls={rolesTable} columnKey="description" label="Description" filterPlaceholder="Filter description" />
                  <ColumnHeader controls={rolesTable} columnKey="isSystemAdmin" label="System Admin" filterPlaceholder="Filter admin" />
                  <TableHead className="align-top">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRoles?.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">{role.name}</TableCell>
                    <TableCell>{role.description}</TableCell>
                    <TableCell>{role.isSystemAdmin ? 'Yes' : 'No'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleEditRole(role)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this role?')) {
                              deleteMutation.mutate(role.id);
                            }
                          }}
                          disabled={role.name === 'admin'} // Prevent deleting admin role
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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

export default RolesPage;