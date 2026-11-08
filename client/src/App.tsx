import { Switch, Route, useLocation } from "wouter";
import { useUser } from "./hooks/use-user";
import { Loader2 } from "lucide-react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RequirePermission } from "./components/auth/RequirePermission";
import AuthPage from "./pages/AuthPage";
import DashboardPage from "./pages/DashboardPage";
import InventoryPage from "./pages/InventoryPage";
import StockTakePage from "./pages/StockTakePage";
import TransferPage from "./pages/TransferPage";
import OrdersPage from "./pages/OrdersPage";
import ProductsPage from "./pages/ProductsPage";
import CategoryPage from "./pages/CategoryPage";
import BrandsPage from "./pages/BrandsPage";
import UsersPage from "./pages/UsersPage";
import RolesPage from "./pages/RolesPage";
import RolePermissionsPage from "./pages/RolePermissionsPage";
import StorePage from "./pages/StorePage";
import StoreAssignmentPage from "./pages/StoreAssignmentPage";
import StorePerformancePage from "./pages/StorePerformancePage";
import SuppliersPage from "./pages/SuppliersPage";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage";
import CustomerProfilesPage from "./pages/CustomerProfilesPage";
import POSPage from "./pages/POSPage";
import ReceiptsPage from "./pages/ReceiptsPage";
import RegionPage from "./pages/RegionPage";
import MainLayout from "./components/Layout/MainLayout";

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
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/inventory">
            <RequirePermission module="inventory" action="read"><InventoryPage /></RequirePermission>
          </Route>
          <Route path="/stock-take">
            <RequirePermission module="inventory" action="read"><StockTakePage /></RequirePermission>
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
      </ErrorBoundary>
    </MainLayout>
  );
}

export default App;
