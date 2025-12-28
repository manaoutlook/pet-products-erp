import { useQuery } from "@tanstack/react-query";

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
  purchase: Permission & {
    invoice: boolean;
    payment: boolean;
    receipt: boolean;
  };
  inventoryTransfer: Permission & {
    approve: boolean;
    execute: boolean;
    reject: boolean;
  };
}

interface Role {
  id: number;
  name: string;
  isSystemAdmin: boolean;
  permissions: Permissions;
}

import { useUser } from "./use-user";

export function usePermissions() {
  const { user } = useUser();

  const hasPermission = (module: keyof Permissions, action: string): boolean => {
    const u = user as any;
    if (!u?.role) {
      console.log(`[PermissionCheck] No role for user ${u?.username}, denying ${module}.${action}`);
      return false;
    }

    // Admin role always has all permissions
    const roleName = u.role.name.toLowerCase();
    if (roleName === 'admin' || u.role.isSystemAdmin === true) {
      return true;
    }

    if (!u.role.permissions) {
      console.log(`[PermissionCheck] No permissions object for role ${u.role.name}, denying ${module}.${action}`);
      return false;
    }

    const modulePermissions = u.role.permissions[module];
    const granted = !!modulePermissions?.[action];

    if (!granted) {
      console.log(`[PermissionCheck] Access denied for ${u.username} (${u.role.name}): ${module}.${action} is ${modulePermissions?.[action]}`);
    }

    return granted;
  };

  const getModulePermissions = (module: keyof Permissions): Permission | null => {
    if (!user?.role?.permissions) return null;
    return user.role.permissions[module] ?? null;
  };

  const getAllowedModules = (): (keyof Permissions)[] => {
    if (!user?.role?.permissions) return [];
    return Object.entries(user.role.permissions as Record<string, any>)
      .filter(([_, permissions]) => Object.values(permissions as Record<string, boolean>).some(allowed => allowed))
      .map(([module]) => module as keyof Permissions);
  };

  return {
    hasPermission,
    getModulePermissions,
    getAllowedModules,
    isAdmin: (user as any)?.role?.name?.toLowerCase() === 'admin' || (user as any)?.role?.isSystemAdmin === true,
    role: (user as any)?.role,
  };
}
