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
}

interface Role {
  id: number;
  name: string;
  isSystemAdmin: boolean;
  permissions: Permissions;
}

interface User {
  id: number;
  username: string;
  role: Role;
}

export function usePermissions() {
  const { data: user } = useQuery<User>({
    queryKey: ['/api/user'],
  });

  const hasPermission = (module: keyof Permissions, action: keyof Permission): boolean => {
    if (!user?.role?.permissions) return false;
    return user.role.permissions[module]?.[action] ?? false;
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
    isAdmin: user?.role?.name === 'admin' || user?.role?.isSystemAdmin === true,
    role: user?.role,
  };
}
