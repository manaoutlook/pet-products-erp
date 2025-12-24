import { beforeAll, afterEach, afterAll, vi } from 'vitest';
import '@testing-library/jest-dom';
import { configureTestEnvironment } from './helpers/env-setup';

// Configure environment variables before any tests run
configureTestEnvironment();

// Global test setup
beforeAll(async () => {
    process.env.NODE_ENV = 'test';
});

afterEach(() => {
    vi.clearAllMocks();
});

afterAll(() => {
});
