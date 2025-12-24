import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'happy-dom',
        setupFiles: ['./tests/setup.ts'],
        globalSetup: ['./tests/global-setup.ts'],
        include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        exclude: ['node_modules', 'dist', 'build', '.git'],
        // Ensure test isolation
        isolate: true,
        // Run tests sequentially to avoid database conflicts
        pool: 'threads',
        // Longer timeout for database operations
        testTimeout: 15000,
        // Environment variables for tests
        env: {
            NODE_ENV: 'test',
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html', 'lcov'],
            exclude: ['node_modules/', 'tests/', '**/*.d.ts', '**/*.config.*', '**/mockData', 'dist/'],
            thresholds: {
                lines: 70,
                functions: 70,
                branches: 70,
                statements: 70,
            },
        },
        alias: {
            '@': path.resolve(__dirname, './client/src'),
            '@db': path.resolve(__dirname, './db/index.ts'),
            '@db/schema': path.resolve(__dirname, './db/schema.ts'),
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './client/src'),
            '@db': path.resolve(__dirname, './db/index.ts'),
            '@db/schema': path.resolve(__dirname, './db/schema.ts'),
        },
    },
});
