import postgres from 'postgres';
import { configureTestEnvironment } from './helpers/env-setup';

/**
 * Postgres advisory lock that serialises whole test runs.
 *
 * `fileParallelism: false` (vitest.config.ts) stops one process from running two
 * backend files at once, but nothing stopped two *processes* — an editor watcher plus
 * a manual `npm run test:backend`, or two terminals — from truncating the same
 * smart_erp_test tables while the other was asserting on them. The lock is taken on the
 * test database itself, so it only conflicts with runs that use the same database.
 */
const TEST_DB_ADVISORY_LOCK = 913471;
const LOCK_WAIT_MS = 60_000;
const LOCK_RETRY_MS = 1_000;

/**
 * Extract the database name from a postgres connection string.
 * `postgres://user:pass@host:5432/smart_erp_test?sslmode=require` -> `smart_erp_test`
 */
function databaseNameFromUrl(url: string): string {
    const match = url.match(/\/([^/?]+)(\?.*)?$/);
    return match ? decodeURIComponent(match[1]) : 'smart_erp_test';
}

type LockClient = ReturnType<typeof postgres>;

async function acquireTestDatabaseLock(client: LockClient): Promise<void> {
    const deadline = Date.now() + LOCK_WAIT_MS;
    let announced = false;

    while (Date.now() < deadline) {
        const [row] = await client`SELECT pg_try_advisory_lock(${TEST_DB_ADVISORY_LOCK}) AS locked`;
        if (row?.locked) {
            return;
        }

        if (!announced) {
            console.warn(
                'Another test run is using this database. Waiting for it to finish ' +
                `(up to ${LOCK_WAIT_MS / 1000}s)...`,
            );
            announced = true;
        }

        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }

    throw new Error(
        `Another test run is still using the test database after ${LOCK_WAIT_MS / 1000}s. ` +
        'Do not run two backend test suites at the same time: they share one database ' +
        'and truncate each other\'s tables.',
    );
}

export default async function setup() {
    console.log('Running global test setup...');

    const testUrl = configureTestEnvironment();
    console.log('Configured DATABASE_URL:', process.env.DATABASE_URL);

    // Import database modules after environment is configured
    const { db } = await import('../db/index');
    const { sql } = await import('drizzle-orm');
    const { runMigrations } = await import('./helpers/test-db');

    // Held for the whole run so two processes cannot migrate/truncate at once.
    let lockClient: LockClient | undefined;

    if (testUrl) {
        console.log('Using test database:', testUrl.replace(/:[^:@]+@/, ':***@'));

        try {
            // Ensure test database exists. The name has to come from the
            // configured URL (.env.test / CI env) instead of being hardcoded:
            // probing "smart_erp_test" while connecting to a differently named database
            // made the connection fail with CONNECTION_ENDED because the database
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

        // Take the run-wide lock before touching any table: migrations, truncation and
        // seeding below must not interleave with another process doing the same.
        lockClient = postgres(testUrl, { max: 1 });
        try {
            await acquireTestDatabaseLock(lockClient);
            console.log('Acquired the test database lock.');
        } catch (error) {
            await lockClient.end({ timeout: 1 }).catch(() => {});
            throw error;
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

    // Vitest runs whatever this returns after the whole suite finishes. The lock is
    // session-scoped, so it has to be released on this very connection before closing
    // it - otherwise a crashed run would keep the next one waiting.
    return async () => {
        if (!lockClient) return;

        try {
            await lockClient`SELECT pg_advisory_unlock(${TEST_DB_ADVISORY_LOCK})`;
        } catch (error: any) {
            console.warn('Could not release the test database lock:', error?.message);
        } finally {
            await lockClient.end({ timeout: 5 }).catch(() => {});
        }
    };
}
