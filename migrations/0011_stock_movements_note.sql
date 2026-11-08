-- Migration: Free-text note on stock movements
-- Description: Adds "stock_movements.note" so a manual adjustment can carry the human
--              explanation ("damaged in transit") next to the fixed "reason" vocabulary of
--              sale/refund/cancel/transfer_in/transfer_out/po_receipt/adjustment.
--              Used by POST /api/inventory/:id/adjust (stock adjust / stock-take).
--
-- Note: mirror of db/schema.ts "stockMovements.note". Applied by `npm run db:push`; this
-- file is the idempotent record of the change (same convention as 0005-0010).

ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "note" TEXT;
