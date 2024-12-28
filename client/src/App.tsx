import { Switch, Route } from "wouter";
import { useUser } from "./hooks/use-user";
import { Loader2 } from "lucide-react";
import AuthPage from "./pages/AuthPage";
import DashboardPage from "./pages/DashboardPage";
import InventoryPage from "./pages/InventoryPage";
import OrdersPage from "./pages/OrdersPage";
import ProductsPage from "./pages/ProductsPage";
import UsersPage from "./pages/UsersPage";
import RolesPage from "./pages/RolesPage";
import StorePage from "./pages/StorePage";
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
        <Route path="/orders" component={OrdersPage} />
        <Route path="/products" component={ProductsPage} />
        <Route path="/users" component={UsersPage} />
        <Route path="/roles" component={RolesPage} />
        <Route path="/stores" component={StorePage} />
        <Route>
          <div className="flex items-center justify-center h-full">
            <h1 className="text-2xl font-bold">404 - Page Not Found</h1>
          </div>
        </Route>
      </Switch>
    </MainLayout>
  );
}

export default App;