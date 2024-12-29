import { Request, Response, NextFunction } from 'express';
import { db } from "@db";
import { roles } from "@db/schema";
import { eq } from "drizzle-orm";

// Role-based middleware with permission checks
export function requireRole(allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send('Not authenticated');
    }

    if (!req.user || !req.user.role) {
      return res.status(403).send('Access denied: No role assigned');
    }

    // Get the full role details including permissions
    const role = await db.query.roles.findFirst({
      where: eq(roles.id, req.user.role.id), // Changed from roleId to role.id
    });

    if (!role || !allowedRoles.includes(role.name)) {
      return res.status(403).send('Access denied: Insufficient permissions');
    }

    // Attach role and permissions to the request for use in routes
    req.user.role = role;
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

    // Get the full role details including permissions
    const role = await db.query.roles.findFirst({
      where: eq(roles.id, req.user.role.id), // Changed from roleId to role.id
    });

    if (!role || !role.permissions) {
      return res.status(403).send('Access denied: No permissions defined');
    }

    // Check if the role has the required permission
    const modulePermissions = role.permissions[module as keyof typeof role.permissions];
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