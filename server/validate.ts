import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

/**
 * Shared request validators.
 *
 * AI Agent Note: only 20 of the 86 routes validated their input, and the ones that
 * did each hand-rolled their own error shape. These helpers make validation the
 * default: parsed+stripped data lands back on req.body/query/params, and failures
 * answer the same {message, suggestion, errors} body every time.
 */
function fail(res: Response, error: z.ZodError, suggestion: string) {
  // flatten() keeps field names at the top level so the client can highlight inputs.
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }

  return res.status(400).json({
    message: error.issues[0]?.message
      ? `Invalid request: ${error.issues[0].message}`
      : "Invalid request",
    suggestion,
    errors: fieldErrors,
  });
}

export function validateBody<T extends z.ZodTypeAny>(schema: T, suggestion = "Check the submitted values and try again") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return fail(res, result.error, suggestion);
    req.body = result.data;
    next();
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T, suggestion = "Check the query parameters and try again") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return fail(res, result.error, suggestion);
    // AI Agent Note: req.query is a getter-only property in Express 5, so assigning it
    // throws. defineProperty keeps the parsed object reachable for the handler.
    Object.defineProperty(req, "query", {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}

export function validateParams<T extends z.ZodTypeAny>(schema: T, suggestion = "Check the request URL and try again") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) return fail(res, result.error, suggestion);
    req.params = result.data;
    next();
  };
}

/** Reusable pieces. */
export const idParamSchema = z.object({ id: z.coerce.number().int().positive("A valid id is required") });

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
