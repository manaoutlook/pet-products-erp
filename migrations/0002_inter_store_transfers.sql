-- Inter-Store Inventory Transfer System Migration
-- Adds tables for transfer requests, approvals, and history tracking

-- Transfer Requests table
CREATE TABLE transfer_requests (
  id SERIAL PRIMARY KEY,
  transfer_number VARCHAR(50) UNIQUE NOT NULL,
  from_store_id INTEGER REFERENCES stores(id),
  to_store_id INTEGER REFERENCES stores(id),
  requested_by_user_id INTEGER REFERENCES users(id) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
  priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  notes TEXT,
  requested_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Transfer Request Items table
CREATE TABLE transfer_request_items (
  id SERIAL PRIMARY KEY,
  transfer_request_id INTEGER REFERENCES transfer_requests(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) NOT NULL,
  requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
  approved_quantity INTEGER,
  transferred_quantity INTEGER DEFAULT 0 CHECK (transferred_quantity >= 0),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Transfer Actions table (approval/rejection history)
CREATE TABLE transfer_actions (
  id SERIAL PRIMARY KEY,
  transfer_request_id INTEGER REFERENCES transfer_requests(id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL CHECK (action_type IN ('created', 'approved', 'rejected', 'cancelled', 'completed', 'modified')),
  action_data JSONB, -- Store notes, quantities, rejection reasons, etc.
  performed_by_user_id INTEGER REFERENCES users(id) NOT NULL,
  performed_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Transfer History table (completed transfers audit trail)
CREATE TABLE transfer_history (
  id SERIAL PRIMARY KEY,
  transfer_request_id INTEGER REFERENCES transfer_requests(id) ON DELETE CASCADE,
  from_inventory_id INTEGER REFERENCES inventory(id),
  to_inventory_id INTEGER REFERENCES inventory(id),
  product_id INTEGER REFERENCES products(id) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  transferred_at TIMESTAMP DEFAULT NOW(),
  transferred_by_user_id INTEGER REFERENCES users(id) NOT NULL,
  notes TEXT
);

-- Indexes for performance
CREATE INDEX idx_transfer_requests_status ON transfer_requests(status);
CREATE INDEX idx_transfer_requests_from_store ON transfer_requests(from_store_id);
CREATE INDEX idx_transfer_requests_to_store ON transfer_requests(to_store_id);
CREATE INDEX idx_transfer_requests_requested_by ON transfer_requests(requested_by_user_id);
CREATE INDEX idx_transfer_requests_created_at ON transfer_requests(created_at DESC);

CREATE INDEX idx_transfer_request_items_transfer_id ON transfer_request_items(transfer_request_id);
CREATE INDEX idx_transfer_request_items_product_id ON transfer_request_items(product_id);

CREATE INDEX idx_transfer_actions_transfer_id ON transfer_actions(transfer_request_id);
CREATE INDEX idx_transfer_actions_performed_at ON transfer_actions(performed_at DESC);

CREATE INDEX idx_transfer_history_transfer_request_id ON transfer_history(transfer_request_id);
CREATE INDEX idx_transfer_history_product_id ON transfer_history(product_id);
CREATE INDEX idx_transfer_history_transferred_at ON transfer_history(transferred_at DESC);
