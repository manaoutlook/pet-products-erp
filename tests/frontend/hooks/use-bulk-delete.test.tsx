import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRestBulkDelete } from '@/hooks/use-bulk-delete';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
    const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useRestBulkDelete', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        toastMock.mockReset();
    });

    it('deletes every selected id and keeps only the records the server refused', async () => {
        const onDeleted = vi.fn();
        const fetchMock = vi.fn(async (input: any, init?: any) => {
            const url = String(input);
            const method = (init?.method ?? 'GET').toUpperCase();
            expect(method).toBe('DELETE');

            if (url.endsWith('/1')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ message: 'deleted' }),
                    text: async () => '{"message":"deleted"}',
                } as Response;
            }

            return {
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                text: async () => JSON.stringify({ message: 'Item is still in use' }),
            } as Response;
        });
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(
            () =>
                useRestBulkDelete({
                    endpoint: '/api/items',
                    singular: 'item',
                    plural: 'items',
                    getLabel: (id) => (id === 1 ? 'First item' : 'Second item'),
                    onDeleted,
                }),
            { wrapper }
        );

        act(() => {
            result.current.toggleSelection(1);
            result.current.toggleSelection(2);
        });
        expect(result.current.selectedCount).toBe(2);

        act(() => {
            result.current.confirmDelete();
        });

        await waitFor(() => {
            expect(result.current.isPending).toBe(false);
            expect(result.current.selectedIds).toEqual([2]);
        });

        expect(onDeleted).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([
            '/api/items/1',
            '/api/items/2',
        ]);

        // Partial success is reported as a success toast that names the refused row.
        expect(toastMock).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'items deleted',
                description: expect.stringContaining('Second item: Item is still in use'),
                variant: 'success',
            })
        );
    });

    it('only selects the rows that are currently visible', async () => {
        const { result } = renderHook(
            () =>
                useRestBulkDelete({
                    endpoint: '/api/items',
                    singular: 'item',
                    plural: 'items',
                }),
            { wrapper }
        );

        act(() => {
            result.current.toggleSelection(99);
            result.current.toggleSelectAll([1, 2]);
        });

        expect(result.current.selectedIds).toEqual([99, 1, 2]);
        expect(result.current.selectionState([1, 2])).toEqual({
            allSelected: true,
            someSelected: false,
        });

        act(() => {
            result.current.toggleSelectAll([1, 2]);
        });

        expect(result.current.selectedIds).toEqual([99]);
        expect(result.current.selectionState([1, 2])).toEqual({
            allSelected: false,
            someSelected: false,
        });
    });
});
