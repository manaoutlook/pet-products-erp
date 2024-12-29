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

    if (!allowedRoles.includes(req.user.role.name)) {
      return res.status(403).send('Access denied: Insufficient permissions');
    }

    next();
  };
}

// Permission check middleware
export function requirePermission(module: string, action: 'create' | 'read' | 'update' | 'delete') {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send('Not authenticated');
    }

    if (!req.user || !req.user.role) {
      return res.status(403).send('Access denied: No role assigned');
    }

    if (!req.user.role.permissions) {
      return res.status(403).send('Access denied: No permissions defined');
    }

    // Check if the role has the required permission
    const modulePermissions = req.user.role.permissions[module];
    if (!modulePermissions || !modulePermissions[action]) {
      return res.status(403).send(`Access denied: Insufficient ${module} ${action} permission`);
    }

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