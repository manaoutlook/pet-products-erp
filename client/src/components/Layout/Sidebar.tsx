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
  Building2,
  ChevronRight,
  ClipboardList,
  UserCircle,
  FileText
} from "lucide-react";
import { useState } from "react";

interface NavItem {
  name: string;
  href?: string;
  icon: any;
  module?: 'products' | 'orders' | 'inventory' | 'users' | 'stores' | 'customerProfiles' | 'bills';
  action?: 'create' | 'read' | 'update' | 'delete';
  adminOnly?: boolean;
  children?: NavItem[];
}

function Sidebar() {
  const [location] = useLocation();
  const { logout, user } = useUser();
  const { hasPermission, isAdmin } = usePermissions();
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
      module: 'products',
      action: 'read',
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
        }
      ]
    },
    { 
      name: "Inventory", 
      href: "/inventory", 
      icon: PackageSearch,
      module: 'inventory',
      action: 'read'
    },
    { 
      name: "Customer Profiles", 
      href: "/customers", 
      icon: UserCircle,
      module: 'customerProfiles',
      action: 'read'
    },
    {
      name: "Billing",
      href: "/billing",
      icon: FileText,
      module: 'bills',
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
          name: "Role Locations", 
          href: "/role-locations", 
          icon: Building2,
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
    // System Administrator has access to everything
    if (user?.role?.name === 'admin') {
      return true;
    }

    // Check adminOnly flag
    if (item.adminOnly) {
      return isAdmin;
    }

    // Check module permissions
    if (item.module && item.action) {
      return hasPermission(item.module, item.action);
    }

    // If item has children, show if at least one child is accessible
    if (item.children) {
      return item.children.some(child => hasAccess(child));
    }

    // If no restrictions are specified, allow access
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
              "w-full flex items-center justify-between px-3 py-2 text-sm rounded-md",
              "text-sidebar-foreground/70 hover:text-sidebar-foreground",
              "bg-transparent hover:bg-sidebar-accent/10 transition-colors",
              "cursor-pointer focus:outline-none focus:ring-2 focus:ring-sidebar-accent/20",
              isExpanded && "bg-sidebar-accent/5"
            )}
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
            <div className="ml-4 pl-3 space-y-1 border-l-2 border-sidebar-accent/20">
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
            "flex items-center px-3 py-2 text-sm rounded-md transition-colors",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground hover:bg-sidebar-accent/20 hover:text-sidebar-foreground",
            "focus:outline-none focus:ring-2 focus:ring-sidebar-accent/20"
          )}
        >
          <item.icon className="mr-3 h-5 w-5" />
          {item.name}
        </a>
      </Link>
    );
  };

  return (
    <div className="flex flex-col w-64 bg-sidebar border-r border-sidebar-border">
      <div className="p-4 border-b border-sidebar-border">
        <h1 className="text-xl font-bold text-sidebar-foreground">Pet Products ERP</h1>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navigationItems.map(item => renderNavItem(item))}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center mb-4">
          <div>
            <p className="text-sm font-medium text-sidebar-foreground">{user?.username}</p>
            <p className="text-xs text-sidebar-foreground/70 capitalize">{user?.role?.name}</p>
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