import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/use-user";
import { usePermissions } from "@/hooks/use-permissions";
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
  module?: string;
  action?: 'create' | 'read' | 'update' | 'delete';
  adminOnly?: boolean;
  children?: NavItem[];
}

function Sidebar() {
  const [location] = useLocation();
  const { logout, user } = useUser();
  const { hasPermission, isAdmin } = usePermissions();

  // Define navigation items with permission-based access
  const navigationItems: NavItem[] = [
    { 
      name: "Dashboard", 
      href: "/", 
      icon: LayoutDashboard, 
      adminOnly: true 
    },
    { 
      name: "Products", 
      href: "/products", 
      icon: Package,
      module: 'products',
      action: 'read'
    },
    { 
      name: "Orders", 
      href: "/orders", 
      icon: ShoppingCart,
      module: 'orders',
      action: 'read'
    },
    { 
      name: "Inventory", 
      href: "/inventory", 
      icon: PackageSearch,
      module: 'inventory',
      action: 'read'
    },
    { 
      name: "Stores", 
      href: "/stores", 
      icon: Store,
      module: 'stores',
      action: 'read'
    },
    {
      name: "User Management",
      icon: UserCog,
      adminOnly: true,
      children: [
        { 
          name: "Users", 
          href: "/users", 
          icon: Users,
          module: 'users',
          action: 'read'
        },
        { 
          name: "Roles", 
          href: "/roles", 
          icon: Settings,
          adminOnly: true
        },
        { 
          name: "Permissions", 
          href: "/role-permissions", 
          icon: Lock,
          adminOnly: true
        },
        { 
          name: "Store Assignments", 
          href: "/store-assignments", 
          icon: Store,
          adminOnly: true
        },
      ],
    },
  ];

  // Check if user has access to the item based on permissions
  const hasAccess = (item: NavItem) => {
    if (item.adminOnly) {
      return isAdmin;
    }

    if (item.module && item.action) {
      return hasPermission(item.module, item.action);
    }

    if (item.children) {
      return item.children.some(child => hasAccess(child));
    }

    return true;
  };

  const renderNavItem = (item: NavItem) => {
    if (item.children) {
      // Only show parent item if user has access to at least one child
      const hasAccessibleChildren = item.children.some(child => hasAccess(child));
      if (!hasAccessibleChildren) return null;

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

    return item.href && hasAccess(item) && (
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
        {navigationItems.map(item => renderNavItem(item))}
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