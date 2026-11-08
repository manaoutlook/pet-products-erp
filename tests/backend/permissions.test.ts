import { describe, it, expect } from 'vitest';
import { checkHierarchicalPermission, roleCan } from '../../shared/permissions';

/**
 * The rules in shared/permissions.ts decide both what the API accepts (requirePermission
 * in server/middleware.ts) and which screens the client renders. They used to live in
 * middleware.ts only; these tests pin the behaviour that was there.
 */
describe('checkHierarchicalPermission', () => {
    it('lets admins do anything', () => {
        expect(checkHierarchicalPermission('admin', 'users', 'delete')).toBe(true);
        expect(checkHierarchicalPermission('admin', 'inventory', 'read')).toBe(true);
    });

    it('lets global managers do everything except user management', () => {
        expect(checkHierarchicalPermission('global_manager', 'inventory', 'delete')).toBe(true);
        expect(checkHierarchicalPermission('global_manager', 'pos', 'create')).toBe(true);
        expect(checkHierarchicalPermission('global_manager', 'users', 'read')).toBe(false);
        expect(checkHierarchicalPermission('global_manager', 'users', 'delete')).toBe(false);
    });

    it('gives regional managers their modules but not user deletion', () => {
        expect(checkHierarchicalPermission('regional_manager', 'users', 'read')).toBe(true);
        expect(checkHierarchicalPermission('regional_manager', 'users', 'update')).toBe(true);
        expect(checkHierarchicalPermission('regional_manager', 'users', 'delete')).toBe(false);
        expect(checkHierarchicalPermission('regional_manager', 'inventory', 'update')).toBe(true);
        expect(checkHierarchicalPermission('regional_manager', 'transfers', 'create')).toBe(true);
        expect(checkHierarchicalPermission('regional_manager', 'purchaseOrders', 'update')).toBe(true);
        // Modules the role JSON would have to grant are unaffected by the level.
        expect(checkHierarchicalPermission('regional_manager', 'products', 'read', {})).toBe(false);
    });

    it('reads the module map for staff', () => {
        const permissions = {
            products: { create: true, read: true, update: false, delete: false },
            pos: { create: true, read: true, update: true, delete: false },
        };

        expect(checkHierarchicalPermission('staff', 'products', 'read', permissions)).toBe(true);
        expect(checkHierarchicalPermission('staff', 'products', 'delete', permissions)).toBe(false);
        expect(checkHierarchicalPermission('staff', 'pos', 'update', permissions)).toBe(true);
        // A module missing from the map is denied, not undefined.
        expect(checkHierarchicalPermission('staff', 'users', 'read', permissions)).toBe(false);
        expect(checkHierarchicalPermission('staff', 'products', 'read')).toBe(false);
    });

    it('denies unknown hierarchy levels outright', () => {
        expect(checkHierarchicalPermission('contractor', 'products', 'read', {
            products: { read: true },
        })).toBe(false);
    });
});

describe('roleCan', () => {
    it('treats the admin role name and the system-admin flag as a bypass', () => {
        expect(roleCan({ name: 'admin' }, 'users', 'delete')).toBe(true);
        expect(roleCan({ name: 'supervisor', isSystemAdmin: true }, 'users', 'delete')).toBe(true);
    });

    it('falls back to the staff rules when a role has no hierarchy level', () => {
        expect(roleCan({ name: 'sales', permissions: { pos: { read: true } } }, 'pos', 'read')).toBe(true);
        expect(roleCan({ name: 'sales', permissions: { pos: { read: true } } }, 'pos', 'delete')).toBe(false);
    });

    it('denies when there is no role at all (still loading, or logged out)', () => {
        expect(roleCan(null, 'products', 'read')).toBe(false);
        expect(roleCan(undefined, 'products', 'read')).toBe(false);
    });
});
