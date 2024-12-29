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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

interface Permission {
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
}

interface Permissions {
  products: Permission;
  orders: Permission;
  inventory: Permission;
  users: Permission;
}

interface Role {
  id: number;
  name: string;
  description: string | null;
  permissions: Permissions;
  roleType: {
    description: string;
  };
}

interface RoleType {
  id: number;
  description: string;
}

const formSchema = z.object({
  name: z.string().min(2, 'Role name must be at least 2 characters'),
  description: z.string().optional(),
  roleTypeId: z.string().min(1, 'Role type is required'),
  permissions: z.object({
    products: z.object({
      create: z.boolean(),
      read: z.boolean(),
      update: z.boolean(),
      delete: z.boolean(),
    }),
    orders: z.object({
      create: z.boolean(),
      read: z.boolean(),
      update: z.boolean(),
      delete: z.boolean(),
    }),
    inventory: z.object({
      create: z.boolean(),
      read: z.boolean(),
      update: z.boolean(),
      delete: z.boolean(),
    }),
    users: z.object({
      create: z.boolean(),
      read: z.boolean(),
      update: z.boolean(),
      delete: z.boolean(),
    }),
  }),
});

type FormValues = z.infer<typeof formSchema>;

function RolePermissionsPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      roleTypeId: '',
      permissions: {
        products: { create: false, read: true, update: false, delete: false },
        orders: { create: false, read: true, update: false, delete: false },
        inventory: { create: false, read: true, update: false, delete: false },
        users: { create: false, read: false, update: false, delete: false },
      },
    },
  });

  const { data: roles, isLoading: isLoadingRoles } = useQuery<Role[]>({
    queryKey: ['/api/roles'],
    staleTime: 0, // Disable automatic background updates
  });

  const { data: roleTypes, isLoading: isLoadingRoleTypes } = useQuery<RoleType[]>({
    queryKey: ['/api/role-types'],
  });

  const createRoleMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const res = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          roleTypeId: parseInt(data.roleTypeId),
          permissions: data.permissions,
        }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Role created successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/roles'] });
      setOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const updatePermissionsMutation = useMutation({
    mutationFn: async ({ roleId, permissions }: { roleId: number; permissions: Permissions }) => {
      const res = await fetch(`/api/roles/${roleId}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data, variables) => {
      // Update the roles cache optimistically to maintain order
      queryClient.setQueryData<Role[]>(['/api/roles'], (oldRoles) => {
        if (!oldRoles) return oldRoles;
        return oldRoles.map(role => 
          role.id === variables.roleId 
            ? { ...role, permissions: variables.permissions }
            : role
        );
      });
      toast({ title: "Success", description: "Permissions updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
      // Invalidate the cache to refetch the correct data
      queryClient.invalidateQueries({ queryKey: ['/api/roles'] });
    },
  });

  const handlePermissionChange = async (
    roleId: number,
    module: keyof Permissions,
    permission: keyof Permission,
    value: boolean
  ) => {
    const role = roles?.find(r => r.id === roleId);
    if (!role) return;

    // Create a new permissions object with the updated value
    const newPermissions = {
      ...role.permissions,
      [module]: {
        ...role.permissions[module],
        [permission]: value
      }
    };

    try {
      await updatePermissionsMutation.mutateAsync({
        roleId,
        permissions: newPermissions
      });
    } catch (error) {
      // Error handling is done in mutation's onError callback
      console.error('Failed to update permissions:', error);
    }
  };

  const onSubmit = async (data: FormValues) => {
    await createRoleMutation.mutateAsync(data);
  };

  const modules = [
    { key: 'products' as const, label: 'Products Module' },
    { key: 'orders' as const, label: 'Orders Module' },
    { key: 'inventory' as const, label: 'Inventory Module' },
    { key: 'users' as const, label: 'User Management Module' },
  ];

  const permissions = [
    { key: 'read' as const, label: 'View' },
    { key: 'create' as const, label: 'Create' },
    { key: 'update' as const, label: 'Edit' },
    { key: 'delete' as const, label: 'Delete' },
  ];

  if (isLoadingRoles || isLoadingRoleTypes) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Role Permissions</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Role
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Role</DialogTitle>
              <DialogDescription>
                Add a new role with specific permissions for different modules.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter role name" {...field} />
                      </FormControl>
                      <FormDescription>
                        Choose a unique name for this role
                      </FormDescription>
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
                        <Input placeholder="Enter role description" {...field} />
                      </FormControl>
                      <FormDescription>
                        Briefly describe the purpose of this role
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="roleTypeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role Category</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a role category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {roleTypes?.map((type) => (
                            <SelectItem key={type.id} value={type.id.toString()}>
                              {type.description}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Choose the category this role belongs to
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {modules.map(module => (
                  <div key={module.key} className="space-y-2">
                    <h3 className="font-medium">{module.label}</h3>
                    <div className="space-y-2">
                      {permissions.map(permission => (
                        <FormField
                          key={permission.key}
                          control={form.control}
                          name={`permissions.${module.key}.${permission.key}`}
                          render={({ field }) => (
                            <FormItem className="flex items-center justify-between">
                              <FormLabel className="text-sm">{permission.label}</FormLabel>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                <Button type="submit" disabled={createRoleMutation.isPending}>
                  {createRoleMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Create Role
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Manage Role Permissions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Role</TableHead>
                {modules.map(module => (
                  <TableHead key={module.key} className="text-center min-w-[200px]">
                    {module.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles?.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-medium">
                    <div>
                      <p>{role.name}</p>
                      <p className="text-sm text-muted-foreground">{role.roleType.description}</p>
                    </div>
                  </TableCell>
                  {modules.map(module => (
                    <TableCell key={module.key}>
                      <div className="space-y-2">
                        {permissions.map(permission => (
                          <div key={permission.key} className="flex items-center justify-between gap-2">
                            <span className="text-sm">{permission.label}</span>
                            <Switch
                              checked={role.permissions[module.key][permission.key]}
                              onCheckedChange={(checked) => {
                                handlePermissionChange(role.id, module.key, permission.key, checked);
                              }}
                              disabled={
                                role.name === 'admin' || // Admin role always has full permissions
                                updatePermissionsMutation.isPending
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default RolePermissionsPage;