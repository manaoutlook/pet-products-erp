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
