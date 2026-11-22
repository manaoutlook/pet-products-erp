-- 0033: a delivery note records who cancelled it and why.
--
-- `delivery_notes.status` already carried 'issued' | 'cancelled', but nothing ever wrote
-- 'cancelled' because there was no cancellation path. Cancelling a delivery note is the
-- reverse of the goods issue: its units go back into `inventory.quantity` through a
-- RETURN stock movement pointed at the note (see server/sales-order-stock.ts).
--
-- A stock increase needs a named operator and a reason, so the note keeps both on the row
-- itself (same shape as `invoices.cancelled_at / cancelled_by_user_id / cancel_reason`).
--
-- Reference only - `npm run db:push` is the mechanism that applies schema changes (see
-- migrations/README.md).

ALTER TABLE "delivery_notes"
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "cancelled_by_user_id" INTEGER REFERENCES "users" ("id"),
  ADD COLUMN IF NOT EXISTS "cancel_reason" TEXT;
