import express, { type Express } from "express";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { type Server } from "http";
import { db } from "@db";
import session from "express-session";
import MemoryStore from "memorystore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create MemoryStore instance
const MemoryStoreSession = MemoryStore(session);

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

  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

export async function startProductionServer(app: Express, server: Server) {
  const PORT = process.env.PORT || 5001;

  // Set up session middleware with secure configuration
  const sessionSecret = process.env.SESSION_SECRET || process.env.REPL_ID || 'fallback-secret-key-change-in-production';

  app.use(session({
    secret: sessionSecret,
    saveUninitialized: false,
    resave: false,
    store: new MemoryStoreSession({
      checkPeriod: 86400000 // prune expired entries every 24h
    }),
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  // Parse JSON bodies
  app.use(express.json());

  // Enhanced logging for production environment
  log(`PRODUCTION MODE: Node env: ${process.env.NODE_ENV}`, "startup");
  log(`Database URL configured: ${process.env.DATABASE_URL ? "Yes" : "No"}`, "database");
  log(`Session secret configured: ${sessionSecret ? "Yes" : "No"}`, "session");

  // Test database connection
  try {
    await db.execute("SELECT 1 as db_check");
    log("Database connection successful", "startup");
  } catch (error) {
    log(`Database connection failed: ${error}`, "startup");
    throw error;
  }

  // Health check endpoint
  app.get("/api/health", async (req, res) => {
    try {
      const result = await db.execute("SELECT 1 as connected");
      const sessionConfigured = !!sessionSecret;

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

  return new Promise((resolve, reject) => {
    server.listen(PORT)
      .once('listening', () => {
        log(`Production server running on port ${PORT}`, "startup");
        resolve(server);
      })
      .once('error', (err) => {
        log(`Failed to start production server: ${err.message}`, "startup");
        reject(err);
      });
  });
}