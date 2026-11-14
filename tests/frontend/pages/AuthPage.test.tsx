import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuthPage from '@/pages/AuthPage';

// Toast rendering is not under test - the alert is.
vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

const DATABASE_SUGGESTION =
    'The server cannot reach the database. Check that PostgreSQL is running and reachable, then try again. If the problem persists, contact support.';

function response(status: number, statusText: string, body: unknown): Response {
    return {
        ok: false,
        status,
        statusText,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as Response;
}

function renderPage() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <AuthPage />
        </QueryClientProvider>,
    );
}

async function submitCredentials(username = 'admin', password = 'admin123') {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/username/i), username);
    await user.type(screen.getByLabelText(/password/i), password);
    await user.click(screen.getByRole('button', { name: /login/i }));
}

describe('AuthPage login errors', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'fetch',
            vi.fn((input: RequestInfo | URL) => {
                const url = String(input);
                // Session probe on mount - nobody is logged in yet.
                if (url.includes('/api/user')) {
                    return Promise.resolve(
                        response(401, 'Unauthorized', {
                            message: 'Not logged in',
                            suggestion: 'Please log in to access this resource',
                        }),
                    );
                }
                // The database is unreachable.
                return Promise.resolve(
                    response(503, 'Service Unavailable', {
                        message: 'Database unavailable',
                        suggestion: DATABASE_SUGGESTION,
                    }),
                );
            }),
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('shows the server message and suggestion as readable text, not a JSON blob', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        renderPage();

        await submitCredentials();

        expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
        expect(screen.getByText(DATABASE_SUGGESTION)).toBeInTheDocument();
        // The old behaviour put the whole response body in the alert title.
        expect(screen.queryByText(/\{"message":/)).not.toBeInTheDocument();
    });
});
