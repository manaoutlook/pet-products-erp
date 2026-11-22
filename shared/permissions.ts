/**
 * Permission rules shared by the API and the client.
 *
 * The server enforces these in `requirePermission` (server/middleware.ts) and the
 * client uses the same function to decide which screens to render
 * (client/src/components/auth/RequirePermission.tsx). Keeping one implementation
 * means a role can never see a screen the API will refuse, or lose a screen the API
 * would have allowed.
 */

export type PermissionAction = 'create' | 'read' | 'update' | 'delete';

export interface ModulePermission {
  create?: boolean;
  read?: boolean;
  update?: boolean;
  delete?: boolean;
}

/** `role.permissions` as stored in the database: `{ inventory: { read: true, … }, … }`. */
export type RolePermissions = Record<string, ModulePermission | undefined> | null | undefined;

export type HierarchyLevel = 'admin' | 'global_manager' | 'regional_manager' | 'staff';

/** The parts of a role the permission rules care about. */
export interface PermissionRole {
  name?: string | null;
  hierarchyLevel?: string | null;
  isSystemAdmin?: boolean | null;
  permissions?: RolePermissions;
}

/**
 * Hierarchical permission check, mirroring the rules the API has always applied.
 *
 * - admin / system admin: everything.
 * - global_manager: everything except user management.
 * - regional_manager: inventory, transfers, purchase orders and day-to-day user
 *   management, but no user deletion.
 * - staff (and anything unknown): only what the role's permission JSON grants.
 */
export function checkHierarchicalPermission(
  hierarchyLevel: string,
  module: string,
  action: string,
  rolePermissions?: RolePermissions,
): boolean {
  if (hierarchyLevel === 'admin') {
    return true;
  }

  // Global managers have all permissions except admin-only actions
  if (hierarchyLevel === 'global_manager') {
    // Global managers can do everything except user management (admin only)
    if (module === 'users') return false;
    return true;
  }

  // Regional managers have regional permissions
  if (hierarchyLevel === 'regional_manager') {
    // Regional managers can approve transfers, manage inventory, but not global user management
    if (module === 'users' && action === 'delete') return false;
    if (module === 'users' && (action === 'read' || action === 'create' || action === 'update')) return true; // Allow reading/creating/updating users for region management
    if (module === 'transfers') return true;
    if (module === 'inventory') return true;
    if (module === 'purchaseOrders') return true; // Can approve POs in their region
  }

  // Staff have only basic permissions defined in their role
  if (hierarchyLevel === 'staff') {
    if (!rolePermissions) return false;
    const modulePermissions = rolePermissions[module];
    return !!(modulePermissions && modulePermissions[action as PermissionAction]);
  }

  // Default deny for unknown hierarchy levels
  return false;
}

/**
 * Is this role an administrator? The one rule the API and the UI share for "may do
 * anything, everywhere": the named `admin` role or the system-admin flag. Kept here so a
 * screen that gates a control on it and the endpoint that enforces it cannot drift apart.
 */
export function isAdminRole(role: PermissionRole | null | undefined): boolean {
  if (!role) return false;
  return role.name === 'admin' || role.isSystemAdmin === true;
}

/**
 * Does this role grant `action` on `module`? Wraps the hierarchy rules above with the
 * admin bypass both the API and the sidebar apply.
 */
export function roleCan(
  role: PermissionRole | null | undefined,
  module: string,
  action: PermissionAction,
): boolean {
  if (!role) return false;
  if (isAdminRole(role)) return true;
  return checkHierarchicalPermission(role.hierarchyLevel || 'staff', module, action, role.permissions);
}
