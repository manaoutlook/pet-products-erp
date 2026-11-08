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
          // Expired but not pruned yet - treat as absent and clean it up. The delete is
          // awaited before answering so callers never observe the row again.
          db.delete(userSessions)
            .where(eq(userSessions.sid, sid))
            .then(() => callback(null, null))
            .catch(() => callback(null, null));
          return;
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
