import { describe, it, expect, vi, afterEach } from 'vitest';
import { queryClient } from '@/lib/queryClient';

/**
 * The app's one QueryClient, whose default `queryFn` fetches `queryKey[0]` as a URL.
 *
 * Two behaviours are load-bearing and easy to lose in a refactor:
 *   - cookies are sent (`credentials: "include"`), otherwise every screen sees `requireAuth`'s 401;
 *   - a 4xx error carries the server's `{ message, suggestion }` body, while a 5xx keeps the raw
 *     status line, because a gateway error has no JSON to show.
 */

const defaultQueryFn = () =>
    queryClient.getDefaultOptions().queries?.queryFn as (context: {
        queryKey: readonly unknown[];
    }) => Promise<unknown>;

describe('queryClient defaults', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('fetches the query key as a URL with cookies', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const data = await defaultQueryFn()({ queryKey: ['/api/stores'] });

        expect(fetchMock).toHaveBeenCalledWith('/api/stores', { credentials: 'include' });
        expect(data).toEqual([{ id: 1 }]);
    });

    it('surfaces the server body for a 4xx', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ message: 'Store not found', suggestion: 'Try again' }), { status: 400, statusText: 'Bad Request' })),
        );

        await expect(defaultQueryFn()({ queryKey: ['/api/stores/9'] })).rejects.toThrow(
            '400: {"message":"Store not found","suggestion":"Try again"}',
        );
    });

    it('keeps the status line for a 5xx', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503, statusText: 'Service Unavailable' })));

        await expect(defaultQueryFn()({ queryKey: ['/api/stores'] })).rejects.toThrow(
            '503: Service Unavailable',
        );
    });

    it('does not retry - a failed request fails once', () => {
        const queries = queryClient.getDefaultOptions().queries;

        expect(queries?.retry).toBe(false);
        expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
    });
});
