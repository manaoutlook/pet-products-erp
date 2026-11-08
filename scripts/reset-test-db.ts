/**
 * `npm run test:db:reset`
 *
 * Drops and recreates the schema of the test database, then re-applies db/schema.ts with
 * `drizzle-kit push`. `package.json` advertised this command, but the file it pointed at
 * did not exist.
 *
 * The URL comes from `tests/helpers/env-setup.ts` - the same resolver the suites use - so
 * this cannot target a different database than the tests do (that resolver normalises the
 * name to `smart_erp_test`, which is why dropping and recreating by reading `.env.test`
 * directly failed with "database pet_erp_test does not exist").
 *
 * It refuses to touch a database whose name does not contain "test".
 */
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { configureTestEnvironment } from '../tests/helpers/env-setup';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testUrl = configureTestEnvironment();

if (!testUrl) {
    console.error('No TEST_DATABASE_URL/DATABASE_URL found in .env.test - nothing to reset.');
    process.exit(1);
}

const databaseName = testUrl.replace(/\/$/, '').split('/').pop()?.split('?')[0] ?? '';

if (!databaseName.includes('test')) {
    console.error(
        `Refusing to reset "${databaseName}": the database name must contain "test". ` +
        'Point TEST_DATABASE_URL at the test database in .env.test.',
    );
    process.exit(1);
}

async function main() {
    console.log(`Resetting ${databaseName}...`);
    const client = postgres(testUrl as string, { max: 1 });

    try {
        await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
        await client.unsafe('CREATE SCHEMA public');
        console.log('Schema dropped and recreated.');
    } finally {
        await client.end({ timeout: 5 }).catch(() => {});
    }

    console.log('Applying db/schema.ts with drizzle-kit push...');
    execFileSync('npx', ['drizzle-kit', 'push'], {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: testUrl },
    });

    console.log('Test database reset complete.');
}

main().catch((error) => {
    console.error('Test database reset failed:', error);
    process.exit(1);
});
