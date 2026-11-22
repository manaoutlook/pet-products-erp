import { ReactNode, useLayoutEffect, useRef } from "react";
import { useLocation } from "wouter";
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
  const [location] = useLocation();
  // Query-string changes are filters on the same screen, not navigation, so only
  // the pathname should move the viewport back to the top.
  const pathname = location.split(/[?#]/, 1)[0];
  const mainRef = useRef<HTMLElement>(null);

  // Every route is a new screen, so it must start at its top. The document is the
  // scroller for long pages and `main` can scroll on its own in some layouts, so
  // reset both - otherwise navigating from a scrolled screen leaves the next one
  // looking blank until you manually scroll back up.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (main) {
      main.scrollTop = 0;
      main.scrollLeft = 0;
    }
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <Sidebar />
      <main ref={mainRef} className="flex-1 overflow-y-auto bg-background">
        <CompanyHeader company={company} isLoading={isLoading} loadError={isError ? error : null} />
        {children}
      </main>
    </div>
  );
}

export default MainLayout;
