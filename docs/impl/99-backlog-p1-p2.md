# Backlog — P1 / P2 (not part of the P0 run)

These are the findings from the audit that are **not** in the P0 steps. Each item lists the
problem, where it lives today, and the shape of the fix, so any of them can be turned into a
runbook like the P0 ones on request.

Do not mix these into a P0 commit.

---

## P1 — correctness and operational gaps

### 1. `stock_movements` ledger
**Problem:** inventory is a single mutable `inventory.quantity` column. Nothing records *why* it
changed, so a wrong quantity cannot be reconstructed or audited; sales, refunds, transfers and
purchase orders all just write the number.
**Fix:** append-only `stock_movements` table (`inventory_id`, `delta`, `reason`
(`sale|refund|cancel|transfer_in|transfer_out|po_receipt|adjustment`), `ref_id`, `user_id`,
`created_at`) written inside every existing transaction; `inventory.quantity` stays as a cached
total, verified by a reconciliation script. Depends on step 03 (the transactions already exist).

### 2. Stock adjustment / stock-take
**Problem:** there is no way to correct stock. Today the only path is editing the inventory
record directly, which leaves no trace.
**Fix:** `POST /api/inventory/:id/adjust` with `{ delta | countedQuantity, reason }`, written
through the ledger above, permission-gated on `inventory:update`, plus a stock-take screen that
lists counted vs system differences.

### 3. Reporting is thin
**Problem:** `products.landingPrice` is stored but never used in any report (margin is
unavailable); `inventory.expiryDate` exists but is never surfaced anywhere; there is no
sales-by-category/brand/store trend report.
**Fix:** a `server/reports.ts` module with explicit queries (revenue, gross margin using
`landingPrice`, top products, expiry watchlist) + a Reports page; all aggregates must apply the
step-07 scope filter.

### 4. Barcode scanning at the POS
**Problem:** every POS line is added by searching a product name; `inventory.barcode` exists and
is printed on labels but no screen reads it.
**Fix:** a scanner input that is always focused on the POS page (keyboard-wedge scanners type the
code + Enter), resolving barcode → inventory row → cart line, with a beep on success/failure.

### 5. Refunds are all-or-nothing in the UI
**Problem:** `refundSale` accepts per-item quantities (added in step 03) but the receipt dialog
only offers a full refund.
**Fix:** per-line quantity inputs in the refund dialog; the API already supports it.

### 6. Reorder workflow
**Problem:** `products.minStock` is stored, and low stock is shown, but nothing turns it into an
action.
**Fix:** a “low stock” list that drafts a purchase order per supplier in one click, reusing
`createPurchaseOrderSchema`.

### 7. Pet-profile data is collected but unused
**Status: resolved — the pet-shaped fields were removed.** A customer profile describes the
account, so `pet_type` / `pet_birthday` became `customer_type` (`B2B` / `B2C`) and
`land_line_number`, and `phone_number` became `mobile_number` (see
`migrations/0016_customer_profiles_customer_type.sql`). Segmenting the customer base by account
type is what the POS and reporting actually use, so there is no half-collected data left to
surface.

### 8. No audit log
**Problem:** `sales_transaction_actions` and `purchase_order_actions` log some flows; user, role,
store, price and permission changes log nothing.
**Fix:** a generic `audit_log` table + a `recordAudit()` helper called from mutating routes
(who, what, before/after diff, IP), plus an admin viewer.

### 9. No password self-service or MFA
**Problem:** password resets require direct DB/sqlite access; there is no MFA for admin accounts.
**Fix:** `POST /api/users/me/password` (current + new), admin reset with a one-time token, and
TOTP for `hierarchyLevel = admin`.

### 10. No offline POS or request idempotency
**Problem:** a network drop mid-sale either loses the sale or, on retry, duplicates it.
**Fix:** client-side `Idempotency-Key` header on `POST /api/sales-transactions` with a unique
index on `(store_id, idempotency_key)`; offline queue is a larger follow-up.

---

## P2 — developer experience and polish

**Status: all 14 items done** (one commit each, on `main`):

| # | Commit | | # | Commit |
| --- | --- | --- | --- | --- |
| 1 | `7ce668be` perf(client): split the routes with React.lazy | | 8 | `7854fb27` chore: delete the scratch note + unused dep |
| 2 | `25c7ab18` feat(client): add an error boundary | | 9 | `723ae804` refactor(server): store routes extracted (first domain; see note below) |
| 3 | `6dc39f5e` fix(client): stop caching every query forever | | 10 | `d44eb7bc` ci: run the test suite once |
| 4 | `3c094983` feat(client): gate routes on the API's permission rules | | 11 | `cc7de215` fix(db): drop the partial journal, db:push only |
| 5 | `d27f3913` refactor(client): one formatting module | | 12 | `7854fb27` chore: delete the scratch note + unused dep |
| 6 | `45eafc71` fix(dashboard): theme the chart | | 13 | `55bd9629` fix(stores): remove the duplicate registrations |
| 7 | `9aab2daa` docs: add the missing README | | 14 | `eca4c0d4` test: serialise test runs with an advisory lock |

> #9 is deliberately incremental: the item's own fix says "as each domain is touched, one
> domain per PR". `server/routes.ts` is down from 5,210 to 5,018 lines with
> `server/routes/stores.ts` extracted; the remaining domains should follow as they are
> worked on.

| # | Problem | Fix |
| --- | --- | --- |
| 1 | All 20 pages are imported statically in `client/src/App.tsx`, so the first load ships every screen (incl. Recharts) | `React.lazy` + `Suspense` per route, keeping POS eager |
| 2 | No error boundary — one render error blanks the whole app | `client/src/components/ErrorBoundary.tsx` around the router outlet, reporting to the console + a friendly reload screen |
| 3 | `queryClient` uses `staleTime: Infinity` and no refetch on focus, so a second cashier's sale never appears | `staleTime: 30_000`, `refetchOnWindowFocus: true`, explicit `invalidateQueries` after each mutation |
| 4 | Routes are not permission-gated — a staff user can open `/users` and get 403s from every call | a `RequirePermission` wrapper driven by `role.permissions` from `/api/user` |
| 5 | Currency/date/number formatting is implemented three different ways | one `client/src/utils/format.ts` (`formatCurrency`, `formatDate`, `formatQuantity`) used everywhere |
| 6 | Dashboard charts ignore the theme (26 hard-coded palette/hex values) | read the design tokens from `docs/DESIGN_SYSTEM.md` / CSS vars instead of literals |
| 7 | No README — setup, env vars, scripts, test DB are undocumented | `README.md` covering `.env`, `npm run db:push`, dev/build/test, test database creation |
| 8 | `info.info` scratch note committed at repo root | delete it |
| 9 | `server/routes.ts` is 5,355 lines | split by domain (`routes/products.ts`, `routes/sales.ts`, …) as each domain is touched, one domain per PR |
| 10 | CI runs the test suite twice | one `npm test` invocation in `.github/workflows/test.yml` |
| 11 | `migrations/meta/_journal.json` only lists `0000`-`0003`, so `migrate()` silently skips `0004`-`0009` (including the new `0009_user_sessions.sql`); `drizzle-kit generate` hangs because it tries to reconcile the whole drifted schema | regenerate the journal from the current schema (or drop the journal entirely) and keep `npm run db:push` as the single mechanism until then |
| 12 | `memorystore` is still a dependency after step 04 removed its only use | `npm uninstall memorystore` |
| 13 | `POST /api/stores` and `PUT /api/stores/:id` are each registered **twice** (`routes.ts` ~174/243 with `requireAuth`, ~2007/2066 with `requirePermission('stores', …)`); only the first registration ever runs, so the second pair is dead code with different permission semantics | delete the dead pair, keep the permission-checked one |
| 14 | Backend suites must never run concurrently — two `vitest` processes on one test database produce dozens of duplicate-key failures that look like real regressions | `reuseExistingServer: false`-style guard, or a Postgres advisory lock in `tests/global-setup.ts` |
