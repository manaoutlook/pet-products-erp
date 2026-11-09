-- Migration: Sales orders and delivery notes
-- Description: Adds the outbound sales paperwork described by
--              "Sales Order and Delivery Note Forms.pdf":
--                * "sales_orders" / "sales_order_items" - the Sales Order form
--                  (order number, customer block, order date, item table, total,
--                  special instructions, prepared by);
--                * "delivery_notes" / "delivery_note_items" - the Delivery Note form
--                  (note number, related order number, delivery date, item table with
--                  ordered / delivered quantities, delivered by, customer confirmation).
--              "sales_order_items.delivered_quantity" is the running total that
--              POST /api/delivery-notes increments; the order status
--              (open / partially_delivered / delivered / cancelled) is derived from it.
--
-- Note: mirror of db/schema.ts "salesOrders", "salesOrderItems", "deliveryNotes" and
-- "deliveryNoteItems". Applied by `npm run db:push`; this file is the idempotent
-- record of the change (same convention as 0005-0014).

CREATE TABLE IF NOT EXISTS "sales_orders" (
  "id" SERIAL PRIMARY KEY,
  "order_number" VARCHAR(50) NOT NULL UNIQUE,
  "customer_profile_id" INTEGER REFERENCES "customer_profiles"("id"),
  "customer_name" TEXT NOT NULL,
  "company_name" TEXT,
  "contact_person" TEXT,
  "phone" VARCHAR(20),
  "delivery_address" TEXT,
  "order_date" TIMESTAMP NOT NULL DEFAULT NOW(),
  "total_amount" DECIMAL(15, 2) NOT NULL DEFAULT '0',
  "special_instructions" TEXT,
  "status" VARCHAR(24) NOT NULL DEFAULT 'open',
  "prepared_by_user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "sales_order_items" (
  "id" SERIAL PRIMARY KEY,
  "sales_order_id" INTEGER NOT NULL REFERENCES "sales_orders"("id") ON DELETE CASCADE,
  "product_id" INTEGER NOT NULL REFERENCES "products"("id"),
  "product_code" VARCHAR(64) NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price" DECIMAL(15, 2) NOT NULL,
  "total_price" DECIMAL(15, 2) NOT NULL,
  "delivered_quantity" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "delivery_notes" (
  "id" SERIAL PRIMARY KEY,
  "delivery_note_number" VARCHAR(50) NOT NULL UNIQUE,
  "sales_order_id" INTEGER NOT NULL REFERENCES "sales_orders"("id"),
  "delivery_date" TIMESTAMP NOT NULL DEFAULT NOW(),
  "customer_name" TEXT NOT NULL,
  "company_name" TEXT,
  "contact_person" TEXT,
  "phone" VARCHAR(20),
  "delivery_address" TEXT,
  "delivered_by_user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "customer_confirmed" BOOLEAN NOT NULL DEFAULT FALSE,
  "remarks" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'issued',
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "delivery_note_items" (
  "id" SERIAL PRIMARY KEY,
  "delivery_note_id" INTEGER NOT NULL REFERENCES "delivery_notes"("id") ON DELETE CASCADE,
  "sales_order_item_id" INTEGER NOT NULL REFERENCES "sales_order_items"("id") ON DELETE CASCADE,
  "product_code" VARCHAR(64) NOT NULL,
  "description" TEXT NOT NULL,
  "ordered_quantity" INTEGER NOT NULL,
  "delivered_quantity" INTEGER NOT NULL,
  "remarks" TEXT,
  "created_at" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_sales_orders_status" ON "sales_orders" ("status");
CREATE INDEX IF NOT EXISTS "idx_sales_order_items_order" ON "sales_order_items" ("sales_order_id");
CREATE INDEX IF NOT EXISTS "idx_delivery_notes_order" ON "delivery_notes" ("sales_order_id");
CREATE INDEX IF NOT EXISTS "idx_delivery_note_items_note" ON "delivery_note_items" ("delivery_note_id");
