-- Phase 3 / Payroll CP3 — payroll run without money movement.
--
-- Creates payroll_items with FORCE RLS tenant isolation. Structurally mirrors
-- the slice-13 expenses migration. PAID/FAILED statuses and
-- paystack_transfer_code are reserved for CP4 (Paystack transfers) — this
-- migration only exercises DRAFT -> APPROVED.
--
-- app_user grants: ALTER DEFAULT PRIVILEGES (slice 1 Neon setup) auto-grants
-- SELECT/INSERT/UPDATE/DELETE on every future table created by school_kit to
-- app_user — no manual GRANT needed here.

CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'FAILED');

CREATE TABLE "payroll_items" (
  "id"                     TEXT            NOT NULL,
  "school_id"              TEXT            NOT NULL,
  "user_id"                TEXT            NOT NULL, -- plain FK, no constraint — see schema.prisma header
  "period"                 TEXT            NOT NULL,
  "gross_salary"           INTEGER         NOT NULL,
  "deductions"             JSONB           NOT NULL,
  "net_salary"             INTEGER         NOT NULL,
  "status"                 "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
  "payslip_url"            TEXT,
  "approved_by"            TEXT,
  "approved_at"            TIMESTAMP(3),
  "paystack_transfer_code" TEXT,
  "created_by"             TEXT            NOT NULL,
  "created_at"             TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3)    NOT NULL,

  CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- One payroll item per staff member per period.
CREATE UNIQUE INDEX "payroll_items_school_id_user_id_period_key"
  ON "payroll_items" ("school_id", "user_id", "period");

CREATE INDEX "payroll_items_school_id_period_idx"
  ON "payroll_items" ("school_id", "period");

CREATE INDEX "payroll_items_school_id_user_id_idx"
  ON "payroll_items" ("school_id", "user_id");

ALTER TABLE "payroll_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_items" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "payroll_items"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- ─────────────────────────────────────────────────────────────────────────────
-- RBAC: payroll.read/process/transfer
-- ─────────────────────────────────────────────────────────────────────────────
--
-- admin gets all three (no owner-only restriction on read/process; transfer
-- is high-trust but admin+owner already share that tier — see
-- PHASE_3_OWNER_ONLY_PERMISSIONS, which payroll.transfer is NOT part of).
-- bursar gets read/process only — payroll.transfer excluded, mirroring the
-- payment.refund / staff-bvn.reveal exclusion pattern from slice 11/12.
-- Idempotent: NOT ... @> guards prevent duplicate JSON entries.

UPDATE "roles"
SET "permissions" = "permissions" || '["payroll.read","payroll.process","payroll.transfer"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["payroll.read"]'::jsonb);

UPDATE "roles"
SET "permissions" = "permissions" || '["payroll.read","payroll.process"]'::jsonb
WHERE "key" = 'bursar'
  AND "is_system" = true
  AND NOT ("permissions" @> '["payroll.read"]'::jsonb);
