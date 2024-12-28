import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/use-user";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  PackageSearch,
  Users,
  Settings,
  LogOut,
} from "lucide-react";

function Sidebar() {
  const [location] = useLocation();
  const { logout, user } = useUser();

  // Define navigation items with role-based access
  const navigationItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard, roles: ['admin'] },
    { name: "Products", href: "/products", icon: Package, roles: ['admin', 'user'] },
    { name: "Orders", href: "/orders", icon: ShoppingCart, roles: ['admin'] },
    { name: "Inventory", href: "/inventory", icon: PackageSearch, roles: ['admin'] },
    { name: "Users", href: "/users", icon: Users, roles: ['admin'] },
    { name: "Roles", href: "/roles", icon: Settings, roles: ['admin'] },
  ];

  // Filter navigation items based on user role
  const authorizedNavItems = navigationItems.filter(
    item => user?.role?.name && item.roles.includes(user.role.name)
  );

  return (
    <div className="flex flex-col w-64 bg-sidebar border-r">
      <div className="p-4">
        <h1 className="text-xl font-bold">Pet Products ERP</h1>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        {authorizedNavItems.map((item) => (
          <Link key={item.name} href={item.href}>
            <a
              className={cn(
                "flex items-center px-2 py-2 text-sm font-medium rounded-md",
                location === item.href
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <item.icon className="mr-3 h-5 w-5" />
              {item.name}
            </a>
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t">
        <div className="flex items-center mb-4">
          <div className="ml-3">
            <p className="text-sm font-medium">{user?.username}</p>
            <p className="text-xs text-muted-foreground capitalize">{user?.role?.name}</p>
          </div>
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => logout()}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </Button>
      </div>
    </div>
  );
}

export default Sidebar;