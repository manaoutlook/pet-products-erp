/**
 * Database reachability failures.
 *
 * AI Agent Note: a stopped or unreachable Postgres used to surface as
 * "Internal server error", which sends the person at the login screen (and the
 * person reading the logs) hunting for a typo in the username when the real fix
 * is "start the database". The driver error is a connection failure, not a bug
 * in a route, so it is classified here and reported as HTTP 503
 * "Database unavailable" - both by the login route and by the terminal error
 * handler every other endpoint funnels through.
 *
 * Only genuine connection faults match. A missing table (`42P01`) or a unique
 * violation (`23505`) is a different problem with a different fix and stays a
 * normal route error.
 */

export const DATABASE_UNAVAILABLE_MESSAGE = "Database unavailable";

export const DATABASE_UNAVAILABLE_SUGGESTION =
  "The server cannot reach the database. Check that PostgreSQL is running and reachable, then try again. If the problem persists, contact support.";

/**
 * Node/socket errno codes, PostgreSQL SQLSTATE connection exceptions
 * (class 08, plus admin shutdown / cannot connect now / too many connections)
 * and the client-side codes postgres.js raises when a pooled connection dies.
 */
const CONNECTION_ERROR_CODES = new Set<string>([
  // Node socket-level failures raised when nothing is listening on 5432.
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "ENOTCONN",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  // PostgreSQL SQLSTATE class 08 - connection exception.
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  // Server shutting down / still starting / out of connection slots.
  "57P01",
  "57P02",
  "57P03",
  "53300",
  // postgres.js client-side failures.
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
]);

/**
 * Some driver failures arrive with no `code` at all (bare `Error` from the
 * socket), so the well-known connection text is matched as a fallback.
 */
const CONNECTION_MESSAGE_PATTERN =
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|connection refused|connection terminated|connection (?:closed|ended)|the database system is (?:starting up|shutting down)|terminating connection due to administrator command|server closed the connection unexpectedly/i;

/**
 * True when `error` (or anything in its `cause` chain) says the database could
 * not be reached. Walking the chain matters because Drizzle and Passport both
 * re-wrap driver errors before they reach a route.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);

    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
    if (CONNECTION_ERROR_CODES.has(code)) return true;

    const message = typeof candidate.message === "string" ? candidate.message : "";
    if (CONNECTION_MESSAGE_PATTERN.test(message)) return true;

    current = candidate.cause;
  }

  return false;
}

/** The response body used for every 503 "Database unavailable" answer. */
export function databaseUnavailableBody(): {
  message: string;
  suggestion: string;
} {
  return {
    message: DATABASE_UNAVAILABLE_MESSAGE,
    suggestion: DATABASE_UNAVAILABLE_SUGGESTION,
  };
}
