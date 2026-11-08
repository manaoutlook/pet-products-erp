# Step 05 — Login throttling + security headers

**Priority:** P0 · **Risk:** low · **New dependencies:** `express-rate-limit`, `helmet`
**Files:** `server/rate-limit.ts` (new), `server/index.ts`, `server/auth.ts`,
`tests/backend/api/rate-limit.test.ts` (new)

---

## 1. Problem

### 1a. `/api/login` accepts unlimited attempts

`server/auth.ts:309` mounts the login handler with nothing in front of it. Each attempt costs a
scrypt hash (intentionally slow) plus a session object, so:
- an attacker can brute-force offline-grade speed limits imposed on themselves,
- a handful of concurrent login loops will exhaust the Node event loop and lock out real
  cashiers (a trivial denial of service on a POS system),
- nothing is recorded or throttled per IP.

### 1b. No security headers

`server/index.ts` never sets them. Every response is missing `X-Content-Type-Options`,
`X-Frame-Options` / `frame-ancestors`, `Referrer-Policy`, HSTS, and a CSP — so the app can be
framed (clickjacking on the POS screen) and MIME-sniffed.

---

## 2. Implementation

### 2a. Install

```bash
npm i express-rate-limit helmet
```

### 2b. `server/rate-limit.ts` (new)

```ts
import rateLimit from "express-rate-limit";

/**
 * Login throttle.
 *
 * AI Agent Note: /api/login had no limit at all. Each attempt runs a deliberately
 * slow scrypt hash and allocates a session, so a login loop is both a brute-force
 * oracle and a cheap way to starve the event loop for every cashier. Successful
 * logins are not counted (skipSuccessfulRequests), so a busy shift cannot lock
 * itself out - only failures add up.
 *
 * Storage is in-process. A multi-instance deployment needs a shared store
 * (rate-limit-redis) before this is a real defence against a distributed attack;
 * it still stops the common single-source loop.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,                      // express-rate-limit v6 calls this `max`
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    message: "Too many failed login attempts",
    suggestion: "Wait 15 minutes before trying again, or ask an administrator to reset your password",
  },
});

/**
 * Coarse per-IP ceiling for the whole API. Deliberately generous: the POS page
 * polls several endpoints and the bulk import posts multi-megabyte bodies, so this
 * is a runaway-client / scripted-abuse guard, not a business rule.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => !req.path.startsWith("/api"),
  message: {
    message: "Too many requests",
    suggestion: "Slow down and try again in a moment",
  },
});
```

### 2c. `server/index.ts` — mount helmet and the API limiter

Insert **immediately after** `export const app = express();` (line 25):

```ts
// Security headers. CSP is disabled on purpose: the Vite dev server injects inline
// scripts/HMR code and Recharts renders inline styles, so a strict policy here would
// break the app in development and in production builds alike. Every other helmet
// default (nosniff, frameguard, referrer-policy, HSTS in production) is kept.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
```

Then insert the limiter **after** the body parsers (line 29) and **before** the `/api/health`
probe:

```ts
app.use(apiLimiter);
```

Add both imports next to the other local imports (after line 7):

```ts
import helmet from "helmet";
import { apiLimiter } from "./rate-limit";
```

### 2d. `server/auth.ts` — protect the login route

- Add: `import { loginLimiter } from "./rate-limit";`
- Change line 309 from `app.post("/api/login", (req, res, next) => {` to:

```ts
  app.post("/api/login", loginLimiter, (req, res, next) => {
```

Nothing else changes; the limiter answers `429` with the `{message, suggestion}` shape the
client already understands.

---

## 3. Tests — `tests/backend/api/rate-limit.test.ts` (new)

The limiter itself is tested against a throwaway Express app on an ephemeral port, so the test
needs no database and no changes to the real server.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { loginLimiter } from '../../../server/rate-limit';

describe('loginLimiter', () => {
  const app = express();
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    app.use(express.json());
    app.post('/api/login', loginLimiter, (_req, res) => {
      res.status(400).json({ message: 'Invalid username or password' });
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const attempt = () =>
    fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'x', password: 'y' }),
    });

  it('answers 429 after ten failed attempts from one client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await attempt()).status);
    }

    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);

    const body = await (await attempt()).json();
    expect(body.message).toBe('Too many failed login attempts');
    expect(body.suggestion).toBeTruthy();
  });
});
```

> The limiter keeps state per IP in memory, and every test file gets a fresh module registry, so
> this suite cannot interfere with others. Do not add `rateLimit` resets — that would hide a
> real regression in `skipSuccessfulRequests`.

---

## 4. Verification

```bash
npm i express-rate-limit helmet
npx vitest run tests/backend/api/rate-limit.test.ts
npx tsc --noEmit 2>&1 | grep -c "error TS"
npm run dev
curl -sI localhost:5001/api/health | grep -i "x-content-type-options\|x-frame-options\|referrer-policy"
```

Manual checks:

1. Wrong password 10× → the 11th answers `429 Too many failed login attempts`; the login screen
   shows that message (client already renders `{message, suggestion}`).
2. A correct login from a different browser/IP still works (no lockout of healthy clients).
3. `curl -I` shows `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`,
   `referrer-policy: no-referrer`.
4. Log in normally and use the app — helmet must not break inline styles, the Vite HMR client or
   `vite build` output. If the dev overlay stops working, `contentSecurityPolicy: false` is the
   setting to double-check.

---

## 5. Rollback

```bash
git checkout server/index.ts server/auth.ts package.json package-lock.json
rm server/rate-limit.ts tests/backend/api/rate-limit.test.ts
npm i   # to drop the two packages from node_modules
```

---

## 6. Done criteria

- [ ] 11 rapid failed logins produce a `429` with the standard error shape
- [ ] Successful logins do not count towards the limit
- [ ] Helmet headers present on `/api/health` and on the HTML entry point
- [ ] App still usable end-to-end in dev (login, POS sale, dashboard charts)
- [ ] `vite build` clean, tsc count unchanged, new test passes
