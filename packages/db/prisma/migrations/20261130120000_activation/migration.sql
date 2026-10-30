-- Getting started (2026-10-30, docs/modules/activation.md).
--
-- 1. schools.setup_emails_stopped_at: the owner pressed "Stop these emails"
--    in a setup reminder. schools has no RLS.
-- 2. activation_emails: one row per setup reminder sent to a school's owner
--    (at most three per school: FIRST, SECOND, THIRD), with what happened to
--    it: Resend's delivered / bounced / complained, and our own click count
--    (each link goes through the API and is counted before it redirects).
--    stage_at_send is the school's stage when the email went, so the
--    platform admin can show whether the school moved on afterwards.
--    Tenant-scoped under FORCE RLS like every school table; the platform
--    admin reads it school by school under each school's own GUC, so no
--    SECURITY DEFINER function is needed and the count stays 23.
-- 3. The setup-call page opens again, once, for schools that finished setup
--    with fewer than 5 students and no booking. The count reads students,
--    which is under FORCE RLS: only a role that bypasses RLS (school_kit on
--    the VPS) sees them. Anywhere else the count would read 0 for every
--    school and reopen the page for all of them, so the update is skipped
--    unless the role bypasses RLS.

ALTER TABLE "schools" ADD COLUMN "setup_emails_stopped_at" TIMESTAMP(3);

CREATE TABLE "activation_emails" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "provider_id" TEXT,
    "stage_at_send" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "first_clicked_at" TIMESTAMP(3),
    "click_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "activation_emails_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "activation_emails_kind_check" CHECK ("kind" IN ('FIRST', 'SECOND', 'THIRD')),
    CONSTRAINT "activation_emails_status_check" CHECK ("status" IN ('SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED')),
    CONSTRAINT "activation_emails_stage_check" CHECK ("stage_at_send" BETWEEN 1 AND 6)
);
CREATE UNIQUE INDEX "activation_emails_school_id_kind_key" ON "activation_emails"("school_id", "kind");
CREATE INDEX "activation_emails_school_id_provider_id_idx" ON "activation_emails"("school_id", "provider_id");
ALTER TABLE "activation_emails" ADD CONSTRAINT "activation_emails_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activation_emails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activation_emails" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "activation_emails"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

UPDATE "schools" s
SET "onboarding_call_prompt_closed_at" = NULL
WHERE s."status" = 'ACTIVE'
  AND s."onboarding_call_booked_at" IS NULL
  AND (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user)
  AND (SELECT count(*) FROM "students" st WHERE st."school_id" = s."id" AND st."status" = 'ACTIVE') < 5;
