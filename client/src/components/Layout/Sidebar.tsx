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
  BarChart,
  Network,
  Folders,
  Tags,
  Building2
} from "lucide-react";

interface NavItem {
  name: string;
  href?: string;
  icon: any;
  module?: 'products' | 'orders' | 'inventory' | 'users' | 'stores';
  action?: 'create' | 'read' | 'update' | 'delete';
  adminOnly?: boolean;
  children?: NavItem[];
}

function Sidebar() {
  const [location] = useLocation();
  const { logout, user } = useUser();
  const { hasPermission, isAdmin } = usePermissions();
  const isSystemAdmin = user?.role?.roleType?.description === 'System Administrator';

  const navigationItems: NavItem[] = [
    { 
      name: "Dashboard", 
      href: "/", 
      icon: LayoutDashboard 
    },
    {
      name: "Master Data",
      icon: Settings,
      children: [
        {
          name: "Categories",
          href: "/categories",
          icon: Folders,
          module: 'products',
          action: 'read'
        },
        {
          name: "Brands",
          href: "/brands",
          icon: Tags,
          module: 'products',
          action: 'read'
        },
        {
          name: "Suppliers",
          href: "/suppliers",
          icon: Building2,
          module: 'products',
          action: 'read'
        }
      ]
    },
    { 
      name: "Products", 
      icon: Package,
      children: [
        {
          name: "Product List",
          href: "/products",
          icon: Package,
          module: 'products',
          action: 'read'
        }
      ]
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
      icon: Store,
      children: [
        { 
          name: "Store List", 
          href: "/stores", 
          icon: Store,
          module: 'stores',
          action: 'read'
        },
        { 
          name: "Store Performance", 
          href: "/store-performance", 
          icon: BarChart,
          module: 'stores',
          action: 'read'
        }
      ]
    },
    {
      name: "User Management",
      icon: UserCog,
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
        { 
          name: "Role Mapping", 
          href: "/role-mapping", 
          icon: Network,
          adminOnly: true
        },
      ],
    },
  ];

  const hasAccess = (item: NavItem): boolean => {
    // System admins have access to everything
    if (isSystemAdmin) {
      return true;
    }

    // Admin-only items are accessible only to admins
    if (item.adminOnly) {
      return isAdmin;
    }

    // If the item has module and action requirements, check permissions
    if (item.module && item.action) {
      return hasPermission(item.module, item.action);
    }

    // For items with children, check if at least one child is accessible
    if (item.children) {
      return item.children.some(child => hasAccess(child));
    }

    // Items without specific requirements are accessible
    return true;
  };

  const renderNavItem = (item: NavItem) => {
    // Skip rendering if user doesn't have access
    if (!hasAccess(item)) {
      return null;
    }

    // Handle items with children (submenus)
    if (item.children) {
      const accessibleChildren = item.children.filter(child => hasAccess(child));
      if (accessibleChildren.length === 0) {
        return null;
      }

      return (
        <div key={item.name} className="space-y-1">
          <div className={cn(
            "flex items-center px-2 py-2 text-sm font-medium rounded-md text-sidebar-foreground",
          )}>
            <item.icon className="mr-3 h-5 w-5" />
            {item.name}
          </div>
          <div className="pl-4 space-y-1">
            {accessibleChildren.map(child => renderNavItem(child))}
          </div>
        </div>
      );
    }

    // Skip rendering items without href
    if (!item.href) {
      return null;
    }

    // Render regular menu items
    return (
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