#!/usr/bin/env node
/**
 * Reset a user's password straight in the database — for the case where nobody
 * can log in to press "Save" in Administration -> Users.
 *
 * AI Agent Note: this must hash EXACTLY the way server/auth.ts does it, or the
 * row will never pass login. That is scrypt(password, salt, 64) with a 16-byte
 * hex salt and the envelope `${hashHex}.${saltHex}` — NOT bcrypt, even though
 * bcrypt is in package.json. It also uses the same driver (postgres.js) as
 * db/index.ts so there is only one way to reach the database.
 *
 * Usage (on the server, from /opt/SmartERP, with DATABASE_URL in the environment):
 *   node deploy/reset-admin-password.mjs <username> [new-password]
 *
 * - Omit the password to have a strong one generated and printed once.
 * - Reads DATABASE_URL from the environment, or from .env next to this script.
 * - Prints the username and role, never the password hash.
 */

import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const scryptAsync = promisify(scrypt);

/** Same envelope as server/auth.ts `crypto.hash`. */
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return `${derivedKey.toString("hex")}.${salt}`;
}

/** Load DATABASE_URL from .env if the caller did not export it. */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, "..", ".env");
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error(`DATABASE_URL not set and not found in ${envPath}`);

  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

function generatePassword() {
  // 24 chars from an unambiguous alphabet: no O/0, l/1/I, and no shell metacharacters.
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%+=?";
  // Rejection sampling: 256 is not a multiple of the alphabet length, so plain
  // `b % len` would favour the first 16 characters.
  const limit = 256 - (256 % alphabet.length);
  const out = [];
  while (out.length < 24) {
    for (const b of randomBytes(32)) {
      if (b >= limit) continue;
      out.push(alphabet[b % alphabet.length]);
      if (out.length === 24) break;
    }
  }
  return out.join("");
}

const [username, supplied] = process.argv.slice(2);

if (!username) {
  console.error("usage: node deploy/reset-admin-password.mjs <username> [new-password]");
  process.exit(2);
}

const password = supplied || generatePassword();
const sql = postgres(databaseUrl(), { max: 1 });

try {
  const rows = await sql`
    select u.id, u.username, r.name as role
    from users u
    join roles r on r.id = u.role_id
    where u.username = ${username}
  `;

  if (rows.length === 0) {
    console.error(`no such user: ${username}`);
    const others = await sql`select username from users order by username`;
    console.error(`existing users: ${others.map((r) => r.username).join(", ")}`);
    process.exit(1);
  }

  const { id, role } = rows[0];
  await sql`
    update users
    set password = ${await hashPassword(password)}, updated_at = now()
    where id = ${id}
  `;

  // Any session opened with the old password stays valid until it expires, so
  // clear them when the reset is an incident response rather than convenience.
  // (Sessions live in `user_sessions` as opaque JSON; the store has no user index.)
  console.log(`reset password for ${username} (id=${id}, role=${role})`);
  if (!supplied) console.log(`new password: ${password}`);
  console.log("log in, then change it in Administration -> Users.");
} finally {
  await sql.end();
}
