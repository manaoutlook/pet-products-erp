import { describe, it, expect } from 'vitest';
import type { Express } from 'express';
import { registerStoreRoutes } from '../../../server/routes/stores';

type Registration = { method: string; path: string; handlers: unknown[] };

/**
 * `/api/stores` used to be registered twice (once with `requireAuth`, once with
 * `requirePermission('stores', …)`); Express only ever ran the first one, so the
 * permission check was dead code. Registering into a recording stub makes the route
 * surface - and the middleware chain per route - visible without booting a server.
 */
function recordStoreRoutes(): Registration[] {
    const registrations: Registration[] = [];

    const app = {
        get: (path: string, ...handlers: unknown[]) => registrations.push({ method: 'GET', path, handlers }),
        post: (path: string, ...handlers: unknown[]) => registrations.push({ method: 'POST', path, handlers }),
        put: (path: string, ...handlers: unknown[]) => registrations.push({ method: 'PUT', path, handlers }),
        delete: (path: string, ...handlers: unknown[]) => registrations.push({ method: 'DELETE', path, handlers }),
    } as unknown as Express;

    registerStoreRoutes(app);
    return registrations;
}

describe('store routes', () => {
    const registrations = recordStoreRoutes();

    it('registers the store endpoints exactly once each', () => {
        const keys = registrations.map((r) => `${r.method} ${r.path}`);

        expect(keys.sort()).toEqual([
            'DELETE /api/stores/:id',
            'GET /api/stores',
            'POST /api/stores',
            'PUT /api/stores/:id',
        ]);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('gates create/update/delete behind a permission check and a validator', () => {
        const write = registrations.filter((r) => r.method !== 'GET');

        for (const route of write) {
            // [permission middleware, zod validator(s), handler]
            expect(route.handlers.length).toBeGreaterThanOrEqual(3);
            expect(typeof route.handlers[route.handlers.length - 1]).toBe('function');
        }
    });

    it('lets any authenticated user list stores', () => {
        const get = registrations.find((r) => r.method === 'GET');

        // [requireAuth, handler]
        expect(get?.handlers).toHaveLength(2);
    });
});
