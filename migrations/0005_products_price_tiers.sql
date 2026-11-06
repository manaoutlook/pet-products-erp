-- Migration: Add optional price tiers to products
-- Description: Adds landing_price, b2b_price and b2c_price to the products table.
--              All three are nullable so existing products keep working unchanged.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "landing_price" NUMERIC(15, 2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "b2b_price" NUMERIC(15, 2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "b2c_price" NUMERIC(15, 2);
