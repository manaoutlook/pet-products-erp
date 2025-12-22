-- Migration: Remove roleTypes table and add isSystemAdmin to roles
-- Step 1: Add the new isSystemAdmin column to roles table
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system_admin BOOLEAN NOT NULL DEFAULT false;

-- Step 2: Update existing admin role to have isSystemAdmin = true
UPDATE roles SET is_system_admin = true WHERE name = 'admin';

-- Step 3: Drop the foreign key constraint and the roleTypeId column
ALTER TABLE roles DROP COLUMN IF EXISTS role_type_id;

-- Step 4: Drop the roleTypes table
DROP TABLE IF EXISTS role_types CASCADE;
