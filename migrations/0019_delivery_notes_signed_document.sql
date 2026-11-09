-- 0019: the signed delivery note comes back as a picture.
--
-- A note leaves the warehouse unsigned: the driver hands over the printed sheet, the customer
-- signs it, and the signed copy comes back to the office. Recording that copy is what closes the
-- paperwork, so the note now stores it:
--
--   signed_document_url                    the uploaded picture (/uploads/delivery-notes/<file>)
--   signed_document_uploaded_at            when the office filed it
--   signed_document_uploaded_by_user_id    who filed it
--
-- A note without a signed document keeps showing "Awaiting signature"; uploading one shows
-- "Signed/Completed" and ticks customer_confirmed, so a reprint matches the signed sheet.
-- Existing rows keep customer_confirmed exactly as it was - nothing is back-filled, because no
-- picture exists for notes issued before this migration.

ALTER TABLE "delivery_notes" ADD COLUMN IF NOT EXISTS "signed_document_url" TEXT;
ALTER TABLE "delivery_notes" ADD COLUMN IF NOT EXISTS "signed_document_uploaded_at" TIMESTAMP;
ALTER TABLE "delivery_notes" ADD COLUMN IF NOT EXISTS "signed_document_uploaded_by_user_id" INTEGER
  REFERENCES "users"("id");
