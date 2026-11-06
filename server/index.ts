import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "@db";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

export const app = express();
// Bulk product import posts parsed spreadsheet rows as JSON, which can be far
// larger than the 100kb default (a 1000 row file is several hundred KB).
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false, limit: "10mb" }));

// Liveness/readiness probe for hosting platforms and uptime monitors. It is
// registered before the Vite/static catch-all so it always answers with JSON,
// and it verifies the database because a boot with a bad DATABASE_URL looks
// "up" otherwise (static assets still serve, every API call fails).
app.get("/api/health", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ status: "ok", db: "up", uptime: process.uptime() });
  } catch (error) {
    res.status(503).json({
      status: "error",
      db: "down",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Initialize routes and server instance
// We move this outside the async block so it runs when imported by tests
const server = registerRoutes(app);

// Error handling middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(status).json({ message });
  throw err;
});

// Only start the server if not running in test mode
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // Try to serve the app on $PORT (injected by most hosts), falling back to
    // 5001 for local runs, and probe the next port when it is already taken.
    // this serves both the API and the client
    const PORT = Number(process.env.PORT) || 5001;
    const MAX_RETRIES = 3;

    const startServer = (port: number, retries = 0) => {
      server.listen(port, "0.0.0.0")
        .on("listening", () => {
          log(`serving on port ${port}`);
        })
        .on("error", (err: any) => {
          if (err.code === 'EADDRINUSE' && retries < MAX_RETRIES) {
            log(`Port ${port} is in use, trying port ${port + 1}...`);
            server.close();
            startServer(port + 1, retries + 1);
          } else {
            log(`Failed to start server: ${err.message}`);
            throw err;
          }
        });
    };

    startServer(PORT);
  })();
}
