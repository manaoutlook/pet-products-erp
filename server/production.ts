
import express, { type Express } from "express";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { type Server } from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "..", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

export function startProductionServer(app: Express, server: Server) {
  const PORT = process.env.PORT || 5001;
  
  // Enhanced logging for production environment
  log(`PRODUCTION MODE: Node env: ${process.env.NODE_ENV}`, "startup");
  log(`Database URL configured: ${process.env.DATABASE_URL ? "Yes" : "No"}`, "database");
  log(`Session secret configured: ${process.env.SESSION_SECRET ? "Yes" : "No"}`, "session");
  
  // Add comprehensive debugging routes
  
  // Health check endpoint with detailed diagnostics
  app.get("/api/health", async (req, res) => {
    try {
      // Import database module dynamically to avoid circular dependencies
      const { db } = await import("../db/index.js");
      // Try a simple query to verify database connection
      const result = await db.execute("SELECT 1 as connected");
      
      // Check session configuration
      const sessionConfigured = !!process.env.SESSION_SECRET || !!process.env.REPL_ID;
      
      log(`Health check - Database connected: ${!!result}`, "health");
      return res.json({ 
        status: "ok", 
        database: "connected",
        session: sessionConfigured ? "configured" : "missing",
        environment: process.env.NODE_ENV,
        port: PORT,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      log(`Health check - Database error: ${error.message}`, "health");
      return res.status(500).json({ 
        status: "error", 
        database: "disconnected",
        error: error.message,
        environment: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // Add a debug route to show user sessions
  app.get("/api/debug/session", (req, res) => {
    if (process.env.NODE_ENV !== "production" || req.query.secret === process.env.DEBUG_SECRET) {
      return res.json({
        session: req.session,
        isAuthenticated: req.isAuthenticated(),
        user: req.user || null,
        cookies: req.headers.cookie
      });
    }
    return res.status(403).json({ message: "Unauthorized debug request" });
  });
  
  // Add a debug route for auth testing
  app.post("/api/debug/login-test", async (req, res) => {
    if (process.env.NODE_ENV !== "production" || req.query.secret === process.env.DEBUG_SECRET) {
      try {
        const { username, password } = req.body;
        log(`Debug login test for username: ${username}`, "debug");
        
        const { db } = await import("../db/index.js");
        const { crypto } = await import("./auth.js");
        const { users, roles } = await import("../db/schema.js");
        const { eq } = await import("drizzle-orm");
        
        // Get user from database
        const usersResult = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);
        
        if (usersResult.length === 0) {
          return res.json({ 
            status: "error", 
            message: "User not found",
            step: "user-query"
          });
        }
        
        const user = usersResult[0];
        
        // Get role
        const rolesResult = await db
          .select()
          .from(roles)
          .where(eq(roles.id, user.roleId))
          .limit(1);
        
        if (rolesResult.length === 0) {
          return res.json({ 
            status: "error", 
            message: "Role not found",
            step: "role-query"
          });
        }
        
        // Test password comparison
        try {
          const isMatch = await crypto.compare(password, user.password);
          return res.json({
            status: "success",
            passwordMatch: isMatch,
            user: {
              id: user.id,
              username: user.username,
              role: rolesResult[0]
            }
          });
        } catch (err: any) {
          return res.json({
            status: "error",
            message: err.message,
            step: "password-compare"
          });
        }
      } catch (error: any) {
        return res.json({
          status: "error",
          message: error.message,
          stack: error.stack
        });
      }
    }
    return res.status(403).json({ message: "Unauthorized debug request" });
  });
  
  server.listen(PORT, "0.0.0.0")
    .on("listening", () => {
      log(`Production server running on port ${PORT}`, "startup");
    })
    .on("error", (err: any) => {
      log(`Failed to start production server: ${err.message}`, "startup");
      throw err;
    });
}
