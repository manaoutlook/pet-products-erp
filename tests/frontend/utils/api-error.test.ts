import { describe, it, expect, vi, afterEach } from 'vitest';
import { readApiError } from '@/lib/apiError';

/**
 * `readApiError` is the one place that turns a failed `Response` into the text of a toast.
 *
 * Showing `await res.text()` directly used to dump raw `{"message":…,"suggestion":…}` JSON into
 * toasts, so each branch here is a shape the server actually produces: a validation body with a
 * suggestion, a body with only a message, a plain-text 401 from `requireAuth`, an empty body, and
 * a body that cannot be read at all.
 */

function response(init: {
    status?: number;
    statusText?: string;
    body?: string;
    text?: () => Promise<string>;
}) {
    const { status = 400, statusText = 'Bad Request', body = '', text } = init;
    return {
        status,
        statusText,
        text: text ?? (async () => body),
    } as unknown as Response;
}

describe('readApiError', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('joins the message and the suggestion', async () => {
        const res = response({
            body: JSON.stringify({ message: 'Store not found', suggestion: 'Please verify the store ID' }),
        });

        await expect(readApiError(res)).resolves.toBe('Store not found Please verify the store ID');
    });

    it('uses the message alone when there is no suggestion', async () => {
        const res = response({ body: JSON.stringify({ message: 'Failed to fetch stores' }) });

        await expect(readApiError(res)).resolves.toBe('Failed to fetch stores');
    });

    it('passes plain text through untouched (a non-JSON 401)', async () => {
        const res = response({ status: 401, statusText: 'Unauthorized', body: 'Unauthorized' });

        await expect(readApiError(res)).resolves.toBe('Unauthorized');
    });

    it('falls back to the status line when the body is empty', async () => {
        const res = response({ status: 500, statusText: 'Internal Server Error', body: '' });

        await expect(readApiError(res)).resolves.toBe('Request failed (500 Internal Server Error)');
    });

    it('falls back to the status line when the body cannot be read', async () => {
        const res = response({ status: 502, statusText: 'Bad Gateway', text: async () => Promise.reject(new Error('aborted')) });

        await expect(readApiError(res)).resolves.toBe('Request failed (502 Bad Gateway)');
    });

    it('returns raw JSON text when it has no message field', async () => {
        const body = JSON.stringify({ error: 'boom' });
        const res = response({ body });

        // Better to show the operator something than an empty toast.
        await expect(readApiError(res)).resolves.toBe(body);
    });
});
