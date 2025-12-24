import postgres from 'postgres';
import { configureTestEnvironment } from './helpers/env-setup';

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
            // Ensure test database exists
            const adminUrl = testUrl.replace(/(^postgresql?:\/\/.*\/)([^?]+)(\?.*)?$/, '$1postgres$3');
            const sql = postgres(adminUrl);

            const dbs = await sql`SELECT datname FROM pg_database WHERE datname = 'pet_erp_test'`;
            if (dbs.length === 0) {
                console.log('Creating test database: pet_erp_test...');
                await sql`CREATE DATABASE pet_erp_test`;
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
