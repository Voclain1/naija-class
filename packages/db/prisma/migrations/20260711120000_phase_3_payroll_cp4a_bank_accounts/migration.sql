-- Phase 3 / Payroll CP4a — staff bank accounts.
--
-- Creates staff_bank_accounts with FORCE RLS tenant isolation. Structurally
-- mirrors the payroll_items migration. One row per (school_id, user_id) — a
-- current-state table, not a history table (see schema.prisma header comment
-- on StaffBankAccount for the full rationale).
--
-- app_user grants: ALTER DEFAULT PRIVILEGES (slice 1 Neon setup) auto-grants
-- SELECT/INSERT/UPDATE/DELETE on every future table created by school_kit to
-- app_user — no manual GRANT needed here.
--
-- No RBAC grant statement needed here — bank-account management is gated by
-- the existing `payroll.process` permission (already granted to admin +
-- bursar since Payroll CP3), not a new permission string. Setting up WHERE a
-- staff member's salary goes is routine payroll administration, the same
-- tier as creating/approving a PayrollItem; only the actual transfer
-- (`payroll.transfer`) is the admin+owner-only money-movement act.

CREATE TABLE "staff_bank_accounts" (
  "id"                       TEXT         NOT NULL,
  "school_id"                TEXT         NOT NULL,
  "user_id"                  TEXT         NOT NULL, -- plain FK, no constraint — see schema.prisma header
  "bank_code"                TEXT         NOT NULL,
  "account_number"           TEXT         NOT NULL,
  "account_name"             TEXT         NOT NULL,
  "paystack_recipient_code"  TEXT         NOT NULL,
  "active"                   BOOLEAN      NOT NULL DEFAULT true,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,

  CONSTRAINT "staff_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- One current bank account per staff member per school.
CREATE UNIQUE INDEX "staff_bank_accounts_school_id_user_id_key"
  ON "staff_bank_accounts" ("school_id", "user_id");

ALTER TABLE "staff_bank_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_bank_accounts" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "staff_bank_accounts"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
