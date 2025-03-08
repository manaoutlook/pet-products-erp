import * as dotenv from "dotenv";
// Load environment variables at the very beginning
dotenv.config();

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

(async () => {
  const server = registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Try to serve the app on port 5001, fall back to alternative ports if needed
  // this serves both the API and the client
  const PORT = 5001;
  const MAX_RETRIES = 3;
  
  const startServer = (port: number, retries = 0) => {
    server.listen(port, "0.0.0.0")
      .on("listening", () => {
        const address = server.address();
        log(`serving on ${typeof address === 'object' ? `${address?.address}:${address?.port}` : port}`);
        log(`DATABASE_URL configured: ${process.env.DATABASE_URL ? "Yes" : "No"}`);
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
