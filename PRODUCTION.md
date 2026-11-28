# Production instance — SmartERP-prod

This folder is a **second checkout** of the same repository. It shares git history
with the development checkout (`../pet-products-erp`) but has its own runtime
state. Nothing here is committed; production never commits.

> **Scope.** This document describes the *single-Mac, two-checkout* setup: dev on
> port 5001, "production" on 5002, both on `localhost`. The live production
> environment is now the **Ubuntu VPS**, where the application folder is
> `/opt/SmartERP` and the app runs under systemd — install it with
> [`docs/PRODUCTION_SERVER.md`](docs/PRODUCTION_SERVER.md) (Steps 1 → 12).
> Everything below about the *data-import order*, *emptying the transactions* and
> the *`DATABASE_URL` precedence trap* still applies on the server; only the ports,
> scripts and folder paths differ.

| | Development | Production |
| --- | --- | --- |
| Folder | `../pet-products-erp` | `../SmartERP-prod` (this one) |
| URL | http://localhost:5001 | **http://localhost:5002** |
| Database | `smart_erp` | **`smart_erp_prod`** |
| `NODE_ENV` | `development` | `production` (`dist/index.js` serves the built client) |
| Start | `npm run dev` (`start_app.sh`) | `./start_prod.sh` |
| Sync | `git push` | `git fetch` + reset (see `deploy.sh`) |

Local-only state that git does not manage: `.env`, `uploads/`, `dist/`,
`node_modules/`, `logs/`, `.prod.pid`, and the three `*_prod.sh` scripts.

> **Never run `../pet-products-erp/start_app.sh` or `stop_app.sh` here.** They run
> `pkill -f node`, which would kill this instance (and every other Node process).
> Use `./start_prod.sh` / `./stop_prod.sh`; they only touch this instance's pid
> file / port 5002.

## Daily commands

```bash
./start_prod.sh     # start only this instance (waits for /api/health)
./stop_prod.sh      # stop only this instance
./deploy.sh         # fetch origin/main, install, db:push, build, restart
```

`./start_prod.sh` prints `Database: smart_erp_prod` before starting — check that
line every time. It must say `smart_erp_prod`, never `smart_erp`.

**Always start production with `./start_prod.sh`, not a bare `npm start`.**
`npm start` inherits the environment of whatever terminal you are in, and the
server's `dotenv` does **not** override inherited variables (see the first
Production note below).

---

## Importing data into a fresh database — the order

The order matters. The rule is:

1. **Restore the dump first**, into an empty database.
2. **`npm run db:push` second**, to reconcile the schema with the current code.

`pg_restore` recreates schema *and* data (tables → data → sequences → indexes →
constraints, in the right dependency order). If you run `db:push` first, the
restore then fails with "relation already exists". If you restore into a
database that is not empty, it fails with duplicate keys.

### Step 0 — stop the app

```bash
cd /Users/manavazhagan/Documents/VS-Code/1git/PetErp-Git/SmartERP-prod
./stop_prod.sh
```

The dev server may keep running; `pg_dump` takes a transactionally consistent
snapshot.

### Step 1 — (optional) back up what is in the target now

```bash
pg_dump -h localhost -U postgres -Fc smart_erp_prod \
  -f /tmp/smart_erp_prod_before_import_$(date +%Y%m%d_%H%M).dump
```

### Step 2 — drop and recreate the target, empty

```bash
dropdb -h localhost -U postgres --if-exists smart_erp_prod
createdb -h localhost -U postgres -O postgres smart_erp_prod
```

### Step 3 — dump the source (keep this file: it is your rollback)

```bash
pg_dump -h localhost -U postgres -Fc smart_erp \
  -f /tmp/smart_erp_$(date +%Y%m%d_%H%M).dump
```

`-Fc` = compressed custom format: schema + data + indexes + sequences +
constraints in one file.

### Step 4 — restore into the empty database

```bash
pg_restore -h localhost -U postgres -d smart_erp_prod \
  --no-owner --no-privileges --exit-on-error \
  /tmp/smart_erp_YYYYMMDD_HHMM.dump
```

`--exit-on-error` stops at the first problem instead of continuing and leaving
you with a half-restored database.

### Step 5 — apply the current code's schema (`db:push`)

```bash
set -a; source ./.env; set +a        # exports DATABASE_URL from this folder's .env
npm run db:push
```

If the dump came from the same commit, this prints "No changes detected". If the
code is newer than the dump, it adds the missing tables/columns. It is
interactive and asks before anything destructive — read the prompt.

### Step 6 — do not carry development sessions into production

```bash
psql -h localhost -U postgres -d smart_erp_prod -c 'DELETE FROM user_sessions;'
```

### Step 7 — copy uploaded files (the DB only stores their paths)

```bash
ditto ../pet-products-erp/uploads ./uploads
```

### Step 8 — verify

```bash
psql -h localhost -U postgres -d smart_erp_prod -Atc \
  "select 'users='||count(*) from users; \
   select 'products='||count(*) from products; \
   select 'tables='||count(*) from information_schema.tables where table_schema='public';"

./start_prod.sh
curl -s http://localhost:5002/api/health          # {"status":"ok","db":"up",...}
```

Expected from the current development database: `users=14`, `products=56`,
`tables=40`.

At boot the app itself creates anything missing: the two VAT companies
(`ensureVatCompanySeeds`) and the admin role/user (`setupAdmin`). Seeding demo
data is not required for production.

### If you already ran `db:push` on the fresh database

Then the schema exists, so restore only the data:

```bash
psql -h localhost -U postgres -d smart_erp_prod -c \
  'TRUNCATE TABLE users, products RESTART IDENTITY CASCADE'   -- example only
pg_restore -h localhost -U postgres -d smart_erp_prod --data-only \
  --disable-triggers /tmp/smart_erp_YYYYMMDD_HHMM.dump
```

Truncating and restoring table by table across a live schema is error-prone;
unless you have a reason, dropping and restoring the whole database (steps 2–4)
is safer.

### If you import with INSERT/CSV instead of `pg_restore`

Sequences are not advanced automatically. Fix each one, e.g.:

```sql
SELECT setval(pg_get_serial_sequence('users','id'), COALESCE((SELECT max(id) FROM users), 1));
```

`pg_restore` does this for you; a manual import does not.

---

## Emptying the transactions (done once, 2026-11-24)

Before go-live the production database was stripped of every transaction and
then seeded from a physical count. Master data was kept: products, suppliers,
brands, categories, stores, regions, VAT companies, finance partners, customer
profiles, users, roles, permissions and the `inventory` rows themselves.

Repeat this only while no real document has left the building.

1. Stop the app and dump first — the dump is the only rollback:

   ```bash
   cd /Users/manavazhagan/Documents/VS-Code/1git/PetErp-Git/SmartERP-prod
   ./stop_prod.sh
   set -a; source ./.env; set +a
   pg_dump -Fc "$DATABASE_URL" -f "backups/smart_erp_prod_pre_reset_$(date +%Y%m%d_%H%M).dump"
   ```

2. Archive the generated files (`uploads/delivery-notes`, `uploads/invoices`,
   `uploads/inventory-imports`) — they are not in the dump.

3. Truncate in **one** transaction. Listing every referencing table means no
   `CASCADE` is needed; if a table is missing, Postgres refuses and the whole
   transaction rolls back instead of leaving a half-empty database:

   ```sql
   BEGIN;
   TRUNCATE TABLE
     invoice_payments, invoices,
     delivery_note_items, delivery_notes,
     sales_order_items, sales_orders,
     goods_receipt_items, goods_receipts,
     purchase_order_actions, purchase_order_items, purchase_orders,
     sales_transaction_actions, sales_transaction_items, sales_transactions,
     stock_movements,
     transfer_actions, transfer_history,
     transfer_request_items, transfer_requests,
     finance_entries, inventory_import_files
   RESTART IDENTITY;
   UPDATE inventory SET quantity = 0, updated_at = now();
   UPDATE invoice_counters SET current_number = 0, last_updated = now();
   COMMIT;
   ```

4. `./start_prod.sh` (rebuild first if code changed) and `./check_prod.sh`.

What to know before doing it again:

- Deleting an order, delivery note or invoice does **not** reverse its stock
  movement, so a row-by-row delete quietly corrupts the ledger. The block above
  clears `stock_movements` too, which is why `inventory.quantity` has to be
  zeroed in the same transaction.
- `transaction_type='BULK_IMPORT'`, `reason='adjustment'`,
  `ref_type='inventory_import'` — the vocabulary the physical-count import
  writes, and what a correct fresh ledger contains.
- `invoice_counters` was reset to `0` for **every** prefix (DC-, CI-, HI-,
  RCPT-, FIN-) on 2026-11-24. That is only defensible before the first real
  invoice reaches a customer; afterwards a reset re-issues numbers that already
  appear on tax documents.
- SO / DN / PO numbers are not counters. `server/numbering.ts` builds
  `SO-YYYYMMDD-NNNN` from the date plus a random 4-digit suffix, so the first
  order after a reset carries today's date — starting at `0001` would need a
  new counter feature, not a data fix.
- `stock_movements.ref_type` / `ref_id` have no foreign key, so orphans never
  fail loudly; they just accumulate. Truncating the table is the cheap cure.
- `customer_profiles` stores no rolled-up balances (they are derived from
  invoices), so no customer needs fixing after a reset.

Then import the count: **Inventory → Import** (`inventory-import-template.xlsx`;
columns Product SKU, Product Name, Inventory Type `DC`/`STORE`, Store, Quantity,
Location, Purchase Date, Expiry Date; 5 000-row cap, all-or-nothing
validation). Verify the ledger afterwards:

```sql
SELECT count(*), sum(quantity) FROM inventory;
SELECT sum(delta) FROM stock_movements;
```

The two sums must match and every row must be `BULK_IMPORT`.

Artifacts from the 2026-11-24 run:
`backups/smart_erp_prod_pre_reset_20261124_1942.dump`,
`archives/20261124_1942/`.

---

## Ongoing updates (after go-live)

**Prod becomes the source of truth for data.** Never restore a development dump
over the live production database — it overwrites real transactions.

Schema/code release, in this order:

1. Development: change `db/schema.ts`, run `npm run db:push` on `smart_erp`, test.
2. Development: commit and push (the production checkout only sees commits).
3. Production: `./deploy.sh`
   (stop → fetch/reset → `npm ci` → `db:push` → `build` → start).

Ordering rule for the SQL itself:

- **Additive** changes (new table/column, nullable/default) are safe before or
  after the new code.
- **Destructive** changes (drop/rename/narrow a column) must land only after the
  old code no longer reads it. The deploy stops the app, so for this app doing
  schema → build → start is fine; just do not split such a change across two
  releases.

Backups (before any import or destructive schema change, and nightly):

```bash
pg_dump -h localhost -U postgres -Fc smart_erp_prod -f /tmp/prod_$(date +%Y%m%d_%H%M).dump
```

## Production notes

- **`DATABASE_URL` precedence (this bit production once).** `server/index.ts`
  loads `dotenv/config`, and dotenv does **not** override a variable that is
  already set in the environment. If the launching shell has `DATABASE_URL`
  exported (e.g. inherited from the development terminal), the process writes to
  that database no matter what this `.env` says. `start_prod.sh` therefore
  `source`s `.env` with `set -a` before launching node, which overrides the
  shell. Verify at any time with:

  ```bash
  ps eww -p "$(cat .prod.pid)" | tr ' ' '\n' | grep '^DATABASE_URL='
  ```

  It must end in `/smart_erp_prod`. Symptom of a mismatch: edits made in the
  browser on port 5002 show up in DBeaver under `smart_erp`.
- `.env` is **untracked** (removed from the index; `.gitignore` always listed
  it), so `git reset --hard` leaves this instance's `.env` untouched.
  `deploy.sh` still keeps a copy as cheap insurance. Never commit a real
  `SESSION_SECRET` or database password again.
- `COOKIE_SECURE=false` in this `.env` keeps the session cookie working over
  plain HTTP (LAN address). Behind an HTTPS reverse proxy, remove it (or set it
  to `true`). The `COOKIE_SECURE` override lives in `server/auth.ts` and is
  committed — no separate local edit is needed in this checkout.
- The default admin credentials are weak (`admin` / `admin123`). Change the
  password right after the import.
- The login limiter allows 10 failed attempts per 15 minutes per IP; successful
  logins are not counted.
- Logs: `logs/prod.log`; pid: `.prod.pid`.

