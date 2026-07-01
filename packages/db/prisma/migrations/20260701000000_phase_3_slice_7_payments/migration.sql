-- Phase 3 / Slice 7 — Manual payment recording + receipts
--
-- Creates PaymentMethod + PaymentStatus enums and the payments table.
--
-- status DEFAULT 'SUCCESS': manual payments are confirmed-in-hand at record time.
-- PENDING is reserved for the Paystack async initiation path (slice 8), which
-- sets status explicitly. See docs/modules/phase-3.md §16 D3.
--
-- The @@unique([school_id, paystack_reference]) in schema.prisma is implemented
-- here as a PARTIAL unique index (WHERE paystack_reference IS NOT NULL). Postgres
-- excludes NULL rows from partial unique indexes, so manual payment rows
-- (paystack_reference = NULL) can coexist without violating the constraint.
-- Prisma's ORM layer sees a regular @@unique and uses it for client-side type
-- narrowing; the DB enforces the partial variant.
--
-- Money column (amount) is INTEGER (kobo) — never FLOAT. CLAUDE.md money hard rule.
--
-- FK to invoices uses RESTRICT: a payment row blocks invoice deletion (invoices
-- are never hard-deleted in practice, but the guard is belt-and-suspenders).
--
-- app_user grants: ALTER DEFAULT PRIVILEGES (set up in slice 1 / Neon setup)
-- auto-grants SELECT/INSERT/UPDATE/DELETE on every future table created by
-- school_kit to app_user — no manual GRANT needed (same pattern as slices 4/5/6).

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "PaymentMethod" AS ENUM ('PAYSTACK', 'CASH', 'POS', 'BANK_TRANSFER');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED');

-- ─────────────────────────────────────────────────────────────────────────────
-- payments
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "payments" (
    "id"                  TEXT              NOT NULL,
    "school_id"           TEXT              NOT NULL,
    "invoice_id"          TEXT              NOT NULL,
    "student_id"          TEXT              NOT NULL,
    "amount"              INTEGER           NOT NULL,
    "method"              "PaymentMethod"   NOT NULL,
    "status"              "PaymentStatus"   NOT NULL DEFAULT 'SUCCESS',
    "paystack_reference"  TEXT,
    "paystack_data"       JSONB,
    "reference"           TEXT,
    "receipt_number"      TEXT,
    "receipt_url"         TEXT,
    "recorded_by"         TEXT,
    "paid_at"             TIMESTAMP(3),
    "created_at"          TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)      NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id")
        REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Partial unique: Postgres excludes NULL rows so manual payments coexist safely.
CREATE UNIQUE INDEX "payments_school_id_paystack_reference_key"
    ON "payments"("school_id", "paystack_reference")
    WHERE "paystack_reference" IS NOT NULL;

CREATE INDEX "payments_school_id_invoice_id_idx" ON "payments"("school_id", "invoice_id");
CREATE INDEX "payments_school_id_student_id_idx" ON "payments"("school_id", "student_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — tenant isolation
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "payments"
    USING      (school_id::text = current_setting('app.current_school_id', true))
    WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
