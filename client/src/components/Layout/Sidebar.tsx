import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/use-user";
import { usePermissions } from "@/hooks/use-permissions";
import { useTheme } from "@/components/theme-provider";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  PackageSearch,
  Users,
  Settings,
  Store,
  LogOut,
  Sun,
  Moon,
  UserCog,
  Lock,
  BarChart,
  Network,
  Folders,
  Tags,
  Building2,
  ChevronRight,
  ClipboardList,
  ClipboardCheck,
  UserCircle,
  StoreIcon,
  ListIcon,
  ArrowRight,
  ShoppingBag
} from "lucide-react";
import { useState } from "react";

interface NavItem {
  name: string;
  href?: string;
  icon: any;
  module?: 'products' | 'orders' | 'inventory' | 'users' | 'stores' | 'masterData' | 'pos' | 'receipts' | 'customerProfiles';
  action?: 'create' | 'read' | 'update' | 'delete';
  adminOnly?: boolean;
  children?: NavItem[];
}

function Sidebar() {
  const [location] = useLocation();
  const { logout, user } = useUser();
  const { hasPermission, isAdmin } = usePermissions();
  const { resolvedTheme, toggleTheme } = useTheme();
  const isSystemAdmin = user?.role?.isSystemAdmin === true;
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const toggleExpanded = (name: string) => {
    setExpandedItems(prev =>
      prev.includes(name)
        ? prev.filter(item => item !== name)
        : [...prev, name]
    );
  };

  const navigationItems: NavItem[] = [
    {
      name: "Dashboard",
      href: "/",
      icon: LayoutDashboard
    },
    {
      name: "Master Data",
      icon: Settings,
      module: 'masterData',
      action: 'read',
      children: [
        {
          name: "Categories",
          href: "/categories",
          icon: Folders,
          module: 'masterData',
          action: 'read'
        },
        {
          name: "Brands",
          href: "/brands",
          icon: Tags,
          module: 'masterData',
          action: 'read'
        },
        {
          name: "Suppliers",
          href: "/suppliers",
          icon: Building2,
          module: 'masterData',
          action: 'read'
        }
      ]
    },
    {
      name: "Products",
      icon: Package,
      module: 'products',
      action: 'read',
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
      icon: ShoppingCart,
      module: 'orders',
      action: 'read',
      children: [
        {
          name: "Purchase Orders",
          href: "/purchase-orders",
          icon: ClipboardList,
          module: 'orders',
          action: 'read'
        },
        {
          name: "Sales Orders",
          href: "/sales-orders",
          icon: ShoppingBag,
          module: 'orders',
          action: 'read'
        },
        {
          name: "Delivery Notes",
          href: "/delivery-notes",
          icon: ClipboardCheck,
          module: 'orders',
          action: 'read'
        }
      ]
    },
    {
      name: "Inventory",
      icon: PackageSearch,
      module: 'inventory',
      action: 'read',
      children: [
        {
          name: "Inventory List",
          href: "/inventory",
          icon: PackageSearch,
          module: 'inventory',
          action: 'read'
        },
        {
          name: "Transfers",
          href: "/transfers",
          icon: ArrowRight,
          module: 'inventory',
          action: 'read'
        },
        {
          name: "Stock Take",
          href: "/stock-take",
          icon: ClipboardCheck,
          module: 'inventory',
          action: 'read'
        }
      ]
    },
    {
      name: "Point of Sale",
      href: "/pos",
      icon: StoreIcon,
      module: 'pos', // POS now has its own permission
      action: 'read'
    },
    {
      name: "Receipts",
      href: "/receipts",
      icon: ListIcon,
      module: 'receipts', // Receipts now has its own permission
      action: 'read'
    },
    {
      name: "Stores",
      icon: Store,
      module: 'stores',
      action: 'read',
      children: [
        {
          name: "Store List",
          href: "/stores",
          icon: ListIcon,
          module: 'stores',
          action: 'read'
        },
        {
          name: "Store Analytics",
          href: "/store-performance",
          icon: BarChart,
          module: 'stores',
          action: 'read'
        }
      ]
    },
    {
      name: "Customer Profiles",
      href: "/customers",
      icon: UserCircle,
      module: 'customerProfiles',
      action: 'read'
    },
    {
      name: "User Management",
      icon: UserCog,
      module: 'users',
      action: 'read',
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
          name: "Regions",
          href: "/regions",
          icon: Network,
          module: 'stores',
          action: 'read'
        },
      ],
    },
  ];

  const hasAccess = (item: NavItem): boolean => {
    if (isSystemAdmin) {
      return true;
    }

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
    if (!hasAccess(item)) {
      return null;
    }

    if (item.children) {
      const accessibleChildren = item.children.filter(child => hasAccess(child));
      if (accessibleChildren.length === 0) return null;

      const isExpanded = expandedItems.includes(item.name);

      return (
        <div key={item.name} className="space-y-1">
          <button
            onClick={() => toggleExpanded(item.name)}
            className={cn(
              "erp-nav-item justify-between",
              isExpanded && "bg-sidebar-accent text-sidebar-accent-foreground"
            )}
            aria-expanded={isExpanded}
          >
            <div className="flex items-center">
              <item.icon className="mr-3 h-5 w-5" />
              <span className="font-medium">{item.name}</span>
            </div>
            <ChevronRight className={cn(
              "h-4 w-4 opacity-50 transition-transform duration-200",
              isExpanded && "transform rotate-90"
            )} />
          </button>
          {isExpanded && (
            <div className="ml-4 pl-3 space-y-1 border-l border-border">
              {accessibleChildren.map(child => renderNavItem(child))}
            </div>
          )}
        </div>
      );
    }

    if (!item.href) return null;

    const isActive = location === item.href;

    return (
      <Link key={item.name} href={item.href}>
        <a
          className={cn(
            "erp-nav-subitem",
            isActive && "erp-nav-item-active"
          )}
          aria-current={isActive ? "page" : undefined}
        >
          <item.icon className="mr-3 h-5 w-5" />
          {item.name}
        </a>
      </Link>
    );
  };

  return (
    <div className="flex flex-col w-64 bg-sidebar border-r border-sidebar-border">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-sidebar-border">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold shadow-xs"
          aria-hidden="true"
        >
          SE
        </span>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-sidebar-foreground">Smart ERP</h1>
          <p className="text-caption text-muted-foreground">Enterprise Suite</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navigationItems.map(item => renderNavItem(item))}
      </nav>

      <div className="p-3 border-t border-sidebar-border space-y-3">
        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{user?.username}</p>
            <p className="truncate text-caption capitalize text-muted-foreground">{user?.role?.name}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={toggleTheme}
            aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
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
