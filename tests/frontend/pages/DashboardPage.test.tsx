import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from '@/pages/DashboardPage';

// Recharts needs a real layout engine; the point of these tests is the props the
// dashboard passes down, so stub the components and inspect what they receive.
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
    Line: (props: any) => (
        <div data-testid="line" data-stroke={props.stroke} data-stroke-width={props.strokeWidth} />
    ),
    CartesianGrid: (props: any) => <div data-testid="grid" data-stroke={props.stroke} />,
    XAxis: (props: any) => <div data-testid="x-axis" data-stroke={props.stroke} />,
    YAxis: (props: any) => <div data-testid="y-axis" data-stroke={props.stroke} />,
    Tooltip: (props: any) => (
        <div data-testid="tooltip" data-background={props.contentStyle?.background} />
    ),
}));

vi.mock('@/components/Dashboard/StatsCards', () => ({
    default: () => <div data-testid="stats-cards" />,
}));

function renderDashboard(lowStock: Array<{ id: number; name: string; quantity: number }> = []) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                // Serve canned data instead of hitting the API.
                queryFn: async ({ queryKey }: any) =>
                    queryKey[0] === '/api/stats'
                        ? { lowStock }
                        : [{ date: '2025-01-01', orders: 4 }],
                retry: false,
            },
        },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <DashboardPage />
        </QueryClientProvider>
    );
}

describe('DashboardPage charts', () => {
    it('draws the series with the design-system chart token, not a hardcoded colour', () => {
        renderDashboard();

        const line = screen.getByTestId('line');
        expect(line).toHaveAttribute('data-stroke', 'hsl(var(--chart-1))');
        expect(line.getAttribute('data-stroke')).not.toMatch(/#[0-9a-f]{3,6}/i);
    });

    it('themes the grid, both axes and the tooltip so dark mode stays readable', () => {
        renderDashboard();

        expect(screen.getByTestId('grid')).toHaveAttribute('data-stroke', 'hsl(var(--border))');
        expect(screen.getByTestId('x-axis')).toHaveAttribute('data-stroke', 'hsl(var(--muted-foreground))');
        expect(screen.getByTestId('y-axis')).toHaveAttribute('data-stroke', 'hsl(var(--muted-foreground))');
        expect(screen.getByTestId('tooltip')).toHaveAttribute('data-background', 'hsl(var(--popover))');
    });

    it('renders low stock warnings with the destructive token', async () => {
        renderDashboard([{ id: 1, name: 'Chew Toy', quantity: 2 }]);

        const warning = await screen.findByText('2 remaining');
        expect(warning).toHaveClass('text-destructive');
        expect(screen.getByText('Chew Toy')).toBeInTheDocument();
    });
});
