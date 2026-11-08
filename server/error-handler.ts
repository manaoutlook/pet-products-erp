import type { NextFunction, Request, Response } from "express";

/**
 * Shape of the errors our routes raise. Most routes answer directly with
 * res.status(...).json({ message, suggestion }); this type is for the few
 * places that use next(err) or throw inside async helpers.
 */
export interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  suggestion?: string;
}

function resolveStatus(err: HttpError): number {
  const status = err.status || err.statusCode;
  if (typeof status === "number" && status >= 400 && status <= 599) return status;
  return 500;
}

/**
 * Terminal error handler.
 *
 * AI Agent Note: this used to `throw err` after responding. Express does not
 * catch that re-throw, so it reached the `uncaughtException` hook in index.ts
 * and killed the process - one forwarded error meant a dead server. Like every
 * Express error handler it must answer the request and return; `next(err)` is
 * only correct when we did NOT answer yet.
 */
export function errorHandler(
  err: HttpError,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    // Response is already on the wire - Express' default handler is the only
    // safe place left, it just closes the connection.
    next(err);
    return;
  }

  const status = resolveStatus(err);
  const isServerError = status >= 500;

  // Log every failure once. Request bodies are deliberately not logged - they
  // can contain passwords and customer data (see step 02).
  const logLine = `${req.method} ${req.originalUrl} -> ${status}: ${err?.message ?? "unknown error"}`;
  if (isServerError) {
    console.error("[api] " + logLine, err?.stack ?? "");
  } else {
    console.warn("[api] " + logLine);
  }

  // Never leak internal messages (raw SQL, driver errors) in production.
  const expose = !isServerError || process.env.NODE_ENV !== "production";
  const body: { message: string; suggestion?: string } = {
    message: expose ? err?.message || "Internal Server Error" : "Internal Server Error",
  };
  if (expose && err?.suggestion) body.suggestion = err.suggestion;

  res.status(status).json(body);
}
