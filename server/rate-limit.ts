import rateLimit from "express-rate-limit";

/**
 * Login throttle.
 *
 * AI Agent Note: /api/login had no limit at all. Each attempt runs a deliberately
 * slow scrypt hash and allocates a session, so a login loop is both a brute-force
 * oracle and a cheap way to starve the event loop for every cashier. Successful
 * logins are not counted (skipSuccessfulRequests), so a busy shift cannot lock
 * itself out - only failures add up.
 *
 * Storage is in-process. A multi-instance deployment needs a shared store
 * (rate-limit-redis) before this is a real defence against a distributed attack;
 * it still stops the common single-source loop.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,                      // express-rate-limit v6 called this `max`
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    message: "Too many failed login attempts",
    suggestion: "Wait 15 minutes before trying again, or ask an administrator to reset your password",
  },
});

/**
 * Coarse per-IP ceiling for the whole API. Deliberately generous: the POS page
 * polls several endpoints and the bulk import posts multi-megabyte bodies, so this
 * is a runaway-client / scripted-abuse guard, not a business rule.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => !req.path.startsWith("/api"),
  message: {
    message: "Too many requests",
    suggestion: "Slow down and try again in a moment",
  },
});
