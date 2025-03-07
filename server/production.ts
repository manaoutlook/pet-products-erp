
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
  
  // Log environment variables (excluding sensitive info)
  log(`PRODUCTION MODE: Node env: ${process.env.NODE_ENV}`, "startup");
  log(`Database URL configured: ${process.env.DATABASE_URL ? "Yes" : "No"}`, "database");
  
  // Add a diagnostic route for checking database connection
  app.get("/api/health", async (req, res) => {
    try {
      // Import database module dynamically to avoid circular dependencies
      const { db } = await import("../db/index.js");
      // Try a simple query to verify database connection
      const result = await db.execute("SELECT 1 as connected");
      log(`Health check - Database connected: ${!!result}`, "health");
      return res.json({ 
        status: "ok", 
        database: "connected",
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      log(`Health check - Database error: ${error.message}`, "health");
      return res.status(500).json({ 
        status: "error", 
        database: "disconnected",
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
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
