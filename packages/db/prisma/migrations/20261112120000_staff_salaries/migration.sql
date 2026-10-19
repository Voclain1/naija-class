-- Staff salaries (2026-10-19, the owner: "when adding or inviting staff, add
-- a salary field and link it with payroll under finance").
--
-- Until now a salary lived only on each month's payroll_items row, typed in
-- fresh every month (the PayrollItem header's D2 deferred a saved salary
-- "until schools prove they want a prefill"). This is that prefill:
--
--   * staff_salaries — one current monthly gross per staff member, kobo
--     (INTEGER, CLAUDE.md's money rule). Same shape as staff_bank_accounts:
--     plain user_id, one row per (school_id, user_id), updated in place.
--     Payroll's "Run payroll" fills its gross from here; each month's row
--     still holds its own amount, so changing a salary never rewrites a
--     month already paid.
--   * invitations.pending_monthly_gross — a salary typed on the invite form,
--     held until the person accepts (no users row exists before then).
--     Accepting moves it into staff_salaries in the same transaction.
--
-- Gated by the existing payroll.process permission; no new permission and no
-- SECURITY DEFINER function (the accept path reads the invitation by id under
-- the school's own GUC, after auth_resolve_invitation_by_token_hash).
--
-- app_user grants come from ALTER DEFAULT PRIVILEGES (no GRANT needed here).

CREATE TABLE "staff_salaries" (
  "id"            TEXT         NOT NULL,
  "school_id"     TEXT         NOT NULL,
  "user_id"       TEXT         NOT NULL, -- plain FK -> users.id, as staff_bank_accounts
  "monthly_gross" INTEGER      NOT NULL, -- kobo
  "updated_by"    TEXT         NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "staff_salaries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_salaries_monthly_gross_positive" CHECK ("monthly_gross" > 0)
);

CREATE UNIQUE INDEX "staff_salaries_school_id_user_id_key"
  ON "staff_salaries" ("school_id", "user_id");

ALTER TABLE "staff_salaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_salaries" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "staff_salaries"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

ALTER TABLE "invitations" ADD COLUMN "pending_monthly_gross" INTEGER;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_pending_monthly_gross_positive"
  CHECK ("pending_monthly_gross" IS NULL OR "pending_monthly_gross" > 0);
