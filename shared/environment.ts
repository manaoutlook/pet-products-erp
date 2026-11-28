/**
 * Which deployment am I looking at - one definition for server and browser.
 *
 * AI Agent Note: this value can only come from the server at RUNTIME. The same
 * `npm run build` output is deployed to staging and to production, so anything baked
 * in at build time (`import.meta.env`, a `VITE_*` constant, a define in vite.config)
 * would print "production" on the staging box - exactly the lie the badge exists to
 * prevent. `server/index.ts` therefore answers `GET /api/environment` from its own
 * `.env`, and both sides read the labels/colours from this file so the badge and the
 * login banner cannot disagree.
 *
 * Why the unset case is `unknown` and not `production`:
 *  - a staging box that says "Production" is annoying;
 *  - a production box that says "Staging" invites someone to "just test" a deletion,
 *    a stock take or a WooCommerce sync against real books.
 * So an unset `APP_ENV` renders a red `ENV?` badge rather than guessing.
 *
 * Framework-free on purpose: imported by `server/` (tsx) and `client/` (Vite).
 */

/** The one variable that answers the question. Set it in the server's `.env`. */
export const APP_ENV_VAR = "APP_ENV";

export type EnvironmentName = "production" | "staging" | "development" | "unknown";

export interface EnvironmentInfo {
  name: EnvironmentName;
  /** Full word: `Staging`. Used in sentences. */
  label: string;
  /** Caps word for the corner badge: `STAGE`. */
  shortLabel: string;
  /** One line for the badge tooltip. */
  description: string;
  /** Heading of the login banner. */
  noticeTitle: string;
  /** Body of the login banner: what the user should know before typing a password. */
  noticeBody: string;
  isProduction: boolean;
  /**
   * Badge colours. Full class strings, never built with string concatenation -
   * Tailwind only keeps classes it can literally find in the source.
   */
  badgeClassName: string;
  /**
   * Login banner surface - a variant of `components/ui/alert.tsx`, so the banner shares
   * the palette the rest of the app already uses for info/warning/danger.
   */
  alertVariant: "default" | "info" | "warning" | "destructive";
  /** `document.title` prefix. Empty on production, so the tab is unchanged. */
  titlePrefix: string;
  /** Which lucide icon the badge uses; mapped to a component by the client. */
  icon: "shield" | "flask" | "code" | "alert";
}

const PRODUCTION: EnvironmentInfo = {
  name: "production",
  label: "Production",
  shortLabel: "PROD",
  description: "Live system - what you enter here is real.",
  noticeTitle: "Production",
  noticeBody: "You are signing in to the live system. What you enter here is real business data.",
  isProduction: true,
  // Deliberately quiet: production is the normal case, so it must not look like an alert
  // competing with the letterhead warning that shares this corner.
  badgeClassName: "border-border bg-muted text-muted-foreground",
  alertVariant: "default",
  titlePrefix: "",
  icon: "shield",
};

const STAGING: EnvironmentInfo = {
  name: "staging",
  label: "Staging",
  shortLabel: "STAGE",
  description: "Copy of the live system on its own server and database - nothing here is real.",
  noticeTitle: "Staging - not the live system",
  noticeBody:
    "You are signing in to a copy of the live system, on a separate server with a separate database. " +
    "Nothing you enter here reaches real customers, real stock or the live shop.",
  isProduction: false,
  badgeClassName: "border-warning/50 bg-warning-subtle text-warning-subtle-foreground",
  alertVariant: "warning",
  titlePrefix: "STAGING \u00b7",
  icon: "flask",
};

const DEVELOPMENT: EnvironmentInfo = {
  name: "development",
  label: "Development",
  shortLabel: "DEV",
  description: "A developer's local copy - nothing here is real.",
  noticeTitle: "Development - not the live system",
  noticeBody:
    "You are signing in to a developer's local instance. Nothing here is real, and this database " +
    "may be wiped at any time.",
  isProduction: false,
  badgeClassName: "border-info/50 bg-info-subtle text-info-subtle-foreground",
  alertVariant: "info",
  titlePrefix: "DEV \u00b7",
  icon: "code",
};

const UNKNOWN: EnvironmentInfo = {
  name: "unknown",
  label: "Environment unknown",
  shortLabel: "ENV?",
  description: "APP_ENV is not set on the server, so this screen cannot tell you which system you are on.",
  noticeTitle: "Environment unknown",
  noticeBody:
    `The server did not report its environment (${APP_ENV_VAR} is unset or unrecognised). ` +
    "Until it does, assume you may be on the live system. Ask for " +
    `\`${APP_ENV_VAR}=production\` or \`${APP_ENV_VAR}=staging\` in the server's .env.`,
  isProduction: false,
  badgeClassName: "border-destructive/50 bg-destructive-subtle text-destructive-subtle-foreground",
  alertVariant: "destructive",
  titlePrefix: "ENV UNKNOWN \u00b7",
  icon: "alert",
};

/**
 * Spelling tolerance, on purpose: `prod`/`live`, `stage`/`stg`/`uat`, `dev`/`local`.
 * Anything else - including a typo - is `unknown`, not a guess.
 */
const ALIASES: Record<string, EnvironmentName> = {
  production: "production",
  prod: "production",
  live: "production",
  staging: "staging",
  stage: "staging",
  stg: "staging",
  uat: "staging",
  development: "development",
  dev: "development",
  local: "development",
};

/** `APP_ENV` value (anything at all) -> a name. Never throws, never guesses upward. */
export function resolveEnvironmentName(raw: unknown): EnvironmentName {
  if (typeof raw !== "string") return "unknown";
  return ALIASES[raw.trim().toLowerCase()] ?? "unknown";
}

/** The full record for a raw `APP_ENV` value or an already-resolved name. */
export function environmentInfo(raw: unknown): EnvironmentInfo {
  switch (resolveEnvironmentName(raw)) {
    case "production":
      return PRODUCTION;
    case "staging":
      return STAGING;
    case "development":
      return DEVELOPMENT;
    default:
      return UNKNOWN;
  }
}

/** Every environment a server may legitimately declare, for docs and tests. */
export const ENVIRONMENT_NAMES: readonly EnvironmentName[] = [
  "production",
  "staging",
  "development",
  "unknown",
];
