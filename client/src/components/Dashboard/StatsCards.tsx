import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Package, ShoppingCart, TrendingUp, DollarSign } from "lucide-react";
import { formatPrice } from "@/utils/price";

function StatsCards() {
  const { data: stats } = useQuery({
    queryKey: ['/api/stats'],
  });

  const cards = [
    {
      title: "Total Orders",
      value: stats?.totalOrders || 0,
      icon: ShoppingCart,
      description: "Total orders this month",
    },
    {
      title: "Revenue",
      value: formatPrice(stats?.revenue || 0),
      icon: DollarSign,
      description: "Revenue this month",
    },
    {
      title: "Products",
      value: stats?.totalProducts || 0,
      icon: Package,
      description: "Active products",
    },
    {
      title: "Growth",
      value: `${stats?.growth || 0}%`,
      icon: TrendingUp,
      description: "Growth from last month",
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