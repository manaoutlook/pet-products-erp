import { lazy, Suspense } from "react";
import { Switch, Route, useLocation } from "wouter";
import { useUser } from "./hooks/use-user";
import { Loader2 } from "lucide-react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RequirePermission } from "./components/auth/RequirePermission";
import MainLayout from "./components/Layout/MainLayout";
import AuthPage from "./pages/AuthPage";
// POS stays eager: it is the screen a cashier opens first and every second spent
// waiting for a chunk is a second the till is not ringing up a sale.
import POSPage from "./pages/POSPage";

// Everything else is split per route, so the login screen and the POS no longer ship
// the whole application - Recharts, jsPDF, xlsx and the master-data grids only load
// when their page is opened.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const InventoryPage = lazy(() => import("./pages/InventoryPage"));
const StockTakePage = lazy(() => import("./pages/StockTakePage"));
const StockAdjustmentsPage = lazy(() => import("./pages/StockAdjustmentsPage"));
const TransferPage = lazy(() => import("./pages/TransferPage"));
const ProductsPage = lazy(() => import("./pages/ProductsPage"));
const CategoryPage = lazy(() => import("./pages/CategoryPage"));
const BrandsPage = lazy(() => import("./pages/BrandsPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const RolesPage = lazy(() => import("./pages/RolesPage"));
const RolePermissionsPage = lazy(() => import("./pages/RolePermissionsPage"));
const StorePage = lazy(() => import("./pages/StorePage"));
const StoreAssignmentPage = lazy(() => import("./pages/StoreAssignmentPage"));
const StorePerformancePage = lazy(() => import("./pages/StorePerformancePage"));
const SuppliersPage = lazy(() => import("./pages/SuppliersPage"));
const PurchaseOrdersPage = lazy(() => import("./pages/PurchaseOrdersPage"));
const SalesOrdersPage = lazy(() => import("./pages/SalesOrdersPage"));
const DeliveryNotesPage = lazy(() => import("./pages/DeliveryNotesPage"));
const CustomerProfilesPage = lazy(() => import("./pages/CustomerProfilesPage"));
const ReceiptsPage = lazy(() => import("./pages/ReceiptsPage"));
const RegionPage = lazy(() => import("./pages/RegionPage"));
const CompanyProfilePage = lazy(() => import("./pages/CompanyProfilePage"));
const VatCompaniesPage = lazy(() => import("./pages/VatCompaniesPage"));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center h-full p-6">
      <Loader2 className="h-8 w-8 animate-spin text-border" />
    </div>
  );
}

function App() {
  const { user, isLoading } = useUser();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-border" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <MainLayout>
      {/* Keyed by location: a crash on one screen is cleared by navigating to another. */}
      <ErrorBoundary key={location} section="This screen">
        <Suspense fallback={<RouteFallback />}>
          <Switch>
            <Route path="/" component={DashboardPage} />
            <Route path="/inventory">
              <RequirePermission module="inventory" action="read"><InventoryPage /></RequirePermission>
            </Route>
            <Route path="/stock-take">
              <RequirePermission module="inventory" action="read"><StockTakePage /></RequirePermission>
            </Route>
            <Route path="/stock-adjustments">
              <RequirePermission module="inventory" action="read"><StockAdjustmentsPage /></RequirePermission>
            </Route>
            <Route path="/transfers">
              <RequirePermission module="inventory" action="read"><TransferPage /></RequirePermission>
            </Route>
            <Route path="/pos">
              <RequirePermission module="pos" action="read"><POSPage /></RequirePermission>
            </Route>
            <Route path="/receipts">
              <RequirePermission module="receipts" action="read"><ReceiptsPage /></RequirePermission>
            </Route>
            <Route path="/purchase-orders">
              <RequirePermission module="orders" action="read"><PurchaseOrdersPage /></RequirePermission>
            </Route>
            <Route path="/sales-orders">
              <RequirePermission module="orders" action="read"><SalesOrdersPage /></RequirePermission>
            </Route>
            <Route path="/delivery-notes">
              <RequirePermission module="orders" action="read"><DeliveryNotesPage /></RequirePermission>
            </Route>
            <Route path="/products">
              <RequirePermission module="products" action="read"><ProductsPage /></RequirePermission>
            </Route>
            <Route path="/categories">
              <RequirePermission module="masterData" action="read"><CategoryPage /></RequirePermission>
            </Route>
            <Route path="/brands">
              <RequirePermission module="masterData" action="read"><BrandsPage /></RequirePermission>
            </Route>
            <Route path="/suppliers">
              <RequirePermission module="masterData" action="read"><SuppliersPage /></RequirePermission>
            </Route>
            <Route path="/company-profile">
              <RequirePermission module="masterData" action="read"><CompanyProfilePage /></RequirePermission>
            </Route>
            {/*
              VAT Companies: the two legal entities that may issue a VAT invoice. The household
              business on the Company Profile cannot, so this screen is the one that holds the
              seller details printed on a VAT invoice (and their own invoice number sequences).
            */}
            <Route path="/vat-companies">
              <RequirePermission module="masterData" action="read"><VatCompaniesPage /></RequirePermission>
            </Route>
            <Route path="/customers">
              <RequirePermission module="customerProfiles" action="read"><CustomerProfilesPage /></RequirePermission>
            </Route>
            <Route path="/users">
              <RequirePermission module="users" action="read"><UsersPage /></RequirePermission>
            </Route>
            {/* Roles, permissions and store assignments have no module of their own. */}
            <Route path="/roles">
              <RequirePermission module="users" action="read" adminOnly><RolesPage /></RequirePermission>
            </Route>
            <Route path="/role-permissions">
              <RequirePermission module="users" action="read" adminOnly><RolePermissionsPage /></RequirePermission>
            </Route>
            <Route path="/store-assignments">
              <RequirePermission module="stores" action="read" adminOnly><StoreAssignmentPage /></RequirePermission>
            </Route>
            <Route path="/stores">
              <RequirePermission module="stores" action="read"><StorePage /></RequirePermission>
            </Route>
            <Route path="/store-performance">
              <RequirePermission module="stores" action="read"><StorePerformancePage /></RequirePermission>
            </Route>
            <Route path="/regions">
              <RequirePermission module="stores" action="read"><RegionPage /></RequirePermission>
            </Route>
            <Route>
              <div className="flex items-center justify-center h-full">
                <h1 className="text-2xl font-bold">404 - Page Not Found</h1>
              </div>
            </Route>
          </Switch>
        </Suspense>
      </ErrorBoundary>
    </MainLayout>
  );
}

export default App;
