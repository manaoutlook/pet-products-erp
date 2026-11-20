import { vi } from 'vitest';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Helpers for testing the `register…Routes(app)` modules without booting Express.
 *
 * The split route modules (`server/routes/*.ts`) keep their handlers inline, so the only
 * way to reach them from a test is to register them into a stub `app`, pull the last
 * handler off the chain (the endpoint itself, after the middleware) and call it with a
 * fake request/response. That exercises the real handler against the real database
 * instead of re-asserting the registration list.
 *
 * `requireAuth` / `requirePermission` are *not* run by these helpers - the middleware
 * chain is covered by the registration tests; here the point is the handler body.
 */

export interface RouteRegistration {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handlers: RequestHandler[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Runs a `register…Routes` function against a recording stub and returns what it mounted. */
export function recordRoutes(register: (app: never) => void): RouteRegistration[] {
  const registrations: RouteRegistration[] = [];

  const app = {} as Record<(typeof METHODS)[number], unknown>;
  for (const method of METHODS) {
    app[method] = (path: string, ...handlers: RequestHandler[]) =>
      registrations.push({
        method: method.toUpperCase() as RouteRegistration['method'],
        path,
        handlers,
      });
  }

  register(app as never);
  return registrations;
}

/** The endpoint handler for a `METHOD path` pair - the last function on the chain. */
export function handlerFor(
  registrations: RouteRegistration[],
  method: RouteRegistration['method'],
  path: string,
): RequestHandler {
  const route = registrations.find((r) => r.method === method && r.path === path);
  if (!route) {
    throw new Error(`No route registered for ${method} ${path}`);
  }
  return route.handlers[route.handlers.length - 1];
}

export interface FakeResponse {
  statusCode: number;
  body: any;
  status(code: number): FakeResponse;
  json(payload: unknown): FakeResponse;
  send(payload: unknown): FakeResponse;
}

/** Minimal Express response: records the status and the JSON payload. */
export function makeRes(): FakeResponse & Response {
  const res: FakeResponse = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    send(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as FakeResponse & Response;
}

export interface HandlerInvocation {
  body?: unknown;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  user?: unknown;
}

export function makeReq(init: HandlerInvocation = {}): Request {
  return {
    body: init.body ?? {},
    params: init.params ?? {},
    query: init.query ?? {},
    ...(init.user ? { user: init.user } : {}),
  } as unknown as Request;
}

/**
 * Calls one handler and resolves with the fake response. A handler that rejects fails the
 * test directly, which is what would surface as an unhandled 500 in production.
 */
export async function invoke(handler: RequestHandler, init: HandlerInvocation = {}): Promise<FakeResponse> {
  const res = makeRes();
  const next = vi.fn() as unknown as NextFunction;

  await (handler as unknown as (req: Request, res: Response, next: NextFunction) => unknown)(
    makeReq(init),
    res,
    next,
  );

  return res;
}
