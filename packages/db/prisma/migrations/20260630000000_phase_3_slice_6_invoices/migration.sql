-- Phase 3 / Slice 6 — Invoice generation (snapshot-on-issue)
--
-- Creates the invoices table. Snapshot semantics: the `items` JSONB column
-- freezes fee amounts + applied discounts at the moment the invoice is issued.
-- Subsequent edits to FeeItem or DiscountRule do not affect issued invoices.
--
-- @@unique([school_id, student_id, term_id]) enforces one invoice per student
-- per term. Cancelled invoices hold the slot.
--
-- app_user grants: ALTER DEFAULT PRIVILEGES (set up in slice 1 Neon setup)
-- auto-grants SELECT/INSERT/UPDATE/DELETE on every future table created by
-- school_kit to app_user — no manual GRANT needed (same pattern as slices 4/5).

-- ─────────────────────────────────────────────────────────────────────────────
-- Enum
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "InvoiceStatus" AS ENUM (
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
  'REFUNDED'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- invoices
-- ─────────────────────────────────────────────────────────────────────────────
--
-- All FK columns (student_id, term_id, academic_year_id) follow the plain-FK
-- convention — validated at the service layer via withTenant, not enforced at
-- the DB layer. This avoids cross-module FK fragility.
--
-- Money columns (total_amount, total_discount, total_due, total_paid) are
-- INTEGER (kobo) — never FLOAT. CLAUDE.md money hard rule.
--
-- items JSONB shape:
--   [{ feeItemId, categoryName, feeName, amount, discountsApplied: [{ ruleId, ruleName, discountAmount }], netAmount }]
--
-- total_paid starts at 0; updated by the slice 7 payment service.

CREATE TABLE "invoices" (
  "id"               TEXT              NOT NULL,
  "school_id"        TEXT              NOT NULL,
  "student_id"       TEXT              NOT NULL,
  "term_id"          TEXT              NOT NULL,
  "academic_year_id" TEXT              NOT NULL,
  "status"           "InvoiceStatus"   NOT NULL DEFAULT 'ISSUED',
  "items"            JSONB             NOT NULL,
  "total_amount"     INTEGER           NOT NULL,
  "total_discount"   INTEGER           NOT NULL,
  "total_due"        INTEGER           NOT NULL,
  "total_paid"       INTEGER           NOT NULL DEFAULT 0,
  "due_date"         DATE,
  "issued_at"        TIMESTAMP(3),
  "issued_by"        TEXT,
  "created_at"       TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3)      NOT NULL,

  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- One invoice per student per term (within a school).
CREATE UNIQUE INDEX "invoices_school_id_student_id_term_id_key"
  ON "invoices" ("school_id", "student_id", "term_id");

-- Fast filtering by status (ISSUED debtors list, PAID reconciliation, etc.).
CREATE INDEX "invoices_school_id_status_idx"
  ON "invoices" ("school_id", "status");

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — tenant isolation
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "invoices"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
