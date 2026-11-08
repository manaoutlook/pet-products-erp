# Step 04 — Persist sessions in Postgres instead of process memory

**Priority:** P0 · **Risk:** low · **New dependencies:** none
**Files:** `db/schema.ts`, `migrations/*` (generated), `server/session-store.ts` (new),
`server/auth.ts`, `tests/backend/api/session-store.test.ts` (new)

---

## 1. Problem

`server/auth.ts:193-210`:

```ts
export function setupAuth(app: Express) {
  const MemoryStore = createMemoryStore(session);
  const sessionSettings: session.SessionOptions = {
    ...
    store: new MemoryStore({
      checkPeriod: 86400000, // prune expired entries every 24h
    }),
  };
```

Consequences:

| Event | Effect |
| --- | --- |
| `npm run dev` restart / `tsx watch` reload after any edit | **every user is logged out** |
| Deploy / restart / container reschedule | every user is logged out |
| Two processes / a load balancer | requests bounce between logged-in and logged-out |
| Login brute-force | one session object retained in RAM per attempt |
| Logout | only clears that one process's memory |

`memorystore` is not a real store — it is a stop-gap. The app already has Postgres and Drizzle,
so sessions belong there.

---

## 2. Design

1. Add a `user_sessions` table to `db/schema.ts` (drizzle-managed, so
   `npx drizzle-kit push` — already run by the test global setup — creates it everywhere).
2. Write `server/session-store.ts`: a minimal `express-session` `Store` backed by Drizzle.
   No new dependency; `connect-pg-simple` would add the `pg` driver next to the existing
   `postgres` client, and this store is ~70 lines.
3. Swap `MemoryStore` for `DrizzleSessionStore` in `setupAuth`.

Contract required by express-session: `get`, `set`, `destroy`, `touch` (callback based). The
optional `length` / `clear` / `all` methods are admin tooling only — skip them.

---

## 3. Implementation

### 3a. `db/schema.ts` — add the table

Extend the line-1 import with `index`:

```ts
import { pgTable, text, serial, integer, boolean, timestamp, date, varchar, decimal, index } from "drizzle-orm/pg-core";
```

`jsonb` does **not** need adding — `db/schema.ts:5` already has
`import { jsonb } from "drizzle-orm/pg-core";`, which the new table reuses.

Append at the end of the file:

```ts
// Session store - see server/session-store.ts.
//
// AI Agent Note: sessions live in the database so a restart/hot reload does not log
// everybody out and so several app instances can share one session. Column names are
// read by DrizzleSessionStore; do not rename without updating it.
export const userSessions = pgTable("user_sessions", {
  sid: varchar("sid", { length: 255 }).primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (table) => ({
  expireIdx: index("user_sessions_expire_idx").on(table.expire),
}));
```

### 3b. Generate + apply the migration

```bash
npx drizzle-kit generate --name user_sessions   # writes migrations/000X_user_sessions.sql + journal
npm run db:push                                 # local/dev database
```

Do **not** hand-write the SQL file: `drizzle-kit generate` also updates
`migrations/meta/_journal.json`, and a migration missing from the journal is silently skipped by
`migrate()`.

### 3c. `server/session-store.ts` (new)

```ts
import session from "express-session";
import { db } from "@db";
import { userSessions } from "@db/schema";
import { eq, lt } from "drizzle-orm";

type Callback = (err?: any) => void;

/**
 * express-session store backed by the `user_sessions` table.
 *
 * AI Agent Note: the previous MemoryStore kept sessions in the process, so every
 * restart logged everyone out and a second instance could not see them at all.
 * Only the four methods express-session actually calls are implemented; `length`,
 * `clear` and `all` are admin tooling and are intentionally omitted.
 */
export class DrizzleSessionStore extends session.Store {
  private readonly ttlMs: number;
  private pruneTimer?: NodeJS.Timeout;

  constructor(options: { ttlMs?: number; pruneIntervalMs?: number } = {}) {
    super();
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;

    // Drop expired rows on a timer so the table cannot grow forever even when no
    // matching session is ever looked up again. unref() keeps the process from
    // staying alive just because of this interval (tests, scripts, CLI).
    const interval = options.pruneIntervalMs ?? 60 * 60 * 1000;
    this.pruneTimer = setInterval(() => {
      this.pruneExpired().catch((error) => {
        console.error("[session] prune failed:", error instanceof Error ? error.message : error);
      });
    }, interval);
    this.pruneTimer.unref?.();
  }

  private expiryFor(sess: session.SessionData): Date {
    const maxAge = sess?.cookie?.maxAge;
    return new Date(Date.now() + (typeof maxAge === "number" ? maxAge : this.ttlMs));
  }

  async pruneExpired(): Promise<void> {
    await db.delete(userSessions).where(lt(userSessions.expire, new Date()));
  }

  get(sid: string, callback: (err: any, session?: session.SessionData | null) => void): void {
    db.select({ sess: userSessions.sess, expire: userSessions.expire })
      .from(userSessions)
      .where(eq(userSessions.sid, sid))
      .limit(1)
      .then(([row]) => {
        if (!row) return callback(null, null);
        if (row.expire.getTime() < Date.now()) {
          // Expired but not pruned yet - treat as absent and clean it up.
          db.delete(userSessions).where(eq(userSessions.sid, sid)).catch(() => undefined);
          return callback(null, null);
        }
        callback(null, row.sess as unknown as session.SessionData);
      })
      .catch((error) => callback(error));
  }

  set(sid: string, sess: session.SessionData, callback?: Callback): void {
    const expire = this.expiryFor(sess);
    const value = sess as unknown as Record<string, unknown>;
    db.insert(userSessions)
      .values({ sid, sess: value, expire })
      .onConflictDoUpdate({ target: userSessions.sid, set: { sess: value, expire } })
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  destroy(sid: string, callback?: Callback): void {
    db.delete(userSessions)
      .where(eq(userSessions.sid, sid))
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  touch(sid: string, sess: session.SessionData, callback?: Callback): void {
    db.update(userSessions)
      .set({ expire: this.expiryFor(sess) })
      .where(eq(userSessions.sid, sid))
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  /** Used by tests and graceful shutdown. */
  close(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = undefined;
  }
}
```

### 3d. `server/auth.ts` — use it

1. Delete line 5: `import createMemoryStore from "memorystore";`
2. Add: `import { DrizzleSessionStore } from "./session-store";`
3. Replace the store wiring (lines 194 and 207-209):

```ts
export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: resolveSessionSecret(),
    name: 'sid',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: app.get("env") === "production",
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    },
    // AI Agent Note: sessions must outlive the process - a MemoryStore logged every
    // user out on each restart and could not be shared between instances.
    store: new DrizzleSessionStore({ ttlMs: 24 * 60 * 60 * 1000 }),
  };
```

`memorystore` may stay in `package.json` (nothing else to change) or be removed later with
`npm uninstall memorystore` once this step is verified — do that in a separate commit.

---

## 4. Tests — `tests/backend/api/session-store.test.ts` (new)

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { db } from '../../../db';
import { userSessions } from '../../../db/schema';
import { cleanDatabase } from '../../helpers/test-db';
import { DrizzleSessionStore } from '../../../server/session-store';

function getAsync(store: DrizzleSessionStore, sid: string) {
  return new Promise<unknown>((resolve, reject) =>
    store.get(sid, (err, sess) => (err ? reject(err) : resolve(sess))),
  );
}

function setAsync(store: DrizzleSessionStore, sid: string, sess: any) {
  return new Promise<void>((resolve, reject) =>
    store.set(sid, sess, (err) => (err ? reject(err) : resolve())),
  );
}

function destroyAsync(store: DrizzleSessionStore, sid: string) {
  return new Promise<void>((resolve, reject) =>
    store.destroy(sid, (err) => (err ? reject(err) : resolve())),
  );
}

describe('DrizzleSessionStore', () => {
  const store = new DrizzleSessionStore({ pruneIntervalMs: 60 * 60 * 1000 });

  afterAll(() => store.close());
  beforeEach(async () => { await cleanDatabase(); });

  it('round-trips a session', async () => {
    await setAsync(store, 'sid-1', { cookie: { maxAge: 60_000 }, userId: 42 });
    const loaded = await getAsync(store, 'sid-1') as any;
    expect(loaded.userId).toBe(42);
  });

  it('returns null for an unknown session', async () => {
    expect(await getAsync(store, 'nope')).toBeNull();
  });

  it('overwrites an existing session on set', async () => {
    await setAsync(store, 'sid-2', { cookie: { maxAge: 60_000 }, userId: 1 });
    await setAsync(store, 'sid-2', { cookie: { maxAge: 60_000 }, userId: 2 });
    expect((await getAsync(store, 'sid-2') as any).userId).toBe(2);
    expect(await db.select().from(userSessions)).toHaveLength(1);
  });

  it('deletes the row on destroy', async () => {
    await setAsync(store, 'sid-3', { cookie: { maxAge: 60_000 } });
    await destroyAsync(store, 'sid-3');
    expect(await getAsync(store, 'sid-3')).toBeNull();
  });

  it('ignores and cleans up expired sessions', async () => {
    await db.insert(userSessions).values({
      sid: 'sid-expired',
      sess: { cookie: { maxAge: 1 } },
      expire: new Date(Date.now() - 1000),
    });
    expect(await getAsync(store, 'sid-expired')).toBeNull();
    expect(await db.select().from(userSessions)).toHaveLength(0);
  });

  it('prunes expired rows', async () => {
    await db.insert(userSessions).values([
      { sid: 'old', sess: {}, expire: new Date(Date.now() - 1000) },
      { sid: 'fresh', sess: {}, expire: new Date(Date.now() + 60_000) },
    ]);
    await store.pruneExpired();
    const rows = await db.select().from(userSessions);
    expect(rows.map((r) => r.sid)).toEqual(['fresh']);
  });
});
```

---

## 5. Verification

```bash
npx drizzle-kit generate --name user_sessions   # expect one new file + journal update
npm run db:push
npx vitest run tests/backend/api/session-store.test.ts
npx tsc --noEmit 2>&1 | grep -c "error TS"
npm run dev
```

Manual check — this is the actual point of the step:

1. Log in.
2. Stop the dev server (Ctrl-C) and start it again.
3. Reload the browser: you must still be logged in (before this change you would be on the
   login screen).
4. `SELECT count(*) FROM user_sessions;` shows one row; log out and it disappears.

---

## 6. Rollback

```bash
git checkout db/schema.ts server/auth.ts
rm server/session-store.ts tests/backend/api/session-store.test.ts
rm migrations/000*_user_sessions.sql      # plus its entry in migrations/meta/_journal.json
```

The `user_sessions` table can stay in the database; it is only read by this store.

---

## 7. Done criteria

- [ ] `grep -rn "memorystore" server/` → only `package.json` remains (or nothing)
- [ ] `user_sessions` table exists and holds one row per logged-in user
- [ ] Sessions survive a server restart (manual check 1-3)
- [ ] 6 new tests pass, tsc count unchanged
