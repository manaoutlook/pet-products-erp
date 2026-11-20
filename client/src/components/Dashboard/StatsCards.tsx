import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Package, ShoppingCart, TrendingUp, DollarSign } from "lucide-react";
import { formatPrice } from "@/utils/price";

/**
 * What `/api/stats` returns. The field names are the contract - see the AI Agent Note on the
 * route in server/routes.ts.
 */
interface DashboardStats {
  last30Days: { orders: number; revenue: number; from: string; to: string };
  previous30Days: { orders: number; revenue: number };
  /** Percentage change in revenue vs the previous 30 days, `null` when there is no history. */
  growth: number | null;
  totalProducts: number;
  lowStock: { id: number; name: string; sku: string; quantity: number; minStock: number }[];
}

function StatsCards() {
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['/api/stats'],
  });

  const cards = [
    {
      title: "Orders",
      value: stats?.last30Days?.orders ?? 0,
      icon: ShoppingCart,
      description: "Orders in the last 30 days",
    },
    {
      title: "Revenue",
      value: formatPrice(stats?.last30Days?.revenue ?? 0),
      icon: DollarSign,
      description: "Revenue in the last 30 days",
    },
    {
      title: "Products",
      value: stats?.totalProducts ?? 0,
      icon: Package,
      description: "Products in the catalogue",
    },
    {
      title: "Growth",
      // A shop with no earlier sales has no percentage to show; "—" says that honestly, where
      // "0%" would read as "sales were flat".
      value: stats?.growth == null ? "—" : `${stats.growth}%`,
      icon: TrendingUp,
      description:
        stats?.growth == null ? "No previous 30 days to compare" : "Revenue vs previous 30 days",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {card.title}
            </CardTitle>
            <card.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
            <p className="text-xs text-muted-foreground">
              {card.description}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default StatsCards;