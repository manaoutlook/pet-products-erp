-- 0037: website stock sync (WooCommerce).
--
-- The ERP owns stock; www.smartlife-vn.com and b2b.smartlife-vn.com receive it. Five tables:
--
--   website_channels          one shop: address, encrypted API key, sync rules
--   website_product_links     sku <-> WooCommerce id, per shop (a push is driven by this table)
--   website_stock_sync_runs   one row per "Sync now", with the counts
--   website_stock_sync_items  one row per product in that run, including the site's own error
--   website_stock_state       the last quantity each shop accepted, so a delta run only sends
--                             what changed and a refused line is retried
--
-- Same "reference only" rule as the other files here (see migrations/README.md): `db:push` owns
-- the schema, this file documents the change and does the backfill push cannot do. Every
-- statement is idempotent, so re-running it is a no-op.

CREATE TABLE IF NOT EXISTS "website_channels" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "base_url" text NOT NULL UNIQUE,
  "consumer_key_enc" text NOT NULL,
  "consumer_secret_enc" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "stock_scope" text NOT NULL DEFAULT 'ALL',
  "clamp_negative" boolean NOT NULL DEFAULT true,
  "allow_backorders" boolean NOT NULL DEFAULT false,
  "force_manage_stock" boolean NOT NULL DEFAULT false,
  "sync_interval_minutes" integer NOT NULL DEFAULT 0,
  "last_sync_at" timestamp,
  "last_sync_status" text,
  "last_sync_message" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

ALTER TABLE "website_channels" DROP CONSTRAINT IF EXISTS "website_channels_stock_scope_check";
ALTER TABLE "website_channels"
  ADD CONSTRAINT "website_channels_stock_scope_check"
  CHECK ("stock_scope" IN ('ALL', 'DC', 'STORES'));

CREATE TABLE IF NOT EXISTS "website_product_links" (
  "id" serial PRIMARY KEY,
  "channel_id" integer NOT NULL REFERENCES "website_channels"("id") ON DELETE CASCADE,
  "product_id" integer NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "woo_id" integer NOT NULL,
  "woo_type" text NOT NULL DEFAULT 'simple',
  "woo_parent_id" integer,
  "sku" text NOT NULL,
  "sync_enabled" boolean NOT NULL DEFAULT true,
  "woo_manage_stock" boolean NOT NULL DEFAULT false,
  "woo_stock_quantity" integer,
  "woo_stock_status" text,
  "matched_by" text NOT NULL DEFAULT 'sku',
  "last_seen_at" timestamp DEFAULT now(),
  "created_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "website_product_links_channel_product_idx"
  ON "website_product_links" ("channel_id", "product_id");
CREATE UNIQUE INDEX IF NOT EXISTS "website_product_links_channel_woo_idx"
  ON "website_product_links" ("channel_id", "woo_id", "woo_type");

CREATE TABLE IF NOT EXISTS "website_stock_sync_runs" (
  "id" serial PRIMARY KEY,
  "channel_id" integer NOT NULL REFERENCES "website_channels"("id") ON DELETE CASCADE,
  "trigger" text NOT NULL DEFAULT 'manual',
  "mode" text NOT NULL DEFAULT 'changed',
  "status" text NOT NULL DEFAULT 'running',
  "total_items" integer NOT NULL DEFAULT 0,
  "changed_items" integer NOT NULL DEFAULT 0,
  "succeeded" integer NOT NULL DEFAULT 0,
  "failed" integer NOT NULL DEFAULT 0,
  "skipped" integer NOT NULL DEFAULT 0,
  "message" text,
  "started_at" timestamp DEFAULT now(),
  "finished_at" timestamp,
  "triggered_by_user_id" integer REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "website_stock_sync_runs_channel_idx"
  ON "website_stock_sync_runs" ("channel_id", "started_at");

CREATE TABLE IF NOT EXISTS "website_stock_sync_items" (
  "id" serial PRIMARY KEY,
  "run_id" integer NOT NULL REFERENCES "website_stock_sync_runs"("id") ON DELETE CASCADE,
  "product_id" integer REFERENCES "products"("id") ON DELETE SET NULL,
  "sku" text NOT NULL,
  "woo_id" integer,
  "woo_type" text NOT NULL DEFAULT 'simple',
  "quantity_sent" integer,
  "woo_quantity_before" integer,
  "woo_quantity_after" integer,
  "status" text NOT NULL DEFAULT 'success',
  "http_status" integer,
  "message" text,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "website_stock_sync_items_run_idx"
  ON "website_stock_sync_items" ("run_id");

CREATE TABLE IF NOT EXISTS "website_stock_state" (
  "channel_id" integer NOT NULL REFERENCES "website_channels"("id") ON DELETE CASCADE,
  "product_id" integer NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "last_synced_quantity" integer NOT NULL,
  "last_synced_stock_status" text,
  "last_synced_at" timestamp DEFAULT now(),
  PRIMARY KEY ("channel_id", "product_id")
);

-- Backfill the permission module for roles that already exist.
--
-- `db:push` adds the tables but cannot know that existing roles need the new grant: without this,
-- every non-admin role would open the screen to a 403. The default is read-only - a run writes to
-- a live shop, so write access stays an explicit decision. Full access goes to the administrator
-- roles only, which is what a fresh database gets from `setupAdmin()` in server/auth.ts.
UPDATE "roles"
SET "permissions" = "permissions" || '{"websiteSync": {"create": false, "read": true, "update": false, "delete": false}}'::jsonb
WHERE "permissions" ? 'inventory'
  AND NOT ("permissions" ? 'websiteSync');

UPDATE "roles"
SET "permissions" = "permissions" || '{"websiteSync": {"create": true, "read": true, "update": true, "delete": true}}'::jsonb
WHERE ("is_system_admin" = true OR "hierarchy_level" = 'admin' OR "name" = 'admin')
  AND NOT ("permissions" @> '{"websiteSync": {"create": true, "read": true, "update": true, "delete": true}}'::jsonb);
