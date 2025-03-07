import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil, Plus, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchData, postData, putData, deleteData } from "@/lib/api";

// Define interfaces
interface RoleType {
  id: number;
  description: string;
}

interface Role {
  id: number;
  name: string;
  description: string | null;
  permissions: Permissions;
  roleTypeId: number;
  createdAt: string;
  updatedAt: string;
  roleType?: {
    id: number;
    description: string;
  };
}

interface Permissions {
  users: PermissionActions;
  orders: PermissionActions;
  products: PermissionActions;
  inventory: PermissionActions;
}

interface PermissionActions {
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
}

const formSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters"),
  description: z.string().optional(),
  roleTypeId: z.number(),
});

// Corrected default permissions structure
const defaultPermissions: Permissions = {
  users: {
    read: true,
    create: true,
    update: true,
    delete: true
  },
  orders: {
    read: true,
    create: true,
    update: true,
    delete: true
  },
  products: {
    read: true,
    create: true,
    update: true,
    delete: true
  },
  inventory: {
    read: true,
    create: true,
    update: true,
    delete: true
  }
};

type InsertRole = z.infer<typeof formSchema>;

function RolesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Query for fetching all roles
  const { data: roles, isLoading: isLoadingRoles } = useQuery<Role[]>({
    queryKey: ['/api/roles'],
    queryFn: () => fetchData('/roles'),
  });

  // Query for fetching role types
  const { data: roleTypes, isLoading: isLoadingRoleTypes } = useQuery<RoleType[]>({
    queryKey: ['/api/role-types'],
    queryFn: () => fetchData('/role-types'),
  });

  // Form for creating/editing roles
  const form = useForm<InsertRole>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      roleTypeId: undefined,
    },
  });

  // Mutation for creating a new role
  const createMutation = useMutation({
    mutationFn: async (data: InsertRole) => {
      const roleData = {
        ...data,
        permissions: defaultPermissions
      };
      logger.info('Creating new role', { roleData });
      return postData('/roles', roleData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/roles'] });
      setDialogOpen(false);
      form.reset();
      toast({
        title: "Success",
        description: "Role created successfully",
      });
      logger.info('Role created successfully');
    },
    onError: (error: Error) => {
      logger.error('Error creating role', { error });
      toast({
        title: "Error",
        description: error.message || "Failed to create role",
        variant: "destructive",
      });
    },
  });

  // Mutation for updating a role
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: InsertRole }) => {
      const roleData = {
        ...data,
        permissions: editingRole?.permissions || defaultPermissions
      };
      logger.info('Updating role', { id, roleData });
      return putData(`/roles/${id}`, roleData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/roles'] });
      setDialogOpen(false);
      setEditingRole(null);
      form.reset();
      toast({
        title: "Success",
        description: "Role updated successfully",
      });
      logger.info('Role updated successfully');
    },
    onError: (error: Error) => {
      logger.error('Error updating role', { error });
      toast({
        title: "Error",
        description: error.message || "Failed to update role",
        variant: "destructive",
      });
    },
  });

  // Handler for form submission
  const onSubmit = async (data: InsertRole) => {
    try {
      logger.info('Submitting role form', { formData: data, isEditing: !!editingRole });

      if (editingRole) {
        await updateMutation.mutateAsync({ 
          id: editingRole.id, 
          data
        });
      } else {
        await createMutation.mutateAsync(data);
      }
    } catch (error: any) {
      logger.error('Error submitting form', { error });
      toast({
        title: "Error",
        description: error.message || "Failed to submit form",
        variant: "destructive",
      });
    }
  };

  // Handler for opening the dialog for editing
  function handleEdit(role: Role) {
    logger.info('Opening edit dialog for role', { roleId: role.id });
    setEditingRole(role);
    form.reset({
      name: role.name,
      description: role.description || "",
      roleTypeId: role.roleTypeId,
    });
    setDialogOpen(true);
  }

  // Handler for deleting a role
  async function handleDelete(id: number) {
    if (window.confirm("Are you sure you want to delete this role?")) {
      logger.info('Deleting role', { roleId: id });
      try {
        await deleteData(`/roles/${id}`);
        queryClient.invalidateQueries({ queryKey: ['/api/roles'] });
        toast({
          title: "Success",
          description: "Role deleted successfully",
        });
        logger.info('Role deleted successfully', { roleId: id });
      } catch (error: any) {
        logger.error('Error deleting role', { roleId: id, error });
        toast({
          title: "Error",
          description: error.message || "Failed to delete role",
          variant: "destructive",
        });
      }
    }
  }

  if (isLoadingRoles || isLoadingRoleTypes) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Roles Management</h1>
        <Button onClick={() => {
          setEditingRole(null);
          form.reset({
            name: "",
            description: "",
            roleTypeId: undefined,
          });
          setDialogOpen(true);
        }}>
          <Plus className="mr-2 h-4 w-4" />
          Add Role
        </Button>
      </div>

      <div className="rounded-md border">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role Type</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created At</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {roles?.map((role: Role) => (
              <tr key={role.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{role.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{role.description || "-"}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{role.roleType?.description || "-"}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(role.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <div className="flex space-x-2">
                    <Button variant="outline" size="sm" onClick={() => handleEdit(role)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {role.name !== "admin" && (
                      <Button variant="outline" size="sm" className="text-red-600" onClick={() => handleDelete(role.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRole ? 'Edit Role' : 'Create Role'}</DialogTitle>
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
                      <Input placeholder="Role name" {...field} disabled={editingRole?.name === "admin"} />
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
                      <Textarea placeholder="Role description" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="roleTypeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role Type</FormLabel>
                    <Select 
                      onValueChange={(value) => field.onChange(parseInt(value))}
                      value={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a role type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {roleTypes?.map((type: RoleType) => (
                          <SelectItem key={type.id} value={type.id.toString()}>
                            {type.description}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => {
                  setDialogOpen(false);
                  form.reset();
                }}>
                  Cancel
                </Button>
                <Button type="submit">
                  {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingRole ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default RolesPage;