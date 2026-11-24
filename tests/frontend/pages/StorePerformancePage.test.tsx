import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StorePerformancePage from '@/pages/StorePerformancePage';

// Recharts needs a real layout engine; these tests assert what the page decides to draw.
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
    Bar: (props: any) => <div data-testid="bar" data-key={props.dataKey} data-fill={props.fill} />,
    LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
    Line: (props: any) => <div data-testid="line" data-key={props.dataKey} />,
    CartesianGrid: (props: any) => <div data-testid="grid" data-stroke={props.stroke} />,
    XAxis: (props: any) => <div data-testid="x-axis" data-stroke={props.stroke} />,
    YAxis: (props: any) => <div data-testid="y-axis" data-stroke={props.stroke} />,
    Tooltip: () => <div data-testid="tooltip" />,
    Legend: () => <div data-testid="legend" />,
}));

interface StoreMetrics {
    storeId: number;
    storeName: string;
    orderCount: number;
    revenue: number;
    averageOrderValue: number;
    fulfillmentRate: number;
}

function payload(stores: StoreMetrics[]) {
    return {
        currentMetrics: stores,
        historicalData: stores.flatMap((store) =>
            ['2026-06-01', '2026-07-01'].map((month) => ({
                storeId: store.storeId,
                month,
                revenue: store.revenue,
                orderCount: store.orderCount,
            }))
        ),
        inventoryStatus: stores.map((store) => ({
            storeId: store.storeId,
            totalItems: store.revenue > 0 ? 10 : 0,
            lowStockItems: 1,
        })),
    };
}

function renderPage(stores: StoreMetrics[], fail = false) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                queryFn: async ({ queryKey }: any) => {
                    if (queryKey[0] !== '/api/stores/performance') return null;
                    if (fail) throw new Error('network down');
                    return payload(stores);
                },
                retry: false,
            },
        },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <StorePerformancePage />
        </QueryClientProvider>
    );
}

const selling: StoreMetrics = {
    storeId: 1,
    storeName: 'Mana House',
    orderCount: 12,
    revenue: 5_000_000,
    averageOrderValue: 416_667,
    fulfillmentRate: 0.75,
};

describe('StorePerformancePage states', () => {
    it('draws a revenue bar per store with the design-system token', async () => {
        renderPage([selling]);

        const bars = await screen.findAllByTestId('bar');
        const revenueBar = bars.find((bar) => bar.getAttribute('data-key') === 'revenue');
        expect(revenueBar).toHaveAttribute('data-fill', 'hsl(var(--chart-1))');
        const grids = screen.getAllByTestId('grid');
        expect(grids.every((grid) => grid.getAttribute('data-stroke') === 'hsl(var(--border))')).toBe(true);
    });

    it('draws one history line per store, keyed by name', async () => {
        renderPage([selling]);

        const line = await screen.findByTestId('line');
        expect(line).toHaveAttribute('data-key', 'Mana House');
    });

    it('says there is no revenue instead of drawing bare axes', async () => {
        renderPage([{ ...selling, orderCount: 0, revenue: 0, averageOrderValue: 0, fulfillmentRate: 0 }]);

        expect(await screen.findByText('No revenue recorded this month')).toBeInTheDocument();
        expect(screen.getByText('No revenue in the last 6 months')).toBeInTheDocument();
        expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    });

    it('says the figures are unavailable when the request fails - never a fake zero', async () => {
        renderPage([selling], true);

        expect(await screen.findByText('Store performance could not be loaded')).toBeInTheDocument();
        expect(screen.getByText(/unavailable, not zero/)).toBeInTheDocument();
        expect(screen.getByText('Revenue figures unavailable')).toBeInTheDocument();
    });

    it('explains that an empty store list is a scoping problem, not an empty month', async () => {
        renderPage([]);

        expect(await screen.findByText('No stores to compare')).toBeInTheDocument();
    });
});
