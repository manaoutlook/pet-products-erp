import { Switch, Route } from "wouter";
import { useUser } from "./hooks/use-user";
import { Loader2 } from "lucide-react";
import AuthPage from "./pages/AuthPage";
import DashboardPage from "./pages/DashboardPage";
import InventoryPage from "./pages/InventoryPage";
import OrdersPage from "./pages/OrdersPage";
import ProductsPage from "./pages/ProductsPage";
import CategoryPage from "./pages/CategoryPage";
import BrandsPage from "./pages/BrandsPage";
import UsersPage from "./pages/UsersPage";
import RolesPage from "./pages/RolesPage";
import RolePermissionsPage from "./pages/RolePermissionsPage";
import RoleMappingPage from "./pages/RoleMappingPage";
import StorePage from "./pages/StorePage";
import StoreAssignmentPage from "./pages/StoreAssignmentPage";
import StorePerformancePage from "./pages/StorePerformancePage";
import SuppliersPage from "./pages/SuppliersPage";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage";
import CustomerProfilesPage from "./pages/CustomerProfilesPage";
import MainLayout from "./components/Layout/MainLayout";

function App() {
  const { user, isLoading } = useUser();

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
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/inventory" component={InventoryPage} />
        <Route path="/purchase-orders" component={PurchaseOrdersPage} />
        <Route path="/products" component={ProductsPage} />
        <Route path="/categories" component={CategoryPage} />
        <Route path="/brands" component={BrandsPage} />
        <Route path="/customers" component={CustomerProfilesPage} />
        <Route path="/users" component={UsersPage} />
        <Route path="/roles" component={RolesPage} />
        <Route path="/role-permissions" component={RolePermissionsPage} />
        <Route path="/role-mapping" component={RoleMappingPage} />
        <Route path="/stores" component={StorePage} />
        <Route path="/store-assignments" component={StoreAssignmentPage} />
        <Route path="/store-performance" component={StorePerformancePage} />
        <Route path="/suppliers" component={SuppliersPage} />
        <Route>
          <div className="flex items-center justify-center h-full">
            <h1 className="text-2xl font-bold">404 - Page Not Found</h1>
          </div>
        </Route>
      </Switch>
    </MainLayout>
  );
}

import { BrowserRouter as Router } from "react-router-dom";

// Wrap your App component with Router if it's not already done
function App() {
  return (
    <Router>
      {/* Your application content */}
    </Router>
  );
}

export default App;