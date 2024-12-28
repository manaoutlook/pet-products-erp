import { Request, Response, NextFunction } from 'express';

// Role-based middleware
export function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send('Not authenticated');
    }

    if (!req.user || !req.user.role || !allowedRoles.includes(req.user.role.name)) {
      return res.status(403).send('Access denied: Insufficient permissions');
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