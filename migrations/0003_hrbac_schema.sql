-- Migration: HRBAC (Hierarchical Role-Based Access Control) Schema Changes
-- Description: Adds hierarchical permissions and regional management

-- Add hierarchy_level column to roles table
ALTER TABLE roles ADD COLUMN hierarchy_level TEXT NOT NULL DEFAULT 'staff';

-- Create regions table
CREATE TABLE regions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  manager_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add region_id column to stores table
ALTER TABLE stores ADD COLUMN region_id INTEGER REFERENCES regions(id);

-- Update existing roles with appropriate hierarchy levels
UPDATE roles SET hierarchy_level = 'admin' WHERE name = 'admin';
UPDATE roles SET hierarchy_level = 'global_manager' WHERE name = 'manager';
UPDATE roles SET hierarchy_level = 'staff' WHERE name = 'staff' OR name = 'cashier';

-- Create index for better performance
CREATE INDEX idx_regions_manager_user_id ON regions(manager_user_id);
CREATE INDEX idx_stores_region_id ON stores(region_id);
CREATE INDEX idx_roles_hierarchy_level ON roles(hierarchy_level);
