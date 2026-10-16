-- Phase 9 / CP5.1 — Student charges (F2) and supplementary invoices
-- (docs/modules/phase-9.md §13, approved 2026-10-16).
--
-- A student charge is one amount owed by one student for one term: transport,
-- a library fine, hostel, or an OTHER charge the bursar adds by hand. It is
-- OPEN until an invoice carries it (BILLED, invoice_id set in the same
-- transaction that creates the invoice), or VOID with a reason. Only an OPEN
-- charge can be voided. Written only by StudentChargeService.
--
-- Invoices gain a sequence: 0 is the TERM invoice (every existing row), and
-- 1, 2, … are SUPPLEMENTARY invoices, which carry charges raised after the term
-- invoice was issued. The one-invoice-per-term rule becomes one TERM invoice
-- per student per term: the unique key gains the sequence column.
--
-- Tenant data, RLS forced. No SECURITY DEFINER function; the count stays 23.

-- Invoices: the sequence and the widened unique key.
ALTER TABLE "invoices" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sequence_check" CHECK ("sequence" >= 0);
DROP INDEX "invoices_school_id_student_id_term_id_key";
CREATE UNIQUE INDEX "invoices_school_id_student_id_term_id_sequence_key"
  ON "invoices"("school_id", "student_id", "term_id", "sequence");

-- CreateEnum
CREATE TYPE "StudentChargeKind" AS ENUM ('TRANSPORT', 'LIBRARY_FINE', 'HOSTEL', 'OTHER');
CREATE TYPE "StudentChargeStatus" AS ENUM ('OPEN', 'BILLED', 'VOID');

-- CreateTable
CREATE TABLE "student_charges" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "kind" "StudentChargeKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "StudentChargeStatus" NOT NULL DEFAULT 'OPEN',
    "source_module" TEXT,
    "source_id" TEXT,
    "invoice_id" TEXT,
    "void_reason" TEXT,
    "voided_by" TEXT,
    "voided_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_charges_pkey" PRIMARY KEY ("id"),
    -- ₦0.01 to ₦10,000,000.
    CONSTRAINT "student_charges_amount" CHECK ("amount" > 0 AND "amount" <= 1000000000),
    CONSTRAINT "student_charges_description_length" CHECK (char_length("description") BETWEEN 1 AND 200),
    CONSTRAINT "student_charges_source_pair" CHECK (("source_module" IS NULL) = ("source_id" IS NULL)),
    -- BILLED exactly when an invoice carries it.
    CONSTRAINT "student_charges_billed" CHECK (("status" = 'BILLED') = ("invoice_id" IS NOT NULL)),
    -- VOID exactly when a reason, a person and a time are recorded.
    CONSTRAINT "student_charges_void" CHECK (
      ("status" = 'VOID') = ("void_reason" IS NOT NULL AND "voided_at" IS NOT NULL)
    ),
    CONSTRAINT "student_charges_void_reason_length" CHECK ("void_reason" IS NULL OR char_length("void_reason") BETWEEN 1 AND 500)
);

-- CreateIndex
CREATE INDEX "student_charges_school_id_term_id_status_idx" ON "student_charges"("school_id", "term_id", "status");
CREATE INDEX "student_charges_school_id_student_id_term_id_idx" ON "student_charges"("school_id", "student_id", "term_id");
CREATE INDEX "student_charges_invoice_id_idx" ON "student_charges"("invoice_id");
-- At most one live charge per source record (a transport assignment raises one
-- charge for its term). A voided charge frees the slot.
CREATE UNIQUE INDEX "student_charges_one_live_per_source"
  ON "student_charges"("school_id", "source_module", "source_id")
  WHERE "source_id" IS NOT NULL AND "status" <> 'VOID';

-- AddForeignKey
ALTER TABLE "student_charges" ADD CONSTRAINT "student_charges_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation, as on every tenant table.
ALTER TABLE "student_charges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_charges" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON student_charges
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "student_charges" TO app_user;

-- The three permissions (CP5-D6): admin and bursar. Owner holds "*". Teachers
-- get none. Idempotent, as earlier appends are.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["charge.read","charge.raise","charge.void"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" IN ('admin', 'bursar') AND "is_system" = true;
