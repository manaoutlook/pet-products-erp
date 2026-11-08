import { type ReactNode } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import type { PermissionAction } from "@shared/permissions";
import { usePermissions } from "@/hooks/use-permissions";

interface RequirePermissionProps {
  module: string;
  action: PermissionAction;
  /**
   * Screens the sidebar marks admin-only (roles, permissions, store assignments).
   * They have no module of their own, so the gate is "system admin" instead of a
   * permission entry.
   */
  adminOnly?: boolean;
  children: ReactNode;
}

/**
 * AI Agent Note: the sidebar only *hides* links; typing the URL still mounted the
 * page, which then fired requests that 403 and rendered empty tables. This gate runs
 * the same check the API runs before the page mounts, so a user who is not allowed
 * sees an explanation instead of a broken screen.
 *
 * It renders nothing-but-a-spinner while the role is loading: deciding "denied"
 * before `/api/user` answers would flash a 403 screen on every refresh.
 */
export function RequirePermission({
  module,
  action,
  adminOnly = false,
  children,
}: RequirePermissionProps) {
  const { can, isAdmin, isLoading } = usePermissions();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-border" />
      </div>
    );
  }

  const allowed = adminOnly ? isAdmin : can(module, action);

  if (!allowed) {
    return (
      <div className="flex items-center justify-center h-full p-6" role="alert">
        <div className="max-w-md space-y-2 rounded-lg border border-dashed border-border bg-card p-6 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-foreground">Access denied</h1>
          <p className="text-sm text-muted-foreground">
            Your role does not include the {module} {action} permission. Ask an
            administrator to grant it if you need this screen.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default RequirePermission;
