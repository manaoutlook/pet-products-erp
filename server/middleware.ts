import { Request, Response, NextFunction } from 'express';
import { checkHierarchicalPermission, roleCan } from '../shared/permissions';

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

// Hierarchical rules live in shared/permissions.ts so the client can apply the very
// same check when it decides whether to render a screen.

/**
 * Grants the request when the role holds AT LEAST ONE of the listed permissions.
 *
 * Needed where one dataset is consumed by two screens with different modules: the VAT company
 * list feeds the VAT Companies screen (`vatCompanies.read`) and the sales-order form
 * (`orders.read`), so a role may hold either and still open the list. Same hierarchy rules and
 * same admin bypass as `requirePermission`, because it asks `roleCan` the same question.
 */
export function requireAnyPermission(
  ...allowed: Array<{ module: string; action: 'create' | 'read' | 'update' | 'delete' }>
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send('Not authenticated');
    }

    if (!req.user || !req.user.role) {
      return res.status(403).send('Access denied: No role assigned');
    }

    const granted = allowed.find(({ module, action }) =>
      roleCan(req.user!.role, module, action)
    );

    if (!granted) {
      return res.status(403).json({
        message: `Access denied: requires ${allowed
          .map(({ module, action }) => `${module} ${action}`)
          .join(' or ')} permission`,
        permission: {
          module: allowed[0].module,
          action: allowed[0].action,
          granted: false,
          hierarchyLevel: req.user.role.hierarchyLevel || 'staff',
        },
      });
    }

    req.permissions = {
      module: granted.module,
      action: granted.action,
      granted: true,
      hierarchyLevel: req.user.role.hierarchyLevel || 'staff',
    };

    next();
  };
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
