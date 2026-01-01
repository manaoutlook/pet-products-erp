import { Request, Response, NextFunction } from 'express';

// Role-based middleware with permission checks
export function requireRole(allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send('Not authenticated');
    }

    if (!req.user || !req.user.role) {
      return res.status(403).send('Access denied: No role assigned');
    }

    // Admin role always has access
    if (req.user.role.name === 'admin') {
      return next();
    }

    if (!allowedRoles.includes(req.user.role.name)) {
      return res.status(403).send('Access denied: Insufficient permissions');
    }

    next();
  };
}

// Permission check middleware with hierarchical access control
export function requirePermission(module: string, action: 'create' | 'read' | 'update' | 'delete') {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send('Not authenticated');
    }

    if (!req.user || !req.user.role) {
      return res.status(403).send('Access denied: No role assigned');
    }

    // Admin role always has all permissions
    if (req.user.role.name === 'admin') {
      req.permissions = {
        module,
        action,
        granted: true,
        hierarchyLevel: 'admin'
      };
      return next();
    }

    // Check hierarchical permissions based on user role level
    const hierarchyLevel = req.user.role.hierarchyLevel || 'staff';
    const hasPermission = checkHierarchicalPermission(hierarchyLevel, module, action, req.user.role.permissions);

    if (!hasPermission) {
      return res.status(403).json({
        message: `Access denied: Insufficient ${module} ${action} permission`,
        permission: {
          module,
          action,
          granted: false,
          hierarchyLevel
        }
      });
    }

    // Add permissions to the request for use in routes
    req.permissions = {
      module,
      action,
      granted: true,
      hierarchyLevel
    };

    next();
  };
}

// Helper function to check hierarchical permissions
function checkHierarchicalPermission(
  hierarchyLevel: string,
  module: string,
  action: string,
  rolePermissions?: any
): boolean {
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
    if (module === 'transfers') return true;
    if (module === 'inventory') return true;
    if (module === 'purchaseOrders') return true; // Can approve POs in their region
  }

  // Staff have only basic permissions defined in their role
  if (hierarchyLevel === 'staff') {
    if (!rolePermissions) return false;
    const modulePermissions = rolePermissions[module];
    return !!(modulePermissions && modulePermissions[action]);
  }

  // Default deny for unknown hierarchy levels
  return false;
}

// Authentication check middleware
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).send('Not authenticated');
  }
  next();
}

// Add permissions property to Request type
declare global {
  namespace Express {
    interface Request {
      permissions?: {
        module: string;
        action: string;
        granted: boolean;
        hierarchyLevel?: string;
      };
    }
  }
}
