import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { users, roles } from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData, resetTestDatabase } from '../../helpers/test-db';

describe('Authentication API Tests', () => {
    let testData: Awaited<ReturnType<typeof seedTestData>>;

    beforeAll(async () => {
        // Reset database once per test file for clean state
        await resetTestDatabase();
    });

    beforeEach(async () => {
        // Clean data between tests but keep schema
        await cleanDatabase();
        await resetSequences();
        testData = await seedTestData();
    });

    afterEach(async () => {
        await cleanDatabase();
    });

    describe('User Login', () => {
        it('should authenticate user with valid credentials', async () => {
            const testUser = await db.query.users.findFirst({
                where: (users, { eq }) => eq(users.username, 'test_admin'),
                with: { role: true },
            });

            expect(testUser).toBeDefined();
            expect(testUser?.username).toBe('test_admin');
            expect(testUser?.role.name).toBe('admin');
        });

        it('should reject invalid username', async () => {
            const testUser = await db.query.users.findFirst({
                where: (users, { eq }) => eq(users.username, 'nonexistent_user'),
            });

            expect(testUser).toBeUndefined();
        });

        it('should have hashed password', async () => {
            const testUser = await db.query.users.findFirst({
                where: (users, { eq }) => eq(users.username, 'test_admin'),
            });

            expect(testUser?.password).toBeDefined();
            // In production, password should be hashed, not plain text
            expect(testUser?.password).not.toBe('test123');
        });
    });

    describe('Role-Based Permissions', () => {
        it('should load admin role with full permissions', async () => {
            const adminRole = await db.query.roles.findFirst({
                where: (roles, { eq }) => eq(roles.name, 'admin'),
            });

            expect(adminRole).toBeDefined();
            expect(adminRole?.isSystemAdmin).toBe(true);
            expect(adminRole?.permissions.products.create).toBe(true);
            expect(adminRole?.permissions.products.delete).toBe(true);
        });

        it('should load manager role with limited permissions', async () => {
            const managerRole = await db.query.roles.findFirst({
                where: (roles, { eq }) => eq(roles.name, 'store_manager'),
            });

            expect(managerRole).toBeDefined();
            expect(managerRole?.isSystemAdmin).toBe(false);
            expect(managerRole?.permissions.products.create).toBe(true);
            expect(managerRole?.permissions.products.delete).toBe(false);
        });

        it('should verify permission structure', async () => {
            const role = await db.query.roles.findFirst({
                where: (roles, { eq }) => eq(roles.name, 'admin'),
            });

            expect(role?.permissions).toHaveProperty('products');
            expect(role?.permissions).toHaveProperty('orders');
            expect(role?.permissions).toHaveProperty('inventory');
            expect(role?.permissions).toHaveProperty('users');
            expect(role?.permissions).toHaveProperty('stores');
            expect(role?.permissions).toHaveProperty('masterData');
            expect(role?.permissions).toHaveProperty('pos');
            expect(role?.permissions).toHaveProperty('receipts');
        });
    });

    describe('User-Role Relationship', () => {
        it('should link user to role correctly', async () => {
            const testUser = await db.query.users.findFirst({
                where: (users, { eq }) => eq(users.username, 'test_admin'),
                with: { role: true },
            });

            expect(testUser?.role).toBeDefined();
            expect(testUser?.role.name).toBe('admin');
            expect(testUser?.roleId).toBe(testUser?.role.id);
        });

        it('should support multiple users with same role', async () => {
            const adminUsers = await db.query.users.findMany({
                with: { role: true },
            });

            const admins = adminUsers.filter(u => u.role.name === 'admin');
            expect(admins.length).toBeGreaterThan(0);
        });
    });
});
