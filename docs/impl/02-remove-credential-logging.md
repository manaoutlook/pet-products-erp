# Step 02 — Stop logging credentials, salts, hashes and full responses

**Priority:** P0 · **Risk:** very low · **New dependencies:** none
**Files:** `server/auth.ts`, `server/index.ts`, `tests/backend/api/auth-logging.test.ts` (new)

---

## 1. Problem

Two independent leaks.

**A. `server/auth.ts` logs secrets.** 30 console statements, several carrying
password-derived material or full user objects:

| Line | Statement | Leak |
| --- | --- | --- |
| 50 | ``console.log(`Generating hash for password with salt: ${salt}`)`` | password **salt** |
| 55 | `console.log(...Length: ${hashedPassword.length})` | hash length |
| 75 | `console.error('Invalid stored password format:', { storedPassword })` | full `hash.salt` |
| 79, 87-90, 93 | comparison traces incl. `{ storedHashLength, suppliedHashLength }` | verification oracle |
| 143 | `console.log('Admin role:', role)` | full permissions object |
| 223 | ``console.log(`Attempting login for user: ${username}`)`` | username enumeration |
| 248, 252, 256 | `'User not found'` / `'Password verification failed'` | which half of the credential was wrong |
| 262 | `console.log('Login successful:', userWithoutPassword)` | role/permissions dump |
| 272, 278, 301 | serialize/deserialize dumps | session internals on every request |
| 310, 328, 353, 392 | login request/response logs | usernames, every `/api/user` hit |

**B. `server/index.ts:48-76` logs the response body of every `/api` call.**

```ts
res.json = function (bodyJson, ...args) {
  capturedJsonResponse = bodyJson;                        // full body kept
  return originalResJson.apply(res, [bodyJson, ...args]);
};
res.on("finish", () => {
  let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
  if (capturedJsonResponse) {
    logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;   // printed
  }
  ...
});
```

So `/api/login` prints the authenticated user (incl. permissions), `/api/products` prints the
whole catalogue, `/api/sales-transactions` prints full receipts with customer data. The
process also retains every response body it just serialised.

---

## 2. Target behaviour

- No salt, hash, password, session object or permission blob is ever logged.
- Auth logging shrinks to: one line per failed login (username only), one line per successful
  login (`userId` only), plus auth subsystem errors.
- The request logger keeps method / path / status / duration and **drops the body**.

---

## 3. Implementation

### 3a. Delete / reduce the statements in `server/auth.ts`

Work **top-down** and re-grep between edits so line numbers do not shift under you.

1. **Delete lines 50, 55, 79, 87-90, 93** — the hashing / comparison traces.
2. **Line 75** — replace with a message carrying no data:

```ts
      if (!storedHash || !salt) {
        // Never log the stored value - it is the password hash and salt.
        console.error('Stored password has an unexpected format (expected "hash.salt")');
        throw new Error('Invalid stored password format');
      }
```

3. **Line 108** `console.log('Setting up admin user...')` → keep (no secret).
4. **Line 143** `console.log('Admin role:', role)` → delete.
5. **Line 163** `console.log('Admin user created successfully')` → keep.
6. **Line 223** (`Attempting login for user: ${username}`) → delete.
7. **Lines 248, 252, 256** → delete.
8. **Line 262** → delete, leaving just the return:

```ts
        return done(null, userWithoutPassword as Express.User);
```

9. **Line 272** — keep `serializeUser`, log nothing:

```ts
  passport.serializeUser((user, done) => {
    done(null, { id: user.id, username: user.username, role: user.role });
  });
```

10. **Lines 278 and 301** → delete (per-request deserialisation logging).
11. **Lines 310-313** (login request dump) → delete, so `passport.authenticate(...)` becomes
    the first statement of the handler.
12. **Lines 328-331** → replace with a generic, non-enumerating answer:

```ts
      if (!user) {
        // AI Agent Note: log only the attempted username. The reason ("username
        // not found" vs "incorrect password") must never reach the logs or the
        // client - it is a free account-enumeration oracle.
        console.warn('[auth] login failed for username:', req.body?.username);
        return res.status(400).json({
          message: "Invalid username or password",
          suggestion: "Please check your credentials and try again"
        });
      }
```

    ⚠️ This intentionally changes the client-visible message (previously
    `"Username not found"` / `"Incorrect password"`). That change is part of the fix. Re-run
    the frontend tests — none assert the old strings.
13. **Lines 353-357** (`Login successful: {userId, username, role}`) → replace with:

```ts
        console.log('[auth] login ok for user', user.id);
```

14. **Lines 392-395** (`/api/user` request dump) → delete.
15. Keep the `console.error` calls for hashing, comparison, admin setup, login and
    deserialisation, but never spread a raw object that can hold a user or password — log
    `error instanceof Error ? error.message : 'unknown error'` instead.

Afterwards `grep -n "console\." server/auth.ts` should return ~7 lines, none containing
`salt`, `password`, `Hash`, `role:` or a raw user object.

### 3b. Drop response bodies from the request logger (`server/index.ts:48-76`)

Replace the whole block with:

```ts
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // AI Agent Note: the body used to be captured and printed, which wrote
      // login payloads, permission blobs and full receipts (customer names,
      // phone numbers) into the terminal and any log shipper attached to it.
      // Method/path/status/duration is enough to debug a request.
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});
```

Remove `Request` / `Response` / `NextFunction` from the line-5 import only if `tsc` reports
them unused (step 01 already edits that import line).

---

## 4. Tests — `tests/backend/api/auth-logging.test.ts` (new)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { crypto } from "../../../server/auth";

describe("auth logging", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("does not log the password salt or hash while hashing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const hash = await crypto.hash("test123");
    const printed = log.mock.calls.flat().join(" ");
    const salt = hash.split(".")[1];
    expect(printed).not.toContain(salt);
    expect(printed.toLowerCase()).not.toContain("salt");
  });

  it("does not log stored password material when the format is invalid", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(crypto.compare("x", "no-separator-here")).rejects.toThrow();
    const printed = err.mock.calls.flat().join(" ");
    expect(printed).not.toContain("no-separator-here");
  });
});
```

> `crypto` is exported by `server/auth.ts` today and importing it does not register routes or
> touch the database, so this test is safe and fast.

---

## 5. Verification

```bash
grep -n "console\." server/auth.ts              # ~7 lines, no salt/password/role dumps
grep -n "capturedJsonResponse" server/index.ts  # no matches
npx vitest run tests/backend/api/auth-logging.test.ts
npx vitest run tests/frontend                   # catches the login-message change
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Manual: `npm run dev`, log in with a wrong password, then read the terminal — exactly one
`[auth] login failed for username: …` line, nothing else about the attempt. The login form
must display `Invalid username or password`.

---

## 6. Rollback

```bash
git checkout server/auth.ts server/index.ts
rm tests/backend/api/auth-logging.test.ts
```

---

## 7. Done criteria

- [ ] `grep "console\." server/auth.ts | grep -i "salt\|hash\|password\|role:"` → nothing
- [ ] Request logger prints no response bodies
- [ ] Login failure message is generic on both server and client
- [ ] New tests pass, frontend tests pass, tsc count unchanged

