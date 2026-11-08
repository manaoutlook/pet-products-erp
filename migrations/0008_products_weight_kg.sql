-- Migration: Store the product weight in kilograms instead of grams
-- Description: Replaces the whole-gram "weight_grams" INTEGER column with a
--              decimal "weight_kg" NUMERIC(10, 3) column so sub-kilo weights
--              (350 g = 0.35 kg) can be recorded. Existing gram values are
--              converted in place; the column stays nullable.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'weight_grams'
  ) THEN
    ALTER TABLE "products" RENAME COLUMN "weight_grams" TO "weight_kg";
    ALTER TABLE "products"
      ALTER COLUMN "weight_kg" TYPE NUMERIC(10, 3)
      USING (ROUND("weight_kg" / 1000.0, 3));
  END IF;
END $$;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight_kg" NUMERIC(10, 3);
