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
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

function RolePermissionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: roles, isLoading: isLoadingRoles } = useQuery<Role[]>({
    queryKey: ['/api/roles'],
    staleTime: 0, // Disable automatic background updates
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

  if (isLoadingRoles) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-3xl font-bold tracking-tight">Role Permissions</h1>

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