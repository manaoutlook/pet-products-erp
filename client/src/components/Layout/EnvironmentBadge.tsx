import { useEffect } from "react";
import { AlertTriangle, Code2, FlaskConical, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEnvironment } from "@/hooks/use-environment";
import { cn } from "@/lib/utils";
import type { EnvironmentInfo } from "@shared/environment";

/**
 * "Which system am I on?" - the corner badge and the login banner.
 *
 * Two layers, because one is easy to stop seeing:
 *  1. `EnvironmentBadge` - a pill in the top-right corner of the header band, on every
 *     screen (`MainLayout` passes it to `CompanyHeader`), plus the `html[data-env]`
 *     attribute that gives non-production windows a coloured strip along the very top
 *     (see `client/src/index.css`).
 *  2. `EnvironmentNotice` - the banner above the login card, where the wrong answer
 *     costs the most: typing a real stock adjustment into a staging copy, or testing a
 *     deletion on production.
 *
 * Both read the same server answer through `useEnvironment()`, so they cannot disagree.
 * Nothing is rendered while that answer is in flight - a badge that says STAGE and then
 * flips to PROD half a second later is worse than half a second of nothing.
 */

const ICONS = {
  shield: ShieldCheck,
  flask: FlaskConical,
  code: Code2,
  alert: AlertTriangle,
} as const;

/**
 * Tab title and top-edge colour for the current environment.
 *
 * The title prefix is what survives a screenshot of the browser chrome, so it is worth
 * the one global mutation. `document.title` is read by the ledger printer
 * (`lib/ledger-print.ts`) as the statement heading, so on staging a printed statement
 * also says STAGING - intended: a staging printout should never look like a real one.
 *
 * The base title is captured once, so a re-render (or a theme change) cannot end up with
 * `STAGING · STAGING · Smart ERP`.
 */
/**
 * The tab title as it was before any environment prefix was applied.
 *
 * Module-level, not a per-component ref: the badge unmounts on logout and the login
 * banner mounts in its place, so a per-instance capture would prefix the already
 * prefixed title (`STAGING · STAGING · Smart ERP`).
 */
let baseDocumentTitle: string | null = null;

function useEnvironmentChrome(info: EnvironmentInfo, ready: boolean) {
  useEffect(() => {
    // Nothing until the server has answered: a red `ENV?` strip that flashes for 100 ms
    // on every production page load would train everyone to ignore the strip.
    if (!ready) return;

    document.documentElement.dataset.env = info.name;

    if (baseDocumentTitle === null) {
      baseDocumentTitle = document.title;
    }
    document.title = info.titlePrefix
      ? `${info.titlePrefix} ${baseDocumentTitle}`.trim()
      : baseDocumentTitle;
  }, [ready, info.name, info.titlePrefix]);
}

interface EnvironmentBadgeProps {
  className?: string;
  /** Also print the address (`localhost:5002`); useful on a crowded team machine. */
  showHost?: boolean;
}

/** The corner pill. Renders nothing until the server has answered. */
export function EnvironmentBadge({ className, showHost = false }: EnvironmentBadgeProps) {
  const { info, host, isLoading } = useEnvironment();
  useEnvironmentChrome(info, !isLoading);

  if (isLoading) return null;

  const Icon = ICONS[info.icon];

  return (
    <span
      data-testid="environment-badge"
      data-environment={info.name}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
        "text-caption font-semibold uppercase tracking-wide",
        info.badgeClassName,
        className
      )}
      title={host ? `${info.description} (${host})` : info.description}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {info.shortLabel}
      {showHost && host ? (
        <span className="font-normal normal-case tracking-normal opacity-80">{host}</span>
      ) : null}
    </span>
  );
}

interface EnvironmentNoticeProps {
  className?: string;
}

/**
 * The banner above the login card: production gets one quiet line, everything else gets
 * a tinted panel that says plainly what this system is not.
 */
export function EnvironmentNotice({ className }: EnvironmentNoticeProps) {
  const { info, host, isLoading } = useEnvironment();
  useEnvironmentChrome(info, !isLoading);

  if (isLoading) return null;

  const where = host ? ` (${host})` : "";

  if (info.isProduction) {
    return (
      <p
        data-testid="environment-notice"
        data-environment={info.name}
        className={cn(
          "flex items-center justify-center gap-1.5 text-center text-caption text-muted-foreground",
          className
        )}
      >
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Signing in to <span className="font-semibold uppercase tracking-wide">Production</span>
        {host ? <span className="opacity-80">{where}</span> : null}
      </p>
    );
  }

  const Icon = ICONS[info.icon];

  return (
    <Alert
      variant={info.alertVariant}
      data-testid="environment-notice"
      data-environment={info.name}
      className={className}
    >
      <Icon className="h-4 w-4" />
      <AlertTitle>{info.noticeTitle}</AlertTitle>
      <AlertDescription>
        <p>
          {info.noticeBody}
          {host ? (
            <>
              {" "}
              You are on <span className="font-semibold">{host}</span>.
            </>
          ) : null}
        </p>
      </AlertDescription>
    </Alert>
  );
}
