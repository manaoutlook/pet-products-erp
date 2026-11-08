# P0 Implementation Runbook — Index

This folder is a set of **self-contained runbooks**. Each file is written so it can be
handed over on its own: problem statement → evidence → exact edits → tests →
verification → rollback → done criteria. Implement **one file at a time, in this order**,
and paste only that file when you want it executed.

## Baseline (measure before step 01, re-measure after every step)

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"     # baseline: 76 (all pre-existing)
npx vitest run tests/frontend 2>&1 | tail -5   # baseline: 19 files / 128 tests passed
npm run test:backend 2>&1 | tail -5            # baseline: record the exact numbers here
npx vite build 2>&1 | tail -3                  # must stay "✓ built"
```

> Record the three numbers in a scratch note. Every step must leave them equal or better.

## Order and why

| Step | File | P0 item | Risk | Touches |
| --- | --- | --- | --- | --- |
| 01 | [01-error-handler.md](./01-error-handler.md) | Error handler crashes the process | very low | `server/index.ts` |
| 02 | [02-remove-credential-logging.md](./02-remove-credential-logging.md) | Salts/hashes/passwords in logs | very low | `server/auth.ts`, `server/index.ts` |
| 03 | [03-atomic-pos-transactions.md](./03-atomic-pos-transactions.md) | POS sale is not atomic | medium | `server/sales.ts` (new), `server/invoice-counter.ts`, `server/routes.ts` |
| 04 | [04-session-store.md](./04-session-store.md) | Sessions die on restart | low | `db/schema.ts`, `server/session-store.ts` (new), `server/auth.ts` |
| 05 | [05-rate-limit-helmet.md](./05-rate-limit-helmet.md) | No login throttling / headers | low | `server/index.ts`, `server/auth.ts` |
| 06 | [06-zod-validation.md](./06-zod-validation.md) | 66 of 86 routes unvalidated | medium | `server/validate.ts` (new), `server/routes.ts` |
| 07 | [07-row-level-scoping.md](./07-row-level-scoping.md) | Reads not scoped to store/region | high | `server/scoping.ts` (new), `server/routes.ts` |

Sequencing rules:

1. **01 and 02 first** — they are minutes of work and they stop the server from dying /
   leaking secrets, which makes every later step easier to debug.
2. **03 before 06** — step 06 rewrites request bodies into typed values; doing it on top of
   already-transactional sale code avoids rewriting the same route twice.
3. **04 is independent** — safe to reorder with 05 if you prefer.
4. **07 last** — it is the largest and it must be layered on top of the validation helpers
   introduced in 06.

## Conventions every step follows

- **No behaviour changes outside the stated scope.** No drive-by refactors, no renaming.
- **New dependencies are opt-in per step** and are listed at the top of that file.
  Only step 05 adds packages (`express-rate-limit`, `helmet`).
- **Module extraction over route growth.** `server/routes.ts` is already 5,355 lines. New
  logic goes into a sibling module (`server/*.ts`) that the route calls, exactly like the
  existing `store-deletion.ts`, `invoice-counter.ts` and `master-data-import.ts` pattern.
- **Error contract is fixed**: `res.status(n).json({ message, suggestion? })`. The client
  parses exactly this shape in `client/src/lib/apiError.ts`. Never add other top-level keys
  to error bodies (validation details go under `errors`).
- **Tests**: backend assertions live in `tests/backend/api/*.test.ts` and use the real test
  database (`tests/helpers/test-db.ts`). Frontend assertions live in `tests/frontend/**`.
  Backend tests currently call the DB/modules directly rather than HTTP — keep that style
  unless a step explicitly adds the HTTP helper.
- **Comment style**: this repo explains *why* above the code (`// AI Agent Note:` blocks).
  Keep that when you add non-obvious logic.
- **Commit one step per commit**, message `p0(0X): <what>`.

## Definition of done (same for every step)

- [ ] Code changes applied exactly as specified
- [ ] New/updated tests written and passing
- [ ] `npx vitest run tests/frontend` — same or better than baseline
- [ ] `npm run test:backend` — same or better than baseline
- [ ] `npx tsc --noEmit | grep -c "error TS"` — **no new errors** (number must not grow)
- [ ] `npx vite build` — still succeeds
- [ ] The step's own "Manual verification" checklist passed in `npm run dev`
- [ ] Committed on a branch, one commit for the step

## Backlog (not part of P0)

See [99-backlog-p1-p2.md](./99-backlog-p1-p2.md) for the P1/P2 items (stock ledger,
reports, barcode scanning, code splitting, error boundary…). They are listed there so they
are not lost, but they must not be mixed into the P0 steps.
