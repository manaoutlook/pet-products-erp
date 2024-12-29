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
  Store,
  LogOut,
  UserCog,
  Lock,
} from "lucide-react";

interface NavItem {
  name: string;
  href?: string;
  icon: any;
  roles: string[];
  children?: NavItem[];
}

function Sidebar() {
  const [location] = useLocation();
  const { logout, user } = useUser();

  // Define navigation items with role-based access and nested structure
  const navigationItems: NavItem[] = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard, roles: ['admin'] },
    { name: "Products", href: "/products", icon: Package, roles: ['admin', 'user'] },
    { name: "Orders", href: "/orders", icon: ShoppingCart, roles: ['admin'] },
    { name: "Inventory", href: "/inventory", icon: PackageSearch, roles: ['admin'] },
    { name: "Stores", href: "/stores", icon: Store, roles: ['admin'] },
    {
      name: "User Management",
      icon: UserCog,
      roles: ['admin'],
      children: [
        { name: "Users", href: "/users", icon: Users, roles: ['admin'] },
        { name: "Roles", href: "/roles", icon: Settings, roles: ['admin'] },
        { name: "Permissions", href: "/role-permissions", icon: Lock, roles: ['admin'] },
        { name: "Store Assignments", href: "/store-assignments", icon: Store, roles: ['admin'] },
      ],
    },
  ];

  // Filter navigation items based on user role
  const hasAccess = (item: NavItem) => {
    return user?.role?.name && item.roles.includes(user.role.name);
  };

  const renderNavItem = (item: NavItem) => {
    if (item.children) {
      return (
        <div key={item.name} className="space-y-1">
          <div className={cn(
            "flex items-center px-2 py-2 text-sm font-medium rounded-md text-sidebar-foreground",
          )}>
            <item.icon className="mr-3 h-5 w-5" />
            {item.name}
          </div>
          <div className="pl-4 space-y-1">
            {item.children.map(child => 
              hasAccess(child) && (
                <Link key={child.name} href={child.href!}>
                  <a
                    className={cn(
                      "flex items-center px-2 py-2 text-sm font-medium rounded-md",
                      location === child.href
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <child.icon className="mr-3 h-5 w-5" />
                    {child.name}
                  </a>
                </Link>
              )
            )}
          </div>
        </div>
      );
    }

    return item.href && (
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
    );
  };

  return (
    <div className="flex flex-col w-64 bg-sidebar border-r">
      <div className="p-4">
        <h1 className="text-xl font-bold">Pet Products ERP</h1>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        {navigationItems.map(item => hasAccess(item) && renderNavItem(item))}
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