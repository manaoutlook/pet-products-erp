# Pet Products ERP

A multi-store ERP for a pet-products retailer: inventory and stock ledger, purchase
orders, point of sale, stock transfers, stock takes, customer and pet profiles, and
role-based access down to the region/store level.

Single-page React client, Express API, PostgreSQL (Drizzle ORM). One process serves both
in development and in production (`dist/index.js` serves the built client).

## Requirements

- Node.js 20 or newer (`npm ci --legacy-peer-deps` is used because some peer ranges are
  stricter than the pinned versions)
- PostgreSQL 14 or newer, running locally or reachable by URL
- On macOS/Linux everything below works in `bash`; on Windows use Git Bash or WSL

## Getting started

```bash
# 1. install dependencies
npm ci --legacy-peer-deps

# 2. create your environment file
cp .env.example .env        # then edit DATABASE_URL

# 3. create the schema (see "Database" below - db:push is the only mechanism)
npm run db:push

# 4. optional: demo data
npm run db:seed

# 5. run it
npm run dev                 # http://localhost:5001
```

The API and the Vite client run from the same process in development (`tsx watch
server/index.ts` + Vite middleware), so there is one URL and no proxy to configure. The
server picks the next free port (5001, 5002, …) if 5001 is taken and logs the URL it
chose.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string used by the app **and** by `drizzle-kit push`. |
| `SESSION_SECRET` | in production | Signs session cookies. Production refuses to start without it (a well-known default would let anyone forge a session). |
| `PORT` | no | Default `5001`. |
| `NODE_ENV` | no | `development` (default) / `production` / `test`. |
| `TEST_DATABASE_URL` | tests | Database the suites use. Read from `.env.test`. |

`.env` is git-ignored; `.env.example` documents the shape and `.env.test` is committed on
purpose so every checkout runs the tests against the same database name.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API + client with hot reload (port 5001, next free if taken) |
| `npm run build` | `vite build` into `dist/public`, then bundles the server to `dist/index.js` |
| `npm start` | Runs the production build (serves the built client) |
| `npm run check` | `tsc --noEmit` (see "Known issues") |
| `npm test` | Vitest in watch mode |
| `npm run test:run` | Vitest, single run (what CI executes) |
| `npm run test:frontend` | Frontend suites only (happy-dom, no database) |
| `npm run test:backend` | Backend suites only (real Postgres, serialised) |
| `npm run test:coverage` | Single run with the v8 coverage report + thresholds |
| `npm run test:db:reset` | Drops and recreates the test schema, then pushes it |
| `npm run db:push` | Applies `db/schema.ts` to the database |
| `npm run db:seed` | Sample data (`scripts/seed-sample-data.ts`) |
| `npm run db:seed-inventory` | Inventory rows |
| `npm run stock:reconcile` | Recomputes `inventory.quantity` from the stock ledger and reports drift |
| `npm run stock:repair-cancelled` | Dry-run report of cancelled receipts whose stock never came back; add `-- --apply` to restore it (`--transaction <id>` to scope one receipt) |

Additional seeders live in `scripts/` (`seed-users-roles`, `seed-regions`, `seed-stores-demo`,
`seed-products`, `seed-orders`, `seed-purchase-orders`, `seed-transfers`); run them with
`npx tsx scripts/<name>.ts`.

## Database

**`npm run db:push` is the single schema mechanism.** It diffs `db/schema.ts` against the
database and applies the difference, in development and in the test suite.

`migrations/*.sql` are kept as reference only: the Drizzle journal that used to drive
`migrate()` listed only `0000`-`0003` while twelve files existed, so `migrate()` applied a
partial schema and silently skipped stock movements, product dimensions and user sessions.
See [`migrations/README.md`](migrations/README.md) for details and for what to do when you
change the schema.


## Tests

```bash
npm run test:frontend      # fast, no database
npm run test:backend       # needs Postgres
npm run test:run           # everything (what CI runs)
```

The backend suites use a real database, so:

- `tests/global-setup.ts` creates the test database from `.env.test` if it is missing, then
  runs `drizzle-kit push` so the schema is current before the first test.
- Each file truncates the tables it needs (`cleanDatabase()`), which is why
  `fileParallelism: false` is set in `vitest.config.ts`.
- **Never run two backend suites at the same time.** Two vitest processes on one test
  database produce duplicate-key failures that look like real regressions. The global setup
  takes a Postgres advisory lock for the whole run, so a second run waits for the first (and
  says so) instead of corrupting it.
- `npm run test:db:reset` starts over from an empty schema.

### Known issues in the baseline

Pre-existing and tracked in [`docs/impl/99-backlog-p1-p2.md`](docs/impl/99-backlog-p1-p2.md);
if your numbers match these, your change did not make them worse:

- `npm run check`: 72 type errors, none of them `TS2307` (no missing modules). Most are in
  `server/routes.ts` (untyped query results) and the customer-profile dialogs.
- `npm run test:backend`: 8 failures in `api/customers`, `api/master-data` and
  `api/inventory` - fixture/seed assumptions, not product bugs.

## Project structure

```
client/src/            React app
  pages/               one file per screen, routed (lazily) in App.tsx
  components/          UI primitives (ui/), layout, POS, dashboard, master data
  utils/format.ts      currency / number / date formatting used everywhere
server/                Express API
  routes.ts            all HTTP routes (domain split is backlog item P2 #9)
  middleware.ts        auth, RBAC (rules come from shared/permissions.ts), validation
  session-store.ts     Postgres-backed express-session store
shared/permissions.ts  permission rules shared by the API and the client
db/schema.ts           Drizzle schema - the source of truth for the database
migrations/            reference SQL (see migrations/README.md)
scripts/               seeders, stock reconciliation, maintenance
tests/                 backend/ (real database) and frontend/ (happy-dom)
docs/                  design system + implementation runbooks
```

## Documentation

- [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) - design tokens, themed primitives, do/don't
- [`docs/impl/README.md`](docs/impl/README.md) - index of the P0 hardening runbooks
- [`docs/impl/99-backlog-p1-p2.md`](docs/impl/99-backlog-p1-p2.md) - remaining P1/P2 work
- [`migrations/README.md`](migrations/README.md) - why `db:push` owns the schema

