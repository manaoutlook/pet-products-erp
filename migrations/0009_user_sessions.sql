-- Migration: Persist express-session sessions in Postgres
-- Description: Creates the "user_sessions" table used by server/session-store.ts so
--              sessions survive a restart/hot reload and can be shared by several
--              instances. Previously sessions lived in the process (memorystore).
--
-- Note: mirror of db/schema.ts "userSessions". Applied by `npm run db:push`; this
-- file is the idempotent record of the change (same convention as 0005-0008).

CREATE TABLE IF NOT EXISTS "user_sessions" (
  "sid" VARCHAR(255) PRIMARY KEY NOT NULL,
  "sess" JSONB NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS "user_sessions_expire_idx" ON "user_sessions" ("expire");
