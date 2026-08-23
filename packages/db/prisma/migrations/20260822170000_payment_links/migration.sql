-- Durable Paystack Payment Requests for admin-shared invoice links.
-- Money remains INTEGER kobo. The table carries a flat school_id and FORCE
-- RLS; request/customer identifiers are opaque Paystack ids, never PII.
CREATE TYPE "PaymentLinkStatus" AS ENUM (
  'CREATING', 'LIVE', 'PAID', 'ARCHIVE_PENDING', 'ARCHIVED', 'CREATE_FAILED'
);

CREATE TABLE "payment_links" (
  "id" TEXT NOT NULL,
  "school_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "request_id" BIGINT,
  "request_code" TEXT,
  "hosted_url" TEXT,
  "paystack_customer_code" TEXT,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "status" "PaymentLinkStatus" NOT NULL DEFAULT 'CREATING',
  "created_by" TEXT NOT NULL,
  "failure_code" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "archived_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_links_invoice_id_fkey" FOREIGN KEY ("invoice_id")
    REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payment_links_request_code_key"
  ON "payment_links"("request_code");
CREATE INDEX "payment_links_school_id_invoice_id_status_idx"
  ON "payment_links"("school_id", "invoice_id", "status");
-- CREATING reserves the slot before any external call. This is stronger than
-- merely one LIVE row: concurrent clicks cannot mint two remote requests.
CREATE UNIQUE INDEX "payment_links_one_active_per_invoice_key"
  ON "payment_links"("school_id", "invoice_id")
  WHERE "status" IN ('CREATING', 'LIVE');

ALTER TABLE "payment_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payment_links"
  USING (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
