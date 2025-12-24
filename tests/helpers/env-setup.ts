import * as dotenv from 'dotenv';
import path from 'path';

export function configureTestEnvironment() {
    // Load .env.test specifically for tests
    dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

    const testUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (testUrl) {
        // Ensure we're using the test database
        let finalTestUrl = testUrl;
        if (!testUrl.includes('pet_erp_test')) {
            finalTestUrl = testUrl.replace(/(^postgresql?:\/\/.*\/)([^?]+)(\?.*)?$/, '$1pet_erp_test$3');
        }

        process.env.DATABASE_URL = finalTestUrl;
        process.env.TEST_DATABASE_URL = finalTestUrl;
        return finalTestUrl;
    }
    return null;
}
