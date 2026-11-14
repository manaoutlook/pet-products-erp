import { describe, it, expect, vi, afterEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  DATABASE_UNAVAILABLE_MESSAGE,
  DATABASE_UNAVAILABLE_SUGGESTION,
  databaseUnavailableBody,
  isDatabaseUnavailable,
} from "../../../server/db-errors";
import { errorHandler } from "../../../server/error-handler";

function makeRes() {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as typeof res & Response;
}

const req = { method: "POST", originalUrl: "/api/login" } as Request;
const next = vi.fn() as unknown as NextFunction;

afterEach(() => vi.restoreAllMocks());

describe("isDatabaseUnavailable", () => {
  it("recognises a refused connection (Postgres not running)", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    expect(isDatabaseUnavailable(err)).toBe(true);
  });

  it("recognises PostgreSQL connection-exception SQLSTATEs", () => {
    expect(isDatabaseUnavailable(Object.assign(new Error("boom"), { code: "08006" }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("boom"), { code: "08001" }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("boom"), { code: "57P03" }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("boom"), { code: "53300" }))).toBe(true);
  });

  it("recognises a socket error that carries only a message", () => {
    expect(isDatabaseUnavailable(new Error("write ECONNREFUSED 127.0.0.1:5432"))).toBe(true);
    expect(isDatabaseUnavailable(new Error("the database system is starting up"))).toBe(true);
  });

  it("follows the cause chain when the driver error is wrapped", () => {
    const root = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    const wrapped = new Error("Failed query: select * from users", { cause: root });
    expect(isDatabaseUnavailable(wrapped)).toBe(true);
  });

  it("does not treat unrelated database errors as an outage", () => {
    expect(isDatabaseUnavailable(Object.assign(new Error("relation does not exist"), { code: "42P01" }))).toBe(false);
    expect(isDatabaseUnavailable(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(false);
    expect(isDatabaseUnavailable(new Error("Invalid stored password format"))).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
    expect(isDatabaseUnavailable(undefined)).toBe(false);
  });
});

describe("databaseUnavailableBody", () => {
  it("carries the message and the actionable suggestion", () => {
    expect(databaseUnavailableBody()).toEqual({
      message: DATABASE_UNAVAILABLE_MESSAGE,
      suggestion: DATABASE_UNAVAILABLE_SUGGESTION,
    });
  });
});

describe("errorHandler with an unreachable database", () => {
  it("answers 503 with 'Database unavailable' instead of a generic 500", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = makeRes();
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      message: "Database unavailable",
      suggestion: DATABASE_UNAVAILABLE_SUGGESTION,
    });
    expect(next).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
  });

  it("keeps the message in production (it is not an internal detail)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const res = makeRes();
    errorHandler(
      Object.assign(new Error("terminating connection due to administrator command"), {
        code: "57P01",
      }),
      req,
      res,
      next,
    );

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      message: "Database unavailable",
      suggestion: DATABASE_UNAVAILABLE_SUGGESTION,
    });
    process.env.NODE_ENV = original;
  });
});
