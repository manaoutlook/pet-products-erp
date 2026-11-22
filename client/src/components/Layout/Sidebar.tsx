import { Link, useLocation } from "wouter";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/use-user";
import { usePermissions } from "@/hooks/use-permissions";
import { useTheme } from "@/components/theme-provider";
import {
  LayoutDashboard,
  Package,
  PackageSearch,
  Users,
  Store,
  LogOut,
  Sun,
  Moon,
  BarChart,
  Folders,
  Tags,
  Building2,
  Landmark,
  ChevronDown,
  ClipboardList,
  ClipboardCheck,
  Calculator,
  UserCircle,
  ScanBarcode,
  ShoppingBag,
  Truck,
  ArrowLeftRight,
  SlidersHorizontal,
  Wallet,
  Banknote,
  Receipt,
  ReceiptText,
  ShieldCheck,
  MapPin,
  Lock,
  UserCheck,
} from "lucide-react";

/**
 * The left navigation.
 *
 * Sections read top-to-bottom in the order the shop works: open the till, sell, deliver,
 * restock, count the shelf, take the money - then the screens that are set up once and
 * revisited rarely (master data, administration).
 *
 * Two rules keep it readable, and both were learned the hard way:
 *
 * 1. One row shape per level. Daily screens and setup screens are the same kind of row;
 *    only the rarely used sections fold. A section that holds a single link never folds -
 *    that was a click spent revealing one row (`Products > Product List`).
 * 2. The section that contains the current page is always open and marked. A collapsed
 *    sidebar used to hide the active page on `/stock-take`, so the highlight pointed at
 *    nothing.
 *
 * Permissions are unchanged: each row still declares the module + action (or `adminOnly`)
 * the API enforces, so what a role can see is decided below by `hasAccess` alone.
 */
type NavModule =
  | 'products'
  | 'orders'
  | 'vatMargin'
  | 'inventory'
  | 'users'
  | 'stores'
  | 'masterData'
  | 'vatCompanies'
  | 'companyProfile'
  | 'pos'
  | 'receipts'
  | 'finance'
  | 'customerProfiles';

interface NavItem {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  module?: NavModule;
  action?: 'create' | 'read' | 'update' | 'delete';
  adminOnly?: boolean;
}

interface NavSection {
  /** Group heading. The daily block has none - it starts the list. */
  label?: string;
  /** Only the setup sections fold; the daily ones are always visible. */
  collapsible?: boolean;
  defaultExpanded?: boolean;
  items: NavItem[];
}

/** Remembers which setup sections the operator opened, so the sidebar stops shuffling. */
const EXPANDED_SECTIONS_KEY = 'erp-sidebar-expanded-sections';

function readExpandedSections(): string[] | null {
  try {
    const raw = window.localStorage.getItem(EXPANDED_SECTIONS_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((label): label is string => typeof label === 'string');
  } catch {
    // Private mode / storage disabled: the defaults still work, nothing to report.
    return null;
  }
}

function writeExpandedSections(labels: string[]): void {
  try {
    window.localStorage.setItem(EXPANDED_SECTIONS_KEY, JSON.stringify(labels));
  } catch {
    /* Storage is a convenience here, not a requirement. */
  }
}

function sectionId(label: string): string {
  return `erp-nav-section-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

const navigationSections: NavSection[] = [
  {
    // Frequency of use: the till is opened every hour, purchase orders once a supplier.
    // A sale is closed by its delivery note, so the note follows the order it fulfils.
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "Point of Sale", href: "/pos", icon: ScanBarcode, module: 'pos', action: 'read' },
      { name: "Sales Orders", href: "/sales-orders", icon: ShoppingBag, module: 'orders', action: 'read' },
      { name: "Delivery Notes", href: "/delivery-notes", icon: Truck, module: 'orders', action: 'read' },
      { name: "Purchase Orders", href: "/purchase-orders", icon: ClipboardList, module: 'orders', action: 'read' },
    ],
  },
  {
    label: "Inventory",
    items: [
      { name: "Inventory List", href: "/inventory", icon: PackageSearch, module: 'inventory', action: 'read' },
      { name: "Transfers", href: "/transfers", icon: ArrowLeftRight, module: 'inventory', action: 'read' },
      { name: "Stock Take", href: "/stock-take", icon: ClipboardCheck, module: 'inventory', action: 'read' },
      { name: "Stock Adjustments", href: "/stock-adjustments", icon: SlidersHorizontal, module: 'inventory', action: 'read' },
    ],
  },
  {
    // Money in one place, in the order it moves: cash received, what is still owed, then
    // the expenses and partner capital that never touch a customer.
    label: "Money",
    items: [
      { name: "Receipts", href: "/receipts", icon: Receipt, module: 'receipts', action: 'read' },
      { name: "Receivables", href: "/receivables", icon: Wallet, module: 'receipts', action: 'read' },
      { name: "Finance", href: "/finance", icon: Banknote, module: 'finance', action: 'read' },
    ],
  },
  {
    // Entered once, edited occasionally: the catalogue, then the partners, then the places.
    label: "Master Data",
    collapsible: true,
    defaultExpanded: true,
    items: [
      { name: "Products", href: "/products", icon: Package, module: 'products', action: 'read' },
      { name: "Categories", href: "/categories", icon: Folders, module: 'masterData', action: 'read' },
      { name: "Brands", href: "/brands", icon: Tags, module: 'masterData', action: 'read' },
      { name: "Suppliers", href: "/suppliers", icon: Building2, module: 'masterData', action: 'read' },
      // "Customer Profiles" everywhere else in the app; the menu says what it is.
      { name: "Customers", href: "/customers", icon: UserCircle, module: 'customerProfiles', action: 'read' },
      { name: "Stores", href: "/stores", icon: Store, module: 'stores', action: 'read' },
      { name: "Store Analytics", href: "/store-performance", icon: BarChart, module: 'stores', action: 'read' },
      // Regions group stores, so they belong with stores - not with the user screens.
      { name: "Regions", href: "/regions", icon: MapPin, module: 'stores', action: 'read' },
    ],
  },
  {
    // Pinned last: identity, tax, people and their access. Folded by default because a
    // cashier never opens any of it.
    label: "Administration",
    collapsible: true,
    defaultExpanded: false,
    items: [
      // The letterhead every screen shows and every document prints. Readable by all, but
      // editing it has its own grant - master data access no longer implies it.
      { name: "Company Profile", href: "/company-profile", icon: Landmark, module: 'companyProfile', action: 'read' },
      // The legal entities that print on a VAT invoice. Master data, but with its own grant:
      // Suppliers and Brands can be handed out without the invoice issuers.
      { name: "VAT Companies", href: "/vat-companies", icon: ReceiptText, module: 'vatCompanies', action: 'read' },
      // The profit split agreed with the VAT company that issued an invoice. It reads the order's
      // lines, but the split is partner-only information - hence its own `vatMargin` module.
      { name: "VAT Margin Calculator", href: "/vat-margin", icon: Calculator, module: 'vatMargin', action: 'read' },
      { name: "Users", href: "/users", icon: Users, module: 'users', action: 'read' },
      { name: "Roles", href: "/roles", icon: ShieldCheck, adminOnly: true },
      { name: "Permissions", href: "/role-permissions", icon: Lock, adminOnly: true },
      { name: "Store Assignments", href: "/store-assignments", icon: UserCheck, adminOnly: true },
    ],
  },
];

function Sidebar() {
  const [location] = useLocation();
  const { logout, user } = useUser();
  const { hasPermission, isAdmin } = usePermissions();
  const { resolvedTheme, toggleTheme } = useTheme();
  const isSystemAdmin = user?.role?.isSystemAdmin === true;

  const collapsibleLabels = useMemo(
    () => navigationSections.filter(section => section.collapsible && section.label).map(section => section.label!),
    []
  );

  const [expandedSections, setExpandedSections] = useState<string[]>(() => {
    const defaults = navigationSections
      .filter(section => section.collapsible && section.defaultExpanded && section.label)
      .map(section => section.label!);

    const stored = readExpandedSections();
    if (stored === null) return defaults;

    const known = stored.filter(label => collapsibleLabels.includes(label));
    if (known.length === 0 && stored.length > 0) {
      // Every remembered label belongs to a section that no longer folds (a rename, say).
      // Falling back to the defaults avoids a sidebar with nothing open at all.
      return defaults;
    }
    return known;
  });

  /**
   * `/finance` also highlights for `/finance/ledger`, and `/` only for the dashboard -
   * a plain equality check left the active page unmarked on every nested route.
   */
  const isActive = (href: string): boolean => {
    if (href === '/') return location === '/';
    return location === href || location.startsWith(`${href}/`);
  };

  const activeSectionLabel = navigationSections
    .filter(section => section.collapsible)
    .find(section => section.items.some(item => isActive(item.href)))?.label;

  // Landing on a page inside a folded section must reveal it - otherwise the highlight
  // (and the page) is hidden behind a chevron. This opens it for the visit only; the
  // stored preference is left alone, so the section folds again on the next visit.
  useEffect(() => {
    if (!activeSectionLabel) return;
    setExpandedSections(prev =>
      prev.includes(activeSectionLabel) ? prev : [...prev, activeSectionLabel]
    );
  }, [activeSectionLabel]);

  const toggleSection = (label: string) => {
    const next = expandedSections.includes(label)
      ? expandedSections.filter(entry => entry !== label)
      : [...expandedSections, label];
    setExpandedSections(next);
    writeExpandedSections(next);
  };

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

    return true;
  };

  const renderNavItem = (item: NavItem) => {
    if (!hasAccess(item)) {
      return null;
    }

    const active = isActive(item.href);

    return (
      <Link
        key={item.name}
        href={item.href}
        className={cn("erp-nav-item", active && "erp-nav-item-active")}
        aria-current={active ? "page" : undefined}
      >
        <item.icon className="mr-3 h-5 w-5" />
        {item.name}
      </Link>
    );
  };

  const renderSection = (section: NavSection, index: number) => {
    const visibleItems = section.items.filter(hasAccess);
    if (visibleItems.length === 0) {
      // Nothing this role may open: drop the heading too, instead of an empty group.
      return null;
    }

    const label = section.label;
    // A missing label is the unlabelled daily block: it is always open.
    const expanded =
      label === undefined || section.collapsible !== true || expandedSections.includes(label);
    const sectionActive = visibleItems.some(item => isActive(item.href));

    return (
      <div key={label ?? `section-${index}`} className="space-y-1">
        {label !== undefined &&
          (section.collapsible === true ? (
            <button
              type="button"
              onClick={() => toggleSection(label)}
              aria-expanded={expanded}
              aria-controls={sectionId(label)}
              className={cn(
                "erp-nav-group-label flex w-full items-center justify-between hover:text-foreground",
                sectionActive && "text-foreground"
              )}
            >
              <span>{label}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200",
                  !expanded && "-rotate-90"
                )}
              />
            </button>
          ) : (
            <p className="erp-nav-group-label">{label}</p>
          ))}
        {expanded && (
          <div id={label !== undefined ? sectionId(label) : undefined} className="space-y-1">
            {visibleItems.map(renderNavItem)}
          </div>
        )}
      </div>
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

      <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto">
        {navigationSections.map(renderSection)}
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

