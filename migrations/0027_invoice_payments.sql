-- 0027_invoice_payments.sql
--
-- Accounts receivable: one invoice per sale, many payment receipts per invoice.
--
-- Until now a sale was either paid or refunded: `sales_transactions.payment_method` recorded how
-- the counter money arrived, and nothing recorded how much of a VAT invoice had actually been
-- settled. A business customer who takes 10,000,000 of goods and pays 4,000,000 on delivery had
-- no document for the 6,000,000 still owed, and no report listed it.
--
-- Two tables fix that, and they separate the two facts the shop must never confuse:
--
--   `invoices`         - WHAT IS OWED. One row per issued document (a POS sale or a VAT sales
--                        order). `subtotal` / `vat_rate` / `vat_amount` / `total_amount` are a
--                        snapshot of the document and are never recomputed or edited. Only the
--                        money columns move: `amount_paid` and `balance_due` are rewritten inside
--                        the payment transaction under a row lock.
--   `invoice_payments` - WHAT WAS RECEIVED. One row per receipt, with its own number
--                        (`RCPT-YYYYMMDD-NNNN`, generated inside the same transaction so a
--                        rollback cannot burn a number). Rows are never edited or deleted - a
--                        mistake is VOIDED (`voided_at` / `voided_by_user_id` / `void_reason`) and
--                        the invoice balance is recomputed from the receipts that remain.
--
-- `status` is the DB truth: 'issued' | 'partially_paid' | 'paid' | 'cancelled'. 'overdue' is
-- DERIVED at read time from `due_date` (shared/invoice-payment.ts) because nothing writes to a
-- row merely because a date passed. 'cancelled' outranks every other status, and cancelling keeps
-- the row, the receipts and the reason so the customer's copy still matches the shop's books.
--
-- `invoice_number` is the VAT invoice number already printed for that sale/order (CI-…/HI-…), so
-- the receivable and the paper the customer holds are the same identifier. RETAIL/POS sales carry
-- the till invoice number instead.
--
-- Historical sales: `server/invoices.ts::backfillInvoices()` registers every sale made before this
-- migration as one invoice settled by one receipt (a counter sale is paid at the till), and every
-- refunded/voided sale as a cancelled invoice. It is idempotent (`NOT EXISTS` plus the unique
-- indexes below) and has a `dryRun` mode.
--
-- Reference only - `npm run db:push` is the mechanism that applies schema changes (see
-- migrations/README.md).


CREATE TABLE IF NOT EXISTS "invoices" (
  "id" SERIAL PRIMARY KEY,
  "invoice_number" VARCHAR(50) NOT NULL UNIQUE,
  -- 'VAT' (a licensed company's tax invoice) | 'RETAIL' (the shop's own receipt document)
  "kind" VARCHAR(10) NOT NULL,
  -- 'POS_SALE' | 'SALES_ORDER' - which document this receivable was created from
  "source" VARCHAR(20) NOT NULL,
  "sales_transaction_id" INTEGER REFERENCES "sales_transactions"("id"),
  "sales_order_id" INTEGER REFERENCES "sales_orders"("id"),
  "vat_company_id" INTEGER REFERENCES "vat_companies"("id"),
  "customer_profile_id" INTEGER REFERENCES "customer_profiles"("id"),
  -- Buyer name copied at issue time so the receivables list needs no join per row.
  "buyer_name" TEXT NOT NULL DEFAULT '',
  "store_id" INTEGER REFERENCES "stores"("id"),
  "issued_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  -- When the balance becomes past due. NULL = no credit term (due on issue).
  "due_date" DATE,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
  "subtotal" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  "vat_rate" DECIMAL(5, 4) NOT NULL DEFAULT 0,
  "vat_amount" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(15, 2) NOT NULL,
  "amount_paid" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  "balance_due" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  "status" VARCHAR(20) NOT NULL DEFAULT 'issued',
  "status_updated_at" TIMESTAMP DEFAULT NOW(),
  "cancelled_at" TIMESTAMP,
  "cancelled_by_user_id" INTEGER REFERENCES "users"("id"),
  "cancel_reason" TEXT,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW(),
  CONSTRAINT "invoices_amounts_non_negative"
    CHECK ("total_amount" >= 0 AND "amount_paid" >= 0 AND "balance_due" >= 0),
  CONSTRAINT "invoices_source_consistency"
    CHECK (("source" = 'POS_SALE' AND "sales_transaction_id" IS NOT NULL AND "sales_order_id" IS NULL)
        OR ("source" = 'SALES_ORDER' AND "sales_order_id" IS NOT NULL AND "sales_transaction_id" IS NULL))
);

-- One invoice per source document. Postgres treats NULLs as distinct, so the POS index only
-- constrains POS_SALE rows and the order index only SALES_ORDER rows.
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_sales_transaction_unique"
  ON "invoices" ("sales_transaction_id");
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_sales_order_unique"
  ON "invoices" ("sales_order_id");
CREATE INDEX IF NOT EXISTS "invoices_source_status_idx"
  ON "invoices" ("source", "status");
CREATE INDEX IF NOT EXISTS "invoices_issued_at_idx"
  ON "invoices" ("issued_at");
CREATE INDEX IF NOT EXISTS "invoices_due_date_idx"
  ON "invoices" ("due_date");

CREATE TABLE IF NOT EXISTS "invoice_payments" (
  "id" SERIAL PRIMARY KEY,
  "invoice_id" INTEGER NOT NULL REFERENCES "invoices"("id"),
  "receipt_number" VARCHAR(50) NOT NULL UNIQUE,
  "amount" DECIMAL(15, 2) NOT NULL,
  "payment_method" VARCHAR(20) NOT NULL,
  "paid_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Bank transfer reference / cheque number / anything the customer will quote back.
  "reference" VARCHAR(100),
  "notes" TEXT,
  "received_by_user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "store_id" INTEGER REFERENCES "stores"("id"),
  "voided_at" TIMESTAMP,
  "voided_by_user_id" INTEGER REFERENCES "users"("id"),
  "void_reason" TEXT,
  "created_at" TIMESTAMP DEFAULT NOW(),
  CONSTRAINT "invoice_payments_amount_positive" CHECK ("amount" > 0)
);

CREATE INDEX IF NOT EXISTS "invoice_payments_invoice_idx"
  ON "invoice_payments" ("invoice_id");
CREATE INDEX IF NOT EXISTS "invoice_payments_paid_at_idx"
  ON "invoice_payments" ("paid_at");

-- The `RECEIPT` sequence lives in the existing per-store counter table
-- (`invoice_counters.counter_type = 'RECEIPT'`), so it is allocated inside the payment
-- transaction like the till / DC / VAT sequences - a rolled-back payment cannot burn a number.
