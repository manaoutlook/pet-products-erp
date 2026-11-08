-- Migration: Add physical weight and dimensions to products
-- Description: Adds weight (in grams) and length/width/height (in centimetres)
--              to the products table. All four are nullable so existing
--              products keep working unchanged.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight_grams" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "length_cm" NUMERIC(10, 2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "width_cm" NUMERIC(10, 2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "height_cm" NUMERIC(10, 2);
