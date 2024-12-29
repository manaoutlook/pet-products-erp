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
}

interface Role {
  id: number;
  name: string;
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
    return Object.entries(user.role.permissions)
      .filter(([_, permissions]) => Object.values(permissions).some(allowed => allowed))
      .map(([module]) => module as keyof Permissions);
  };

  return {
    hasPermission,
    getModulePermissions,
    getAllowedModules,
    isAdmin: user?.role?.name === 'admin',
    role: user?.role,
  };
}
