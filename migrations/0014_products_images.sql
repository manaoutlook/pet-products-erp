-- Migration: Product pictures (one featured image + up to ten gallery images)
-- Description: Adds "image_url" (the featured picture shown in the product grid)
--              and "gallery_images" (a JSON array of up to 10 extra picture URLs).
--              Both store short /uploads/products/... URLs written by
--              POST /api/products/images, never base64 payloads.
--
-- Note: mirror of db/schema.ts "products". Applied by `npm run db:push`; this file
-- is the idempotent record of the change (same convention as 0005-0013).
-- Both columns are safe for existing rows: image_url is nullable and
-- gallery_images defaults to an empty array.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "image_url" TEXT;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "gallery_images" JSONB NOT NULL DEFAULT '[]'::jsonb;
