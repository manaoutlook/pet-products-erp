-- 0034: retire the VAT invoice service fee setting.
--
-- The VAT Margin Calculator no longer charges an invoice-issuing fee to the VAT company: the
-- sales value now splits only into payback to SmartLife (N) and the VAT company's profit plus
-- income tax (K + L). `vat_margin.default_service_fee_rate`, created by
-- 0029_vat_margin_settings.sql, is never read again, so drop the stale row instead of leaving a
-- value behind that looks like it still applies.
--
-- The calculation itself lives in shared/vat-margin.ts (no M column) and
-- server/vat-margin-settings.ts no longer lists the key.
--
-- Reference only - `npm run db:push` is the mechanism that applies schema changes (see
-- migrations/README.md).

DELETE FROM "app_settings"
WHERE "key" = 'vat_margin.default_service_fee_rate';