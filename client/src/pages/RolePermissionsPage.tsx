
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
  stores: Permission;
}

interface RoleType {
  id: number;
  description: string;
}

interface Role {
  id: number;
  name: string;
  description: string;
  permissions: Permissions;
  roleTypeId: number;
  roleType: RoleType;
}

function RolePermissionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<string>("all");
  const [selectedModule, setSelectedModule] = useState<string>("all");

  const { data: roles, isLoading: isLoadingRoles } = useQuery<Role[]>({
    queryKey: ['/api/roles'],
    staleTime: 0, // Disable automatic background updates
  });

  const updatePermissionsMutation = useMutation({
    mutationFn: async ({ 
      roleId, 
      permissions 
    }: { 
      roleId: number; 
      permissions: Permissions 
    }) => {
      const response = await fetch(`/api/roles/${roleId}/permissions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permissions }),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update permissions');
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Permissions updated",
        description: "Role permissions have been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/roles'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update permissions",
        variant: "destructive",
      });
    }
  });

  const handlePermissionChange = (
    roleId: number,
    moduleName: string,
    permissionName: string,
    value: boolean
  ) => {
    if (!roles) return;

    const role = roles.find(r => r.id === roleId);
    if (!role) return;

    // Create a deep copy of the current permissions
    const newPermissions = JSON.parse(JSON.stringify(role.permissions)) as Permissions;

    // Update the specific permission
    if (!newPermissions[moduleName as keyof Permissions]) {
      newPermissions[moduleName as keyof Permissions] = {
        create: false,
        read: false,
        update: false,
        delete: false
      };
    }
    newPermissions[moduleName as keyof Permissions][permissionName as keyof Permission] = value;

    // Submit the updated permissions
    updatePermissionsMutation.mutate({
      roleId,
      permissions: newPermissions
    });
  };

  const modules = [
    { key: 'products', label: 'Products' },
    { key: 'orders', label: 'Orders' },
    { key: 'inventory', label: 'Inventory' },
    { key: 'users', label: 'Users' },
    { key: 'stores', label: 'Stores' }
  ];

  const permissions = [
    { key: 'create', label: 'Create' },
    { key: 'read', label: 'Read' },
    { key: 'update', label: 'Update' },
    { key: 'delete', label: 'Delete' }
  ];

  const filteredRoles = selectedRole === "all" 
    ? roles 
    : roles?.filter(role => role.id.toString() === selectedRole);

  const filteredModules = selectedModule === "all"
    ? modules
    : modules.filter(module => module.key === selectedModule);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-3xl font-bold tracking-tight">Role Permissions</h1>
      <p className="text-muted-foreground">
        Configure permissions for each role in the system.
      </p>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-2">
        <div>
          <label className="block text-sm font-medium mb-1">Filter by Role</label>
          <Select
            value={selectedRole}
            onValueChange={setSelectedRole}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {roles?.map(role => (
                <SelectItem key={role.id} value={role.id.toString()}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Filter by Module</label>
          <Select
            value={selectedModule}
            onValueChange={setSelectedModule}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Module" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modules</SelectItem>
              {modules.map(module => (
                <SelectItem key={module.key} value={module.key}>
                  {module.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoadingRoles ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !roles?.length ? (
        <div className="text-center p-8">
          <p className="text-muted-foreground">No roles found.</p>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Role Permissions Matrix</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Role</TableHead>
                  {filteredModules.map(module => (
                    <TableHead key={module.key} className="text-center">
                      {module.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRoles?.map(role => (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">
                      <div>{role.name}</div>
                      <div className="text-xs text-muted-foreground">{role.roleType?.description}</div>
                    </TableCell>
                    {filteredModules.map(module => (
                      <TableCell key={module.key} className="text-center">
                        <div className="flex flex-col gap-2">
                          {permissions.map(permission => (
                            <div key={permission.key} className="flex items-center justify-between">
                              <span className="text-xs">{permission.label}</span>
                              <Switch
                                checked={role.permissions?.[module.key as keyof Permissions]?.[permission.key as keyof Permission] || false}
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
      )}
    </div>
  );
}

export default RolePermissionsPage;
