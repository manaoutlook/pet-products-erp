import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from '@/pages/DashboardPage';

// Recharts needs a real layout engine; the point of these tests is the props the
// dashboard passes down, so stub the components and inspect what they receive.
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
    Area: (props: any) => (
        <div data-testid="area" data-stroke={props.stroke} data-fill={props.fill} />
    ),
    CartesianGrid: (props: any) => <div data-testid="grid" data-stroke={props.stroke} />,
    XAxis: (props: any) => <div data-testid="x-axis" data-stroke={props.stroke} />,
    YAxis: (props: any) => <div data-testid="y-axis" data-stroke={props.stroke} />,
    Tooltip: (props: any) => (
        <div data-testid="tooltip" data-custom-content={props.content ? 'true' : 'false'} />
    ),
}));

// The page links to the screens behind each figure; a plain anchor is enough for the assertions.
vi.mock('wouter', () => ({
    Link: ({ href, children, ...rest }: any) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

vi.mock('@/components/Dashboard/StatsCards', () => ({
    default: () => <div data-testid="stats-cards" />,
}));

type LowStock = { id: number; name: string; sku?: string; quantity: number; minStock: number };

function dashboardPayload(lowStock: LowStock[], orders = 1) {
    return {
        stats: {
            last30Days: { orders, revenue: orders * 100000, from: '2026-04-03', to: '2026-05-02' },
            previous30Days: { orders: 0, revenue: 0 },
            growth: null,
            totalProducts: 1,
            lowStock,
            today: { orders: 0, revenue: 0 },
            receivables: { outstanding: 0, unpaidInvoices: 0, overdueInvoices: 0 },
        },
        trend: [
            {
                date: '2026-05-01',
                orders,
                revenue: orders * 100000,
                posSales: orders,
                salesOrders: 0,
            },
        ],
    };
}

function renderDashboard(lowStock: LowStock[] = [], orders = 1, fail = false) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                // Serve canned data instead of hitting the API.
                queryFn: async ({ queryKey }: any) => {
                    if (queryKey[0] !== '/api/dashboard') return null;
                    if (fail) throw new Error('network down');
                    return dashboardPayload(lowStock, orders);
                },
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
    it('draws the series with the design-system chart token, not a hardcoded colour', async () => {
        renderDashboard();

        const area = await screen.findByTestId('area');
        expect(area).toHaveAttribute('data-stroke', 'hsl(var(--chart-1))');
        expect(area.getAttribute('data-stroke')).not.toMatch(/#[0-9a-f]{3,6}/i);
    });

    it('themes the grid and both axes so dark mode stays readable', async () => {
        renderDashboard();

        expect(await screen.findByTestId('grid')).toHaveAttribute(
            'data-stroke',
            'hsl(var(--border))'
        );
        expect(screen.getByTestId('x-axis')).toHaveAttribute(
            'data-stroke',
            'hsl(var(--muted-foreground))'
        );
        expect(screen.getByTestId('y-axis')).toHaveAttribute(
            'data-stroke',
            'hsl(var(--muted-foreground))'
        );
    });

    it('uses its own token-styled tooltip instead of recharts white-on-black defaults', async () => {
        renderDashboard();

        // The tooltip is a component (so it can show revenue AND the channel split), which means
        // its colours come from `bg-popover` / `text-popover-foreground` rather than inline styles.
        expect(await screen.findByTestId('tooltip')).toHaveAttribute(
            'data-custom-content',
            'true'
        );
    });

    it('shows an empty state, not an empty grid, when nothing was sold', async () => {
        renderDashboard([], 0);

        expect(await screen.findByText('No sales in the last 30 days')).toBeInTheDocument();
        expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    });

    it('renders low stock warnings with the destructive token', async () => {
        renderDashboard([{ id: 1, name: 'Chew Toy', sku: 'TOY-1', quantity: 2, minStock: 10 }]);

        const warning = await screen.findByText('2 left · min 10');
        expect(warning).toHaveClass('text-destructive');
        expect(screen.getByText('Chew Toy')).toBeInTheDocument();
    });

    it('says so when nothing is below its minimum level', async () => {
        renderDashboard([]);

        expect(await screen.findByText('Nothing needs reordering')).toBeInTheDocument();
    });

    it('says the figures are unavailable when the request fails - never a fake zero', async () => {
        renderDashboard([], 1, true);

        expect(await screen.findByText('The dashboard could not be loaded')).toBeInTheDocument();
        expect(screen.getByText(/unavailable, not zero/)).toBeInTheDocument();
    });
});

