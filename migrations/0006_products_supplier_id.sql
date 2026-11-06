-- Migration: Add an optional supplier to products
-- Description: Adds supplier_id to the products table so a product can be linked
--              to the supplier it is purchased from. Nullable so existing
--              products keep working unchanged.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "supplier_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_supplier_id_suppliers_id_fk'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_supplier_id_suppliers_id_fk"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id");
  END IF;
END $$;
