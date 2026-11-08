import "dotenv/config";
import net from "node:net";
import { sql } from "drizzle-orm";
import { db } from "@db";
import express from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { errorHandler } from "./error-handler";

// `tsx watch` and `node dist/index.js` both end silently when the process dies
// from an unhandled error, and under `tsx watch` the supervisor then just sits
// there with no child (it only restarts on a file change), which looks like
// "the dev server vanished". Log the reason and keep the default crash
// behaviour so the failure is visible in the terminal instead of mysterious.
if (process.env.NODE_ENV !== "test") {
  process.on("unhandledRejection", (reason) => {
    console.error("[fatal] Unhandled promise rejection:", reason);
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    console.error("[fatal] Uncaught exception:", err);
    process.exit(1);
  });
}

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

// Error handling middleware - must stay the last app.use(...) registration.
app.use(errorHandler);

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

    // Serve on $PORT (injected by most hosts), falling back to 5001 for local
    // runs. Probing a busy port lets local dev survive a leftover process, but
    // it must be done on a throwaway socket: re-listening on the same http.Server
    // stacks duplicate 'listening'/'error' listeners, so one process ended up
    // answering on two ports at once and the browser silently talked to a stale
    // instance (or to nothing) while the terminal still looked healthy.
    const PORT = Number(process.env.PORT) || 5001;
    const MAX_RETRIES = 3;

    const isPortFree = (port: number): Promise<boolean> =>
      new Promise((resolve) => {
        const probe = net.createServer();
        probe.unref();
        probe.once("error", () => resolve(false));
        probe.once("listening", () => probe.close(() => resolve(true)));
        probe.listen(port, "0.0.0.0");
      });

    const findFreePort = async (start: number, retries: number) => {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const candidate = start + attempt;
        if (await isPortFree(candidate)) return candidate;
        if (attempt < retries) {
          log(`Port ${candidate} is in use, trying port ${candidate + 1}...`);
        }
      }
      return null;
    };

    const port = await findFreePort(PORT, MAX_RETRIES);

    if (port === null) {
      log(
        `Failed to start server: ports ${PORT}-${PORT + MAX_RETRIES} are all in use. ` +
          `Stop the process holding port ${PORT} (e.g. \`lsof -ti:${PORT} | xargs kill\`) and restart.`,
      );
      process.exit(1);
    }

    server.once("listening", () => {
      log(`serving on port ${port}`);
    });
    server.once("error", (err: any) => {
      log(`Failed to start server: ${err.message}`);
      process.exit(1);
    });
    server.listen(port, "0.0.0.0");
  })();
}
