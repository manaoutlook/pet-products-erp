import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { db } from '../../../db';
import { users } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { crypto, setupAdmin, setupAuth } from '../../../server/auth';
import { cleanDatabase, resetSequences, resetTestDatabase, seedTestData } from '../../helpers/test-db';

/**
 * The auth endpoints, exercised over HTTP.
 *
 * `server/auth.ts` was the least-covered server module that is not a form parser (55 uncovered
 * branches): nothing called `setupAuth`, so the login/logout/`/api/user` handlers and the
 * passport strategies never ran. These tests boot the real express app with the real session
 * store, because what breaks is never the hash function - it is the wiring (a password compared
 * against a missing hash, a session that cannot be written, a logout that leaves a cookie).
 *
 * AI Agent Note: requests go through node:http rather than fetch(), because the backend suite
 * runs under happy-dom and its fetch() refuses a cross-origin request to 127.0.0.1:<port>.
 */

interface HttpResponse {
    status: number;
    json: any;
    cookies: string[];
}

function request(
    baseUrl: string,
    path: string,
    options: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<HttpResponse> {
    const { method = 'GET', body, cookie } = options;

    return new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const url = new URL(path, baseUrl);
        const headers: Record<string, string> = {};
        if (payload) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = String(Buffer.byteLength(payload));
        }
        if (cookie) headers.Cookie = cookie;

        const req = http.request(
            { hostname: url.hostname, port: url.port, path: url.pathname, method, headers },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk as Buffer));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    resolve({
                        status: res.statusCode ?? 0,
                        json: text ? JSON.parse(text) : undefined,
                        cookies: (res.headers['set-cookie'] as string[] | undefined) ?? [],
                    });
                });
            },
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

/** The `sid=...` part of a Set-Cookie header, ready to send back. */
const sessionCookie = (cookies: string[]): string =>
    cookies.map((cookie) => cookie.split(';')[0]).join('; ');
describe('auth endpoints', () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
        await resetTestDatabase();

        const app = express();
        app.use(express.json());
        setupAuth(app);

        server = await new Promise<Server>((resolve) => {
            const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        // `setupAuth` creates the default admin in the background; wait for it so it cannot
        // land in the middle of a test's TRUNCATE.
        for (let attempt = 0; attempt < 50; attempt += 1) {
            const [admin] = await db.select().from(users).where(eq(users.username, 'admin')).limit(1);
            if (admin) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('setupAdmin never created the default admin user');
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(async () => {
        await cleanDatabase();
        await resetSequences();
        await seedTestData();
    });

    /**
     * The seeded users carry the same scrypt envelope the login verifies (see
     * `seedTestData`), so `test123` is a working password here.
     */
    it('logs in with valid credentials and keeps the session across requests', async () => {
        const login = await request(baseUrl, '/api/login', {
            method: 'POST',
            body: { username: 'test_admin', password: 'test123' },
        });

        expect(login.status).toBe(200);
        expect(login.json.message).toBe('Login successful');
        expect(login.json.user).toMatchObject({ username: 'test_admin', role: { name: 'admin' } });
        // The password hash never travels back to the client.
        expect(login.json.user.password).toBeUndefined();

        const cookie = sessionCookie(login.cookies);
        expect(cookie).toContain('sid=');

        const me = await request(baseUrl, '/api/user', { cookie });
        expect(me.status).toBe(200);
        expect(me.json).toMatchObject({ username: 'test_admin' });
    });

    it('normalises the username, so the login form is not case-sensitive', async () => {
        const login = await request(baseUrl, '/api/login', {
            method: 'POST',
            body: { username: 'TEST_ADMIN', password: 'test123' },
        });

        expect(login.status).toBe(200);
        expect(login.json.user.username).toBe('test_admin');
    });

    it('answers the same 400 for a wrong password and an unknown user', async () => {
        const wrongPassword = await request(baseUrl, '/api/login', {
            method: 'POST',
            body: { username: 'test_admin', password: 'nope' },
        });
        const unknownUser = await request(baseUrl, '/api/login', {
            method: 'POST',
            body: { username: 'ghost', password: 'test123' },
        });

        // Same status and body: a difference here is an account-enumeration oracle.
        expect(wrongPassword.status).toBe(400);
        expect(unknownUser.status).toBe(400);
        expect(wrongPassword.json).toEqual(unknownUser.json);
        expect(wrongPassword.json).toEqual({
            message: 'Invalid username or password',
            suggestion: 'Please check your credentials and try again',
        });
        expect(wrongPassword.cookies.some((cookie) => cookie.startsWith('sid='))).toBe(false);
    });

    it('reports 401 on /api/user when nobody is logged in', async () => {
        const me = await request(baseUrl, '/api/user');

        expect(me.status).toBe(401);
        expect(me.json).toEqual({
            message: 'Not logged in',
            suggestion: 'Please log in to access this resource',
        });
    });

    it('logs out and clears the session', async () => {
        const login = await request(baseUrl, '/api/login', {
            method: 'POST',
            body: { username: 'test_admin', password: 'test123' },
        });
        const cookie = sessionCookie(login.cookies);

        const logout = await request(baseUrl, '/api/logout', { method: 'POST', cookie });
        expect(logout.status).toBe(200);
        expect(logout.json).toEqual({ message: 'Logout successful' });

        // The old cookie is no longer a logged-in session.
        expect((await request(baseUrl, '/api/user', { cookie })).status).toBe(401);
    });

    it('creates the default admin once and leaves an existing one alone', async () => {
        await cleanDatabase();
        await resetSequences();

        await setupAdmin();
        const admins = await db.select().from(users).where(eq(users.username, 'admin'));
        expect(admins).toHaveLength(1);
        // The default password is hashed, never stored in the clear.
        expect(admins[0].password).not.toBe('admin123');

        // Running it again (a second boot) is a no-op, not a duplicate row or a crash.
        await setupAdmin();
        expect(await db.select().from(users).where(eq(users.username, 'admin'))).toHaveLength(1);
    });
});


describe('password hashing', () => {
    it('round-trips a hash and rejects a different password', async () => {
        const hash = await crypto.hash('secret-123');

        expect(hash).not.toContain('secret-123');
        await expect(crypto.compare('secret-123', hash)).resolves.toBe(true);
        await expect(crypto.compare('secret-124', hash)).resolves.toBe(false);
    });

    it('refuses to hash an empty password', async () => {
        await expect(crypto.hash('')).rejects.toThrow('Failed to secure password. Please try again.');
        await expect(crypto.hash(undefined as unknown as string)).rejects.toThrow(
            'Failed to secure password. Please try again.',
        );
    });

    it('reports a stored value that is not "hash.salt" instead of crashing', async () => {
        // A truncated or hand-edited row used to surface as "Error verifying password", which
        // reads as a wrong password to the user and hides the real damage.
        await expect(crypto.compare('secret-123', 'not-a-hash')).rejects.toThrow(
            'Invalid stored password format',
        );
    });

    it('requires both passwords before comparing', async () => {
        await expect(crypto.compare('', 'abc.def')).rejects.toThrow(
            'Error verifying password. Please try again.',
        );
    });
});

