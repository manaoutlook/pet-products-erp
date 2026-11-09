# Migrations

**`npm run db:push` (`drizzle-kit push`) is the single mechanism that creates and updates
the schema.** It compares `db/schema.ts` with the database and applies the difference,
in development and in CI (`tests/global-setup.ts` runs it before the suites).

## Why there is no Drizzle journal here

`meta/_journal.json` listed only `0000`–`0003` while twelve `.sql` files exist, so
`migrate()` — drizzle's runner, which iterates the journal — applied the first four files
and **silently skipped `0004`–`0011`** (product dimensions and weight, price tiers,
`stock_movements`, `user_sessions`, …). A fresh database set up with `migrate()` was
missing columns that the application writes, and nothing failed loudly.

The journal (and its two stale snapshots) has been removed rather than back-filled: the
snapshots no longer match `db/schema.ts`, `0002` is duplicated by two unrelated files
(`0002_aberrant_ulik.sql`, `0002_inter_store_transfers.sql`), and `drizzle-kit generate`
hangs trying to reconcile the drift. Regenerating a correct history is a separate, larger
job; until then the `.sql` files below are kept as **reference only** — they document how
each change was made, and several are hand-written rather than generated.

## What that means in practice

- New environments: `npm run db:push` (or start the test suite, which pushes for you).
- Changing the schema: edit `db/schema.ts`, then `npm run db:push`.
- Do not run `drizzle-kit migrate`/`generate` against this repository until the history is
  rebuilt; without a journal they cannot represent the current schema.

## The files

| File | Change |
| --- | --- |
| `0000_thankful_wendell_vaughn.sql` | initial generated schema |
| `0001_pos_system_tables.sql` | POS / sales transaction tables |
| `0002_aberrant_ulik.sql` | generated follow-up |
| `0002_inter_store_transfers.sql` | transfer requests, approvals, history |
| `0003_hrbac_schema.sql` | hierarchical roles and permissions |
| `0004_categories_parent_id.sql` | category tree |
| `0005_products_price_tiers.sql` | tiered pricing |
| `0006_products_supplier_id.sql` | product → supplier link |
| `0007_products_dimensions.sql` | packaging dimensions |
| `0008_products_weight_kg.sql` | shipping weight |
| `0009_user_sessions.sql` | Postgres-backed session store |
| `0010_stock_movements.sql` | stock ledger |
| `0011_stock_movements_note.sql` | free-text note on a stock movement |
| `0012_goods_receipts.sql` | goods receipts (GRN): actual delivery date + import costs, and `purchase_order_items.landed_cost_per_unit` |
| `0013_goods_receipt_items.sql` | goods receipt lines: what each receipt covered (partial / multi-shipment deliveries) |
| `0014_products_images.sql` | product pictures: `products.image_url` (featured, shown in the grid) + `products.gallery_images` (up to ten extra picture URLs) |
| `0015_sales_orders_delivery_notes.sql` | sales orders + delivery notes: `sales_orders`, `sales_order_items`, `delivery_notes`, `delivery_note_items` |
| `0016_customer_profiles_customer_type.sql` | customer profiles describe the account, not a pet: `phone_number` → `mobile_number`, `pet_type` → `customer_type` (`B2B` / `B2C`, enforced by a `CHECK`), `pet_birthday` (date) → `land_line_number` (varchar) |
| `0017_normalize_customer_phone_numbers.sql` | strips the separators the legacy rows carried from `customer_profiles.mobile_number` / `land_line_number` (`+84-930-123-456` → `+84930123456`), so a seeded profile can be saved from the edit form |
