import { useQuery } from "@tanstack/react-query";
import {
  roleCan,
  type PermissionAction,
  type RolePermissions,
} from "@shared/permissions";

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
  masterData: Permission;
  pos: Permission;
  receipts: Permission;
  customerProfiles: Permission;
}

interface Role {
  id: number;
  name: string;
  isSystemAdmin: boolean;
  hierarchyLevel?: string | null;
  permissions: RolePermissions;
}

interface User {
  id: number;
  username: string;
  role: Role;
}

export function usePermissions() {
  const { data: user, isLoading } = useQuery<User>({
    queryKey: ['/api/user'],
  });

  /**
   * The same rule the API applies (shared/permissions.ts), so the UI cannot offer a
   * screen or a button the server will answer with 403.
   */
  const can = (module: string, action: PermissionAction): boolean => roleCan(user?.role, module, action);

  const hasPermission = (module: keyof Permissions, action: keyof Permission): boolean =>
    can(module, action as PermissionAction);

  const getModulePermissions = (module: keyof Permissions): Permission | null => {
    if (!user?.role?.permissions) return null;
    return (user.role.permissions[module] as Permission) ?? null;
  };

  const getAllowedModules = (): (keyof Permissions)[] => {
    if (!user?.role?.permissions) return [];
    return Object.entries(user.role.permissions as Record<string, any>)
      .filter(([_, permissions]) => Object.values(permissions as Record<string, boolean>).some(allowed => allowed))
      .map(([module]) => module as keyof Permissions);
  };

  return {
    can,
    hasPermission,
    getModulePermissions,
    getAllowedModules,
    isAdmin: user?.role?.name === 'admin' || user?.role?.isSystemAdmin === true,
    role: user?.role,
    /** True while the session/role is still being fetched. */
    isLoading,
  };
}
