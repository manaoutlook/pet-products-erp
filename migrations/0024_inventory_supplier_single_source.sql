-- Migration: Inventory supplier is derived from the product
-- Description: `products.supplier_id` is the single source of truth for which supplier a
--              product comes from. `inventory.supplier_id` is a denormalised copy used for
--              display only and must always equal the supplier of the row's product.
--
--              Nothing in the application may set inventory.supplier_id independently
--              (see POST/PUT /api/inventory, the inventory import, goods receipt and the
--              product update cascade). This statement repairs rows written before that
--              rule existed - the placeholder "SmartLife1" supplier was copied onto every
--              stock row regardless of the product.
--
-- Note: mirror of db/schema.ts. Applied by `npm run db:push`; this file is the idempotent
-- record of the data change (same convention as 0005-0023). Application-level enforcement
-- lives in server/routes.ts and server/inventory-import.ts because this project keeps no
-- triggers or stored procedures (db/index.ts).

UPDATE "inventory" i
SET "supplier_id" = p."supplier_id",
    "updated_at" = NOW()
FROM "products" p
WHERE p."id" = i."product_id"
  AND i."supplier_id" IS DISTINCT FROM p."supplier_id";

-- Placeholder suppliers that no product, stock row or purchase order references are now
-- safe to remove. Run manually after checking the report:
--   npx tsx scripts/supplier-reconcile.ts
--   DELETE FROM "suppliers" WHERE "id" = 15;
