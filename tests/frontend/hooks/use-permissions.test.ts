import { describe, it, expect, vi } from 'vitest';
import { usePermissions } from '@/hooks/use-permissions';

// Mock the usePermissions hook
vi.mock('@/hooks/use-permissions');

describe('usePermissions Hook Tests', () => {
    it('should return correct permissions for admin user', () => {
        const mockPermissions = {
            hasPermission: vi.fn((module, action) => true),
            getModulePermissions: vi.fn((module) => ({
                create: true,
                read: true,
                update: true,
                delete: true,
            })),
            getAllowedModules: vi.fn(() => [
                'products',
                'orders',
                'inventory',
                'users',
                'stores',
                'masterData',
                'pos',
                'receipts',
            ]),
            isAdmin: true,
            role: {
                id: 1,
                name: 'admin',
                isSystemAdmin: true,
                permissions: {} as any,
            },
        };

        (usePermissions as any).mockReturnValue(mockPermissions);

        const permissions = usePermissions();

        expect(permissions.isAdmin).toBe(true);
        expect(permissions.hasPermission('products', 'create')).toBe(true);
        expect(permissions.hasPermission('products', 'delete')).toBe(true);
    });

    it('should return limited permissions for store manager', () => {
        const mockPermissions = {
            hasPermission: vi.fn((module, action) => {
                if (module === 'products' && action === 'delete') return false;
                if (module === 'users') return false;
                return true;
            }),
            getModulePermissions: vi.fn((module) => {
                if (module === 'products') {
                    return {
                        create: true,
                        read: true,
                        update: true,
                        delete: false,
                    };
                }
                return null;
            }),
            getAllowedModules: vi.fn(() => [
                'products',
                'orders',
                'inventory',
                'stores',
                'pos',
                'receipts',
            ]),
            isAdmin: false,
            role: {
                id: 2,
                name: 'store_manager',
                isSystemAdmin: false,
                permissions: {} as any,
            },
        };

        (usePermissions as any).mockReturnValue(mockPermissions);

        const permissions = usePermissions();

        expect(permissions.isAdmin).toBe(false);
        expect(permissions.hasPermission('products', 'create')).toBe(true);
        expect(permissions.hasPermission('products', 'delete')).toBe(false);
        expect(permissions.hasPermission('users', 'read')).toBe(false);
    });

    it('should return no permissions for sales associate on admin features', () => {
        const mockPermissions = {
            hasPermission: vi.fn((module, action) => {
                if (module === 'users' || module === 'stores') return false;
                if (action === 'delete') return false;
                return true;
            }),
            getModulePermissions: vi.fn((module) => {
                if (module === 'users' || module === 'stores') return null;
                return {
                    create: module === 'pos' || module === 'orders',
                    read: true,
                    update: module === 'pos' || module === 'orders',
                    delete: false,
                };
            }),
            getAllowedModules: vi.fn(() => ['products', 'orders', 'pos', 'receipts']),
            isAdmin: false,
            role: {
                id: 3,
                name: 'sales_associate',
                isSystemAdmin: false,
                permissions: {} as any,
            },
        };

        (usePermissions as any).mockReturnValue(mockPermissions);

        const permissions = usePermissions();

        expect(permissions.isAdmin).toBe(false);
        expect(permissions.hasPermission('users', 'read')).toBe(false);
        expect(permissions.hasPermission('stores', 'create')).toBe(false);
        expect(permissions.hasPermission('pos', 'create')).toBe(true);
    });

    it('should identify system admin correctly', () => {
        const mockPermissions = {
            hasPermission: vi.fn(() => true),
            getModulePermissions: vi.fn(() => ({
                create: true,
                read: true,
                update: true,
                delete: true,
            })),
            getAllowedModules: vi.fn(() => [
                'products',
                'orders',
                'inventory',
                'users',
                'stores',
                'masterData',
                'pos',
                'receipts',
            ]),
            isAdmin: true,
            role: {
                id: 1,
                name: 'admin',
                isSystemAdmin: true,
                permissions: {} as any,
            },
        };

        (usePermissions as any).mockReturnValue(mockPermissions);

        const permissions = usePermissions();

        expect(permissions.role?.isSystemAdmin).toBe(true);
        expect(permissions.isAdmin).toBe(true);
    });
});
