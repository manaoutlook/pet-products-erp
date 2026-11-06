import postgres from 'postgres';
import { configureTestEnvironment } from './helpers/env-setup';

/**
 * Extract the database name from a postgres connection string.
 * `postgres://user:pass@host:5432/pet_erp_test?sslmode=require` -> `pet_erp_test`
 */
function databaseNameFromUrl(url: string): string {
    const match = url.match(/\/([^/?]+)(\?.*)?$/);
    return match ? decodeURIComponent(match[1]) : 'smart_erp_test';
}

export default async function setup() {
    console.log('Running global test setup...');

    const testUrl = configureTestEnvironment();
    console.log('Configured DATABASE_URL:', process.env.DATABASE_URL);

    // Import database modules after environment is configured
    const { db } = await import('../db/index');
    const { sql } = await import('drizzle-orm');
    const { runMigrations } = await import('./helpers/test-db');

    if (testUrl) {
        console.log('Using test database:', testUrl.replace(/:[^:@]+@/, ':***@'));

        try {
            // Ensure test database exists. The name has to come from the
            // configured URL (.env.test / CI env) instead of being hardcoded:
            // probing "smart_erp_test" while connecting to "pet_erp_test" made
            // the connection fail with CONNECTION_ENDED because the database
            // that was actually used had never been created.
            const adminUrl = testUrl.replace(/(^postgresql?:\/\/.*\/)([^?]+)(\?.*)?$/, '$1postgres$3');
            const sql = postgres(adminUrl);
            const dbName = databaseNameFromUrl(testUrl);

            const dbs = await sql`SELECT datname FROM pg_database WHERE datname = ${dbName}`;
            if (dbs.length === 0) {
                console.log(`Creating test database: ${dbName}...`);
                await sql.unsafe(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
                console.log('Test database created successfully.');
            } else {
                console.log('Test database already exists.');
            }
            await sql.end();
        } catch (e: any) {
            console.warn('Warning: Could not check/create test database:', e.message);
        }

        // Run migrations once during global setup
        try {
            console.log('Running migrations on test database...');
            await runMigrations();
            console.log('Migrations completed successfully.');
        } catch (error: any) {
            // If migrations fail due to existing tables, that's OK - database is already set up
            if (error.message && error.message.includes('already exists')) {
                console.log('Some tables already exist, continuing with migrations...');
                // Continue - Drizzle will handle existing tables gracefully
            } else {
                console.error('Migration failed:', error);
                throw error;
            }
        }
    } else {
        console.error('Failed to configure test environment. DATABASE_URL missing or invalid.');
    }

    console.log('Global test setup completed.');
}
