-- Branded receipts, D3 (docs/modules/branded-receipts.md): sequential receipt
-- numbers per school per calendar year (RCP/2026/000123).
--
-- Additive only: one new table. Existing payments keep their old
-- RCP-XXXXXXXX numbers; only receipts issued after this ships are sequential.
--
-- The counter is advanced by one atomic INSERT ... ON CONFLICT DO UPDATE ...
-- RETURNING inside the payment's own transaction, so:
--   - two concurrent payments can never draw the same number (the row lock),
--   - a payment that rolls back returns its number (no gap from a failure).

-- CreateTable
CREATE TABLE "receipt_sequences" (
    "school_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_sequences_pkey" PRIMARY KEY ("school_id","year")
);

-- A counter never goes backwards or below 1.
ALTER TABLE "receipt_sequences" ADD CONSTRAINT "receipt_sequences_last_number_positive" CHECK ("last_number" >= 1);

-- Tenant isolation — same discipline as every tenant table: ENABLE + FORCE,
-- WITH CHECK so a buggy service cannot write another school's counter.
ALTER TABLE "receipt_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipt_sequences" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON receipt_sequences
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

GRANT SELECT, INSERT, UPDATE ON "receipt_sequences" TO app_user;
