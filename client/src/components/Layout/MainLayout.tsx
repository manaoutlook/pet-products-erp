import { ReactNode } from "react";
import Sidebar from "./Sidebar";
import { CompanyHeader } from "@/components/company/CompanyHeader";
import { useCompanyInfo } from "@/hooks/use-company";

interface MainLayoutProps {
  children: ReactNode;
}

/**
 * The application shell.
 *
 * The company letterhead band lives here - once - so every screen shows the same header
 * from the same query as the documents those screens print. Putting it in each page would
 * be eight copies of one letterhead, which is the drift this layout exists to prevent.
 */
function MainLayout({ children }: MainLayoutProps) {
  const { company, isLoading, isError, error } = useCompanyInfo();

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        <CompanyHeader company={company} isLoading={isLoading} loadError={isError ? error : null} />
        {children}
      </main>
    </div>
  );
}

export default MainLayout;
