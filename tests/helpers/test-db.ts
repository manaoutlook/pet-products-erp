import { db } from '../../db/index';
import { sql } from 'drizzle-orm';

/**
 * Check database health and connectivity
 */
export async function checkDatabaseHealth() {
    try {
        await db.execute(sql.raw('SELECT 1'));
        return true;
    } catch (error) {
        console.error('Database health check failed:', error);
        return false;
    }
}
import {
    users,
    roles,
    stores,
    products,
    categories,
    brands,
    suppliers,
    inventory,
    salesTransactions,
    salesTransactionItems,
    purchaseOrders,
    purchaseOrderItems,
    transferRequests,
    transferRequestItems,
    invoiceCounters,
    userStoreAssignments,
} from '../../db/schema';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'path';
import * as bcrypt from 'bcrypt';

export async function runMigrations() {
    // Use drizzle-kit push to ensure schema is created properly
    const { execSync } = await import('child_process');
    try {
        execSync('npx drizzle-kit push', {
            cwd: path.resolve(__dirname, '../..'),
            stdio: 'inherit',
            env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL }
        });
    } catch (error) {
        console.warn('drizzle-kit push failed, trying migrate fallback:', error);
        // Fallback to the original migrate function
        await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../migrations') });
    }
}

/**
 * Clean all test data from database
 */
export async function cleanDatabase() {
    // Delete in order to respect foreign key constraints
    // Use try-catch for each delete to handle missing tables gracefully
    const tablesToClean = [
        salesTransactionItems,
        salesTransactions,
        transferRequestItems,
        transferRequests,
        purchaseOrderItems,
        purchaseOrders,
        inventory,
        userStoreAssignments,
        products,
        categories,
        brands,
        suppliers,
        stores,
        users,
        roles,
        invoiceCounters,
    ];

    for (const table of tablesToClean) {
        try {
            await db.delete(table);
        } catch (error) {
            // Ignore errors for missing tables
        }
    }
}

/**
 * Reset database sequences
 */
export async function resetSequences() {
    const sequences = [
        'roles_id_seq',
        'users_id_seq',
        'stores_id_seq',
        'categories_id_seq',
        'brands_id_seq',
        'suppliers_id_seq',
        'products_id_seq',
        'inventory_id_seq',
        'purchase_orders_id_seq',
        'purchase_order_items_id_seq',
        'sales_transactions_id_seq',
        'sales_transaction_items_id_seq',
        'transfer_requests_id_seq',
        'transfer_request_items_id_seq',
        'invoice_counters_id_seq',
        'user_store_assignments_id_seq',
    ];

    for (const sequence of sequences) {
        try {
            await db.execute(sql.raw(`ALTER SEQUENCE ${sequence} RESTART WITH 1`));
        } catch (error) {
            // Sequence might not exist, ignore error
        }
    }
}

/**
 * Seed basic test data
 */
export async function resetTestDatabase() {
    try {
        console.log('Resetting test database completely...');

        // Close current database connection to avoid conflicts
        await db.$client.end();

        // Use postgres library to recreate database completely
        const postgres = (await import('postgres')).default;
        const testUrl = process.env.DATABASE_URL!;

        // Get admin connection URL
        const adminUrl = testUrl.replace(/(^postgresql?:\/\/.*\/)([^?]+)(\?.*)?$/, '$1postgres$3');
        const sql = postgres(adminUrl);

        try {
            // Terminate all connections to the test database
            await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'pet_erp_test' AND pid <> pg_backend_pid()`;

            // Drop and recreate the database
            await sql`DROP DATABASE IF EXISTS pet_erp_test`;
            await sql`CREATE DATABASE pet_erp_test`;

            console.log('Test database recreated successfully.');
        } finally {
            await sql.end();
        }

        // Reconnect to the fresh database
        // Import db again to get new connection
        const { db: newDb } = await import('../../db/index');

        // Run migrations on the fresh database
        console.log('Running migrations...');
        await runMigrations();

        // Re-seed with fresh test data
        console.log('Seeding fresh test data...');
        await seedTestData();

        console.log('Database reset completed successfully.');
    } catch (error) {
        console.error('Failed to reset test database:', error);
        throw error;
    }
}

export async function seedTestData() {
    // Create test categories first (needed for products)
    const [category] = await db.insert(categories).values({
        name: 'Test Category',
        description: 'Test category description',
    }).returning();

    // Create test brands (needed for products)
    const [brand] = await db.insert(brands).values({
        name: 'Test Brand',
        description: 'Test brand description',
    }).returning();

    // Create test suppliers (needed for inventory and POs)
    const [supplier] = await db.insert(suppliers).values({
        name: 'Test Supplier Co.',
        contactInfo: '555-0003',
        address: 'Test Supplier Address',
    }).returning();

    // Create test stores
    const [store1] = await db.insert(stores).values({
        name: 'Test Store 1',
        type: 'RETAIL',
        location: 'Test Location 1',
        contactInfo: '555-0001',
    }).returning();

    const [warehouse] = await db.insert(stores).values({
        name: 'Test Warehouse',
        type: 'WAREHOUSE',
        location: 'Test Warehouse Location',
        contactInfo: '555-0002',
    }).returning();

    // Create test roles
    const [adminRole] = await db.insert(roles).values({
        name: 'admin',
        description: 'System Administrator',
        isSystemAdmin: true,
        permissions: {
            products: { create: true, read: true, update: true, delete: true },
            orders: { create: true, read: true, update: true, delete: true },
            inventory: { create: true, read: true, update: true, delete: true },
            users: { create: true, read: true, update: true, delete: true },
            stores: { create: true, read: true, update: true, delete: true },
            masterData: { create: true, read: true, update: true, delete: true },
            pos: { create: true, read: true, update: true, delete: true },
            receipts: { create: true, read: true, update: true, delete: true },
        },
    }).returning();

    const [managerRole] = await db.insert(roles).values({
        name: 'store_manager',
        description: 'Store Manager',
        isSystemAdmin: false,
        permissions: {
            products: { create: true, read: true, update: true, delete: false },
            orders: { create: true, read: true, update: true, delete: false },
            inventory: { create: true, read: true, update: true, delete: false },
            users: { create: false, read: true, update: false, delete: false },
            stores: { create: false, read: true, update: false, delete: false },
            masterData: { create: false, read: true, update: false, delete: false },
            pos: { create: true, read: true, update: true, delete: false },
            receipts: { create: true, read: true, update: true, delete: false },
        },
    }).returning();

    // Create test users (password: "test123")
    const [adminUser] = await db.insert(users).values({
        username: 'test_admin',
        password: await bcrypt.hash('test123', 10), // Hash password for auth tests
        roleId: adminRole.id,
    }).returning();

    const [managerUser] = await db.insert(users).values({
        username: 'test_manager',
        password: await bcrypt.hash('test123', 10),
        roleId: managerRole.id,
    }).returning();

    // Create test products
    const [product] = await db.insert(products).values({
        name: 'Test Product',
        description: 'Test product description',
        sku: 'TEST-001',
        price: '100.00',
        categoryId: category.id,
        brandId: brand.id,
        minStock: 10,
    }).returning();

    return {
        roles: { admin: adminRole, manager: managerRole },
        users: { admin: adminUser, manager: managerUser },
        stores: { store1, warehouse },
        categories: { category },
        brands: { brand },
        suppliers: { supplier },
        products: { product },
    };
}
