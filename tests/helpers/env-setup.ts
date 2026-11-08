import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM-safe: this helper is imported both by the vitest setup files and by
// scripts/reset-test-db.ts, which tsx runs as an ES module where `__dirname` does not exist.
const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function configureTestEnvironment() {
    // Load .env.test specifically for tests
    dotenv.config({ path: path.resolve(currentDir, '../../.env.test') });

    const testUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (testUrl) {
        // Ensure we're using the test database
        let finalTestUrl = testUrl;
        if (!testUrl.includes('smart_erp_test')) {
            finalTestUrl = testUrl.replace(/(^postgresql?:\/\/.*\/)([^?]+)(\?.*)?$/, '$1smart_erp_test$3');
        }

        process.env.DATABASE_URL = finalTestUrl;
        process.env.TEST_DATABASE_URL = finalTestUrl;
        return finalTestUrl;
    }
    return null;
}
