import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import {
  idParamSchema, paginationSchema, validateBody, validateParams,
} from '../../../server/validate';

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as typeof res & Response;
}

describe('validateBody', () => {
  const schema = z.object({ name: z.string().min(1), quantity: z.number().int().positive() });

  it('passes parsed data through and strips unknown keys', () => {
    const req = { body: { name: 'Widget', quantity: 3, isAdmin: true } } as Request;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    validateBody(schema)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ name: 'Widget', quantity: 3 });
  });

  it('answers 400 with field errors for a bad body', () => {
    const req = { body: { name: '', quantity: '3' } } as Request;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    validateBody(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.suggestion).toBeTruthy();
    expect(Object.keys(res.body.errors)).toEqual(expect.arrayContaining(['name', 'quantity']));
  });
});

describe('validateParams', () => {
  it('coerces a numeric id', () => {
    const req = { params: { id: '42' } } as unknown as Request;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    validateParams(idParamSchema)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req.params as any).id).toBe(42);
  });

  it('rejects a non-numeric id instead of letting NaN reach the query', () => {
    const req = { params: { id: 'abc' } } as unknown as Request;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    validateParams(idParamSchema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });
});

describe('paginationSchema', () => {
  it('applies defaults and rejects absurd limits', () => {
    expect(paginationSchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(paginationSchema.safeParse({ limit: '5000' }).success).toBe(false);
  });
});
