import { Link } from "wouter";
import {
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  Package,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatNumber } from "@/utils/format";

/**
 * What `/api/dashboard` returns under `stats`. The field names are the contract - see the AI Agent
 * Note on the route in server/routes.ts and on server/dashboard-stats.ts.
 */
export interface DashboardStats {
  last30Days: { orders: number; revenue: number; from: string; to: string };
  previous30Days: { orders: number; revenue: number };
  /** Percentage change in revenue vs the previous 30 days, `null` when there is no history. */
  growth: number | null;
  totalProducts: number;
  lowStock: { id: number; name: string; sku: string; quantity: number; minStock: number }[];
  today: { orders: number; revenue: number };
  receivables: { outstanding: number; unpaidInvoices: number; overdueInvoices: number };
}

/**
 * A tile's change against the previous 30 days.
 *
 * `null` is not `0`: with no earlier trading there is nothing to compare against, and "+100%" or
 * "flat" would both be inventions. The dash says so honestly.
 */
function Delta({ value }: { value?: number | null }) {
  // Undefined means "we could not load the figures" - a dash, never a claim about the trend.
  if (value === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  if (value === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" aria-hidden="true" />
        No previous 30 days
      </span>
    );
  }

  const rising = value > 0;
  const flat = value === 0;
  const Icon = flat ? Minus : rising ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={
        flat
          ? "inline-flex items-center gap-1 text-xs text-muted-foreground"
          : rising
            ? "inline-flex items-center gap-1 text-xs font-medium text-success"
            : "inline-flex items-center gap-1 text-xs font-medium text-destructive"
      }
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {`${value > 0 ? "+" : ""}${formatNumber(value, { maximumFractionDigits: 1 })}% vs previous 30 days`}
    </span>
  );
}

interface StatsCardsProps {
  stats?: DashboardStats;
  isLoading?: boolean;
}

/**
 * The four numbers the owner checks first.
 *
 * Every tile is a link to the screen that produced it, so a surprising figure is one click from
 * the documents behind it. Values render as skeletons while loading and as "-" on failure; a
 * missing figure must never look like a real zero.
 */
function StatsCards({ stats, isLoading = false }: StatsCardsProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-40" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const ordersDelta =
    stats && stats.previous30Days.orders > 0
      ? Math.round(
          ((stats.last30Days.orders - stats.previous30Days.orders) /
            stats.previous30Days.orders) *
            1000
        ) / 10
      : null;

  type Tile = {
    title: string;
    value: string;
    icon: typeof ShoppingCart;
    description: string;
    href: string;
    /** `undefined` = no comparison to show; `null` = no earlier period to compare against. */
    delta?: number | null;
  };

  const cards: Tile[] = [
    {
      title: "Sales",
      value: stats ? formatNumber(stats.last30Days.orders) : "—",
      icon: ShoppingCart,
      description: stats
        ? `${formatNumber(stats.today.orders)} today · POS + sales orders`
        : "Last 30 days",
      delta: stats ? ordersDelta : undefined,
      href: "/sales-orders",
    },
    {
      title: "Revenue",
      value: stats ? formatCurrency(stats.last30Days.revenue) : "—",
      icon: TrendingUp,
      description: stats
        ? `${formatCurrency(stats.today.revenue)} today · VAT inclusive`
        : "Last 30 days",
      delta: stats ? stats.growth : undefined,
      href: "/finance",
    },
    {
      title: "Products",
      value: stats ? formatNumber(stats.totalProducts) : "—",
      icon: Package,
      description: "In the catalogue",
      href: "/products",
    },
    {
      title: "Outstanding",
      value: stats ? formatCurrency(stats.receivables.outstanding) : "—",
      icon: Wallet,
      description: stats
        ? `${formatNumber(stats.receivables.unpaidInvoices)} unpaid${
            stats.receivables.overdueInvoices > 0
              ? ` · ${formatNumber(stats.receivables.overdueInvoices)} overdue`
              : ""
          }`
        : "Customer balances",
      href: "/receivables",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Link key={card.title} href={card.href} className="block rounded-xl">
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-2xl font-bold">{card.value}</div>
              <p className="text-xs text-muted-foreground">{card.description}</p>
              {card.delta !== undefined && (
                <div className="pt-1">
                  <Delta value={card.delta} />
                </div>
              )}
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default StatsCards;
