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
}

interface RoleType {
  id: number;
  description: string;
}

interface Role {
  id: number;
  name: string;
  permissions: Permissions;
  roleType: RoleType;
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
    console.log('Checking permission:', { module, action, role: user?.role });

    if (!user?.role?.permissions) {
      console.log('No permissions found for user');
      return false;
    }

    const modulePermissions = user.role.permissions[module];
    const hasAccess = modulePermissions?.[action] ?? false;

    console.log('Permission check result:', {
      module,
      action,
      hasAccess,
      modulePermissions
    });

    return hasAccess;
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

  const isAdmin = user?.role?.name === 'admin';
  const isSystemAdmin = user?.role?.roleType?.description === 'System Administrator';

  console.log('Permissions context:', {
    isAdmin,
    isSystemAdmin,
    allowedModules: getAllowedModules(),
    role: user?.role
  });

  return {
    hasPermission,
    getModulePermissions,
    getAllowedModules,
    isAdmin,
    isSystemAdmin,
    role: user?.role,
  };
}