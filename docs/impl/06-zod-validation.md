# Step 06 — Validate every mutating request with Zod

**Priority:** P0 · **Risk:** medium · **New dependencies:** none (`zod` is already used)
**Files:** `server/validate.ts` (new), `server/routes.ts`,
`tests/backend/api/validate.test.ts` (new)

---

## 1. Problem

`server/routes.ts` registers **86** routes but defines only **9** `z.object` schemas and has
**20** `safeParse` call sites (several routes share one). The rest read `req.body` and
`req.params` directly and hand-check a subset of fields, which produces three classes of bug:

| Class | Example |
| --- | --- |
| Wrong type reaches the database | a string `"12"` where an `integer` column is expected; Drizzle/Postgres then throws a 500 the user cannot act on |
| Missing field reaches the database | `refundAmount: "abc"` → `parseFloat` → `NaN` → later comparison silently passes |
| Unvalidated `:id` | `parseInt(req.params.id)` (`routes.ts:3994`, `4125`, …) → `NaN` → `where id = NaN` → 500 “record not found” noise |

Because `routes.ts` is one 5,355-line module, the validation is also inconsistent: some routes
answer `400 {message, suggestion}` (good), others return a raw 500 when Postgres rejects the
value (bad, and it tells the user nothing).

This step introduces one shared validation layer and then converts routes **in priority order**,
so the change can stop at any point without leaving the file half-migrated.

---

## 2. Design

`server/validate.ts` exports three middleware factories:

```ts
validateBody(schema)   // coerce+strip req.body
validateQuery(schema)  // coerce req.query
validateParams(schema) // coerce req.params (numeric ids)
```

Rules:

- **Fail closed** with `400 { message, suggestion, errors }`. `errors` is a flat
  `{ field: string[] }` map (allowed by the error contract as a documented exception).
- **Strip unknown keys** (`z.object` default) so a client cannot smuggle extra columns into a
  `.set({...req.body})` update.
- **Coerce** numbers and booleans, because HTTP is strings: query and params use `z.coerce`,
  bodies use explicit `z.number()` so a JSON `"12"` is rejected (JSON has real numbers).
- Converted handlers then use `req.body` as **typed, parsed data** — no re-checking.

---

## 3. Implementation

### 3a. `server/validate.ts` (new)

```ts
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

/**
 * Shared request validators.
 *
 * AI Agent Note: only 20 of the 86 routes validated their input, and the ones that
 * did each hand-rolled their own error shape. These helpers make validation the
 * default: parsed+stripped data lands back on req.body/query/params, and failures
 * answer the same {message, suggestion, errors} body every time.
 */
function fail(res: Response, error: z.ZodError, suggestion: string) {
  // flatten() keeps field names at the top level so the client can highlight inputs.
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }

  return res.status(400).json({
    message: error.issues[0]?.message
      ? `Invalid request: ${error.issues[0].message}`
      : "Invalid request",
    suggestion,
    errors: fieldErrors,
  });
}

export function validateBody<T extends z.ZodTypeAny>(schema: T, suggestion = "Check the submitted values and try again") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return fail(res, result.error, suggestion);
    req.body = result.data;
    next();
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T, suggestion = "Check the query parameters and try again") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return fail(res, result.error, suggestion);
    // req.query is a getter in Express 5 - assign through the parsed object.
    req.query = result.data;
    next();
  };
}

export function validateParams<T extends z.ZodTypeAny>(schema: T, suggestion = "Check the request URL and try again") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) return fail(res, result.error, suggestion);
    req.params = result.data;
    next();
  };
}

/** Reusable pieces. */
export const idParamSchema = z.object({ id: z.coerce.number().int().positive("A valid id is required") });

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
```

---

## 4. Conversion plan

Get the authoritative list first — do not trust this table for exact paths:

```bash
grep -n 'app\.\(post\|put\|patch\|delete\)(' server/routes.ts
```

Convert in this order and **commit after each group**, so the step can be paused safely.

### Group 1 — money and stock (do these first)

| Route | Schema |
| --- | --- |
| `POST /api/sales-transactions` | `z.object({ items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1), paymentMethod: z.string().min(1), customerProfileId: z.number().int().positive().nullish(), transactionType: z.enum(['STORE_SALE','DC_SALE']).optional() })` |
| `POST /api/sales-transactions/:id/refund` | `validateParams(idParamSchema)` + `z.object({ refundAmount: z.number().positive().optional(), reason: z.string().max(500).optional(), items: z.array(z.object({ id: z.number().int().positive(), quantity: z.number().int().positive() })).optional() })` |
| `POST /api/sales-transactions/:id/cancel` | `validateParams(idParamSchema)` + `z.object({ reason: z.string().max(500).optional() })` |
| `POST /api/inventory/check-stock` | worked example below |

### Group 2 — users, roles, stores

Reuse the existing `insertUserSchema`, `updateUserSchema`, `insertStoreSchema` from
`@db/schema`. For updates add `.partial()` so a sparse body does not need every field.

⚠️ `insertUserSchema` contains `password` — never log the parsed body, and keep the hashing call
as it is.

### Group 3 — master data and imports

`masterDataBulkDeleteSchema` and `masterDataImportSchema` already exist. Apply them through
`validateBody` so the error shape matches, then delete the inline `safeParse` blocks.

### Group 4 — transfers and purchase orders

`insertTransferRequestSchema`, `insertTransferRequestItemSchema`, `insertTransferActionSchema`,
`createPurchaseOrderSchema` and `updatePurchaseOrderSchema` already exist — convert the handlers
that still read `req.body` directly.

---

## 5. Worked example — `POST /api/inventory/check-stock`

Before (`server/routes.ts:4205+`):

```ts
  app.post("/api/inventory/check-stock", requireAuth, async (req, res) => {
    try {
      const { items, storeId } = req.body;

      if (!items || !Array.isArray(items)) {
        return res.status(400).json({
          message: "Items array is required",
          suggestion: "Provide items to check stock for"
        });
      }
      ...
      for (const item of items) {
        if (!item.productId || !item.quantity) {
          return res.status(400).json({
            message: "Each item must have productId and quantity",
            suggestion: "Provide valid item data"
          });
        }
```

After — declare the schema next to the other schemas at the top of the file:

```ts
const checkStockSchema = z.object({
  items: z.array(z.object({
    productId: z.number().int().positive("productId must be a positive integer"),
    quantity: z.number().int().positive("quantity must be a positive integer"),
  })).min(1, "Provide at least one item"),
  storeId: z.number().int().positive().nullish(),
});
```

and the route:

```ts
  app.post("/api/inventory/check-stock",
    requireAuth,
    validateBody(checkStockSchema, "Each item must have productId and quantity"),
    async (req, res) => {
      try {
        const { items, storeId } = req.body;   // already parsed and stripped
        ...
      }
    });
```

Delete the two hand-written guards (`if (!items …)` and `if (!item.productId …)`) — the
middleware now covers them, and keeping both means two different messages for one mistake.

---

## 6. Per-route checklist

1. Schema declared at the top of `routes.ts` (or reused from `@db/schema`).
2. Mount `validateBody` / `validateQuery` / `validateParams` **before** the handler.
3. Delete the hand-written type checks the middleware now covers.
4. Keep the business checks (existence, permissions, state transitions) in the handler.
5. `.max()` every free-text field you accept (`reason`, `notes`, `description`) so a 10 MB note
   cannot be stored.
6. Touch the frontend only if it depended on a message you replaced.

---

## 7. Tests — `tests/backend/api/validate.test.ts` (new)

Pure middleware tests — fake `req`/`res`, no database.

```ts
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
```

---

## 8. Verification

```bash
npx vitest run tests/backend/api/validate.test.ts
npx vitest run tests/frontend
npx tsc --noEmit 2>&1 | grep -c "error TS"
npm run dev
```

Manual smoke test for each converted group — it must still work, and now fail with a helpful
400 instead of a 500:

```bash
curl -s -X POST localhost:5001/api/inventory/check-stock \
  -H 'Content-Type: application/json' -d '{"items":[{"productId":"x","quantity":1}]}'
# -> 400 with message + errors.productId
```

Check the POS/purchase-order UI still submits successfully (the frontend already sends real JSON
numbers, so coercion should never be needed on a body — if a screen starts failing with
`quantity must be positive integer`, its payload uses strings and needs fixing client-side).

---

## 9. Rollback

Grouped by commit: revert the last converted group. `server/validate.ts` and its test can stay —
they are additive and harmless without call sites.

---

## 10. Done criteria

- [ ] `server/validate.ts` exists with the three factories + shared schemas
- [ ] Every route in Group 1 and Group 2 is mounted with a validator
- [ ] Hand-written checks that the middleware replaced are deleted (no duplicate messages)
- [ ] Invalid payloads answer `400 {message, suggestion, errors}`; valid ones behave as before
- [ ] New tests pass, frontend tests pass, tsc count unchanged
