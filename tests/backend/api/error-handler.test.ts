import { describe, it, expect, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
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

const req = { method: "POST", originalUrl: "/api/sales-transactions" } as Request;
const next = vi.fn() as unknown as NextFunction;

describe("errorHandler", () => {
  it("answers with the error status and does not throw", () => {
    const res = makeRes();
    const err = Object.assign(new Error("Insufficient stock"), { status: 400 });
    expect(() => errorHandler(err, req, res, next)).not.toThrow();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ message: "Insufficient stock" });
    expect(next).not.toHaveBeenCalled();
  });

  it("maps unknown errors to 500 and hides the internal message in production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const res = makeRes();
    errorHandler(new Error('relation "secret" does not exist'), req, res, next);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ message: "Internal Server Error" });
    process.env.NODE_ENV = original;
  });

  it("delegates to next when headers were already sent", () => {
    const res = makeRes();
    res.headersSent = true;
    const err = new Error("late failure");
    errorHandler(err, req, res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.statusCode).toBe(0); // untouched
  });

  it("passes the suggestion through for client errors", () => {
    const res = makeRes();
    const err = Object.assign(new Error("Invalid item data"), {
      status: 400,
      suggestion: "Each item must have productId and positive quantity",
    });
    errorHandler(err, req, res, next);
    expect(res.body).toEqual({
      message: "Invalid item data",
      suggestion: "Each item must have productId and positive quantity",
    });
  });
});
