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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";

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
  customerProfiles: Permission;
}

interface Role {
  id: number;
  name: string;
  description: string | null;
  permissions: Permissions;
  roleLocation: {
    description: string;
  };
}

function RolePermissionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<string>("all");
  const [selectedModule, setSelectedModule] = useState<string>("all");

  const { data: roles, isLoading: isLoadingRoles } = useQuery<Role[]>({
    queryKey: ['/api/roles'],
    staleTime: 0,
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

    // Create a new permissions object with the updated value and ensure all modules exist
    const newPermissions = {
      products: { create: false, read: false, update: false, delete: false },
      orders: { create: false, read: false, update: false, delete: false },
      inventory: { create: false, read: false, update: false, delete: false },
      users: { create: false, read: false, update: false, delete: false },
      customerProfiles: { create: false, read: false, update: false, delete: false },
      ...role.permissions,
      [module]: {
        ...{ create: false, read: false, update: false, delete: false },
        ...(role.permissions[module] || {}),
        [permission]: value
      }
    };

    try {
      await updatePermissionsMutation.mutateAsync({
        roleId,
        permissions: newPermissions
      });
    } catch (error) {
      console.error('Failed to update permissions:', error);
    }
  };

  const modules = [
    { key: 'products' as const, label: 'Products Module' },
    { key: 'orders' as const, label: 'Orders Module' },
    { key: 'inventory' as const, label: 'Inventory Module' },
    { key: 'users' as const, label: 'User Management Module' },
    { key: 'customerProfiles' as const, label: 'Customer Profiles Module' },
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

  // Filter roles and modules based on selection
  const filteredRoles = selectedRole === "all"
    ? roles
    : roles?.filter(role => role.id.toString() === selectedRole);

  const filteredModules = selectedModule === "all"
    ? modules
    : modules.filter(module => module.key === selectedModule);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-3xl font-bold tracking-tight">Role Permissions</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          <div className="w-[200px]">
            <Select
              value={selectedRole}
              onValueChange={setSelectedRole}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {roles?.map((role) => (
                  <SelectItem key={role.id} value={role.id.toString()}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[200px]">
            <Select
              value={selectedModule}
              onValueChange={setSelectedModule}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select Module" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modules</SelectItem>
                {modules.map((module) => (
                  <SelectItem key={module.key} value={module.key}>
                    {module.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manage Role Permissions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Role</TableHead>
                {filteredModules.map(module => (
                  <TableHead key={module.key} className="text-center min-w-[200px]">
                    {module.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRoles?.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-medium">
                    <div>
                      <p>{role.name}</p>
                      <p className="text-sm text-muted-foreground">{role.roleLocation.description}</p>
                    </div>
                  </TableCell>
                  {filteredModules.map(module => (
                    <TableCell key={module.key}>
                      <div className="space-y-2">
                        {permissions.map(permission => (
                          <div key={permission.key} className="flex items-center justify-between gap-2">
                            <span className="text-sm">{permission.label}</span>
                            <Switch
                              checked={role.permissions[module.key]?.[permission.key] ?? false}
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