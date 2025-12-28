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

// Permission check middleware
export function requirePermission(module: string, action: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send('Not authenticated');
    }

    if (!req.user || !req.user.role) {
      return res.status(403).send('Access denied: No role assigned');
    }

    // Admin role always has all permissions
    if (req.user.role.name === 'admin') {
      // Add permissions to the request for use in routes
      req.permissions = {
        module,
        action,
        granted: true
      };
      return next();
    }

    if (!req.user.role.permissions) {
      return res.status(403).send('Access denied: No permissions defined');
    }

    // Check if the role has the required permission
    const modulePermissions = (req.user.role.permissions as any)[module];
    if (!modulePermissions || !modulePermissions[action]) {
      return res.status(403).json({
        message: `Access denied: Insufficient ${module} ${action} permission`,
        permission: {
          module,
          action,
          granted: false
        }
      });
    }

    // Add permissions to the request for use in routes
    req.permissions = {
      module,
      action,
      granted: true
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
      };
    }
  }
}