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
import { SearchableSelect } from "@/components/ui/searchable-select";
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
  /** The VAT Margin Calculator - its own module, so Orders access never implies it. */
  vatMargin: Permission;
  inventory: Permission;
  users: Permission;
  stores: Permission;
  masterData: Permission;
  vatCompanies: Permission;
  companyProfile: Permission;
  pos: Permission;
  receipts: Permission;
  finance: Permission;
  customerProfiles: Permission;
}

type ModuleKey = keyof Permissions;
type PermissionKey = keyof Permission;

interface ModuleDefinition {
  key: ModuleKey;
  label: string;
  /**
   * Actions the screen actually uses. Most modules use all four; a module that omits
   * this keeps the full View/Create/Edit/Delete column.
   */
  actions?: PermissionKey[];
}

interface Role {
  id: number;
  name: string;
  description: string | null;
  isSystemAdmin: boolean;
  permissions: Permissions;
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
    onSuccess: (data: any, variables: { roleId: number; permissions: Permissions }) => {
      queryClient.setQueryData<Role[]>(['/api/roles'], (oldRoles: Role[] | undefined) => {
        if (!oldRoles) return oldRoles;
        return oldRoles.map((role: Role) =>
          role.id === variables.roleId
            ? { ...role, permissions: variables.permissions }
            : role
        );
      });
      toast({ title: "Success", description: "Permissions updated successfully", variant: "success" });
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
    const role = roles?.find((r: Role) => r.id === roleId);
    if (!role) return;

    // Prevent modifying admin role permissions
    if (role.name === 'admin') {
      toast({
        title: "Warning",
        description: "Admin role permissions cannot be modified",
        variant: "destructive"
      });
      return;
    }

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

  const modules: ModuleDefinition[] = [
    { key: 'products' as const, label: 'Products Module' },
    { key: 'orders' as const, label: 'Orders Module (Purchasing & Sales)' },
    // View opens the screen and the statement; Edit saves the global margin/income-tax defaults.
    // There is nothing to create or delete, so the column shows two switches instead of four.
    { key: 'vatMargin' as const, label: 'VAT Margin Calculator Module', actions: ['read', 'update'] },
    { key: 'inventory' as const, label: 'Inventory Module' },
    { key: 'users' as const, label: 'User Management Module' },
    { key: 'stores' as const, label: 'Store Management Module' },
    { key: 'masterData' as const, label: 'Master Data Module' },
    // The shop's own letterhead. Every signed-in user can read it - the band at the top of every
    // screen and every printed document renders it - so View is what opens the edit screen;
    // Edit is what actually changes it. Nothing is created or deleted (the table holds one row),
    // so the column shows two switches instead of four.
    { key: 'companyProfile' as const, label: 'Company Profile Module', actions: ['read', 'update'] },
    // The legal entities that issue VAT invoices. View opens the screen (the list itself stays
    // readable to anyone who can open a sales order - its form has to render the choice), Create
    // adds a company and starts its invoice sequence, Edit changes its details and VAT rate.
    // Nothing deletes a company, so the column shows three switches instead of four.
    { key: 'vatCompanies' as const, label: 'VAT Companies Module', actions: ['read', 'create', 'update'] },
    { key: 'pos' as const, label: 'Point of Sales Module' },
    { key: 'receipts' as const, label: 'Receipts Module' },
    { key: 'finance' as const, label: 'Financial Accounts Module' },
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
    : roles?.filter((role: Role) => role.id.toString() === selectedRole);

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
        <CardContent className="flex flex-wrap gap-4">
          {/* The role names plus their descriptions need real width: the dropdown list is sized to
              the trigger, so a narrow trigger truncates the names themselves. */}
          <div className="w-full sm:w-[400px]">
            <SearchableSelect
              value={selectedRole}
              onChange={(value) => setSelectedRole(value ?? "all")}
              options={[
                { value: "all", label: "All Roles" },
                ...(roles ?? []).map((role: Role) => ({
                  value: role.id.toString(),
                  label: role.name,
                  description: role.description,
                })),
              ]}
              placeholder="Select Role"
              searchPlaceholder="Search roles..."
              emptyMessage="No role found."
            />
          </div>
          <div className="w-full sm:w-[400px]">
            <SearchableSelect
              value={selectedModule}
              onChange={(value) => setSelectedModule(value ?? "all")}
              options={[
                { value: "all", label: "All Modules" },
                ...modules.map((module) => ({
                  value: module.key,
                  label: module.label,
                })),
              ]}
              placeholder="Select Module"
              searchPlaceholder="Search modules..."
              emptyMessage="No module found."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manage Role Permissions</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Permission matrix: module columns have their own floor, the wrapper
              keeps the whole matrix scrollable on small screens. */}
          <Table className="min-w-[800px]">
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
              {filteredRoles?.map((role: Role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-medium">
                    <div>
                      <p>{role.name}</p>
                      {role.description && <p className="text-sm text-muted-foreground">{role.description}</p>}
                    </div>
                  </TableCell>
                  {filteredModules.map(module => {
                    // Modules that declare their actions hide the switches they do not use.
                    const moduleActions = module.actions ?? permissions.map(permission => permission.key);

                    return (
                      <TableCell key={module.key}>
                        <div className="space-y-2">
                          {permissions
                            .filter(permission => moduleActions.includes(permission.key))
                            .map(permission => (
                              <div key={permission.key} className="flex items-center justify-between gap-2">
                                <span className="text-sm">{permission.label}</span>
                                <Switch
                                  checked={role.name === 'admin' ? true : (role.permissions[module.key]?.[permission.key] ?? false)}
                                  onCheckedChange={(checked) => {
                                    handlePermissionChange(role.id, module.key, permission.key, checked);
                                  }}
                                  disabled={updatePermissionsMutation.isPending}
                                />
                              </div>
                            ))}
                        </div>
                      </TableCell>
                    );
                  })}
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
