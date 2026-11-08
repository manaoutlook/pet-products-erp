# Step 01 — Fix the error handler that crashes the process

**Priority:** P0 · **Risk:** very low · **New dependencies:** none
**Files:** `server/error-handler.ts` (new), `server/index.ts`, `tests/backend/api/error-handler.test.ts` (new)

---

## 1. Problem

The global Express error handler responds to the client and then **re-throws the error**.
Because the process has an `uncaughtException` handler that calls `process.exit(1)`, a
single handled API error takes the whole server down.

### Evidence — `server/index.ts:83-89`

```ts
// Error handling middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(status).json({ message });
  throw err;                        // <-- re-throws inside Express after the response
});
```

### Evidence — `server/index.ts:14-23`

```ts
process.on("uncaughtException", (err) => {
  console.error("[fatal] Uncaught exception:", err);
  process.exit(1);                  // <-- turns the re-throw into a hard crash
});
```

Net effect: `throw err` inside the handler escapes Express's dispatch (nothing awaits it),
reaches `uncaughtException`, and the server exits. This is worse than having no handler at
all: routes answer `res.status(500).json(...)` themselves, so the middleware is only reached
for errors that *are* forwarded — rare, hard-to-reproduce events. Result: "the server
randomly died".

Secondary problems in the same 7 lines:

1. Internal messages (raw Postgres errors) are returned to the client in production.
2. The error itself is never logged, so a 500 leaves no server-side trace.

---

## 2. Target behaviour

| Situation | Response |
| --- | --- |
| Error has `status`/`statusCode` 4xx | that status, `{ message, suggestion? }` as provided |
| Any other error | `500`, `"Internal Server Error"` in production (real message in dev/test) |
| `res.headersSent` already true | delegate to Express default handler via `next(err)` |
| Any error | logged once server-side with method/path/status — never thrown |

---

## 3. Implementation

### 3a. Create `server/error-handler.ts`

```ts
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
```

### 3b. Replace the handler in `server/index.ts`

- Replace lines **82-89** (the whole `// Error handling middleware` block) with:

```ts
// Error handling middleware - must stay the last app.use(...) registration.
app.use(errorHandler);
```

- Add the import after line 7 (`import { setupVite, serveStatic, log } from "./vite";`):

```ts
import { errorHandler } from "./error-handler";
```

- Line 5 imports `Request, Response, NextFunction` for the request logger (lines 48-76).
  Keep them; only remove an import if `tsc` reports it as unused.

### 3c. What NOT to change

- Keep the `uncaughtException` / `unhandledRejection` hooks (`index.ts:14-23`). They are
  correct — this step stops the handler from feeding errors into them.
- Do not add `asyncHandler` / `express-async-errors` yet; routes already use try/catch and
  that refactor belongs to step 06.

---

## 4. Tests — `tests/backend/api/error-handler.test.ts` (new file)

The handler is a pure function; test it with fake req/res objects (no database needed).

```ts
import { describe, it, expect, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { errorHandler } from "../../../server/error-handler";

function makeRes() {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as typeof res & Response;
}

const req = { method: "POST", originalUrl: "/api/sales-transactions" } as Request;
const next = vi.fn() as unknown as NextFunction;

describe("errorHandler", () => {
  it("answers with the error status and does not throw", () => {
    const res = makeRes();
    const err = Object.assign(new Error("Insufficient stock"), { status: 400 });
    expect(() => errorHandler(err, req, res, next)).not.toThrow();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ message: "Insufficient stock" });
    expect(next).not.toHaveBeenCalled();
  });

  it("maps unknown errors to 500 and hides the internal message in production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const res = makeRes();
    errorHandler(new Error('relation "secret" does not exist'), req, res, next);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ message: "Internal Server Error" });
    process.env.NODE_ENV = original;
  });

  it("delegates to next when headers were already sent", () => {
    const res = makeRes();
    res.headersSent = true;
    const err = new Error("late failure");
    errorHandler(err, req, res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.statusCode).toBe(0); // untouched
  });

  it("passes the suggestion through for client errors", () => {
    const res = makeRes();
    const err = Object.assign(new Error("Invalid item data"), {
      status: 400,
      suggestion: "Each item must have productId and positive quantity",
    });
    errorHandler(err, req, res, next);
    expect(res.body).toEqual({
      message: "Invalid item data",
      suggestion: "Each item must have productId and positive quantity",
    });
  });
});
```

---

## 5. Verification

```bash
npx vitest run tests/backend/api/error-handler.test.ts
npx tsc --noEmit 2>&1 | grep -c "error TS"   # must be <= baseline (76)
npm run dev
```

Manual check (do this — it is the whole point of the step):

1. `curl -i localhost:5001/api/health` → `200 {"status":"ok",...}`.
2. Temporarily add `throw Object.assign(new Error("boom"), { status: 418 })` to any route,
   call it, and confirm: response is `418 {"message":"boom"}`, the terminal logs exactly one
   `[api]` line, and **the server is still alive** (`/api/health` still answers). Remove the
   temporary throw.
3. Repeat with a bare `next(new Error("boom"))` in a route and confirm `500` + server alive.

---

## 6. Rollback

Single-file revert:

```bash
git checkout server/index.ts
rm server/error-handler.ts tests/backend/api/error-handler.test.ts
```

No data or schema impact.

---

## 7. Done criteria

- [ ] `server/error-handler.ts` exists and is the last `app.use` in `server/index.ts`
- [ ] No `throw` statement inside any Express error middleware
- [ ] The 4 new tests pass
- [ ] Baseline tsc/test counts unchanged or better
- [ ] Manual checks 1-3 above passed
