-- Migration: Add parent_id column for N-level subcategory support
-- Description: Adds self-referencing parent_id column to categories table

-- Add new column for parent category reference
ALTER TABLE "categories" ADD COLUMN "parent_id" INTEGER;

-- Add foreign key constraint referencing parent category
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create index for faster lookups of subcategories
CREATE INDEX "categories_parent_id_idx" ON "categories" ("parent_id");

-- Create index for faster lookups of direct parent
CREATE INDEX "categories_parent_id_idx2" ON "categories" ("parent_id");