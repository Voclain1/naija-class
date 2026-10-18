-- Phase 9 / CP8.3 — email broadcasts for announcements
-- (docs/modules/phase-9.md §17.11, approved 2026-10-18).
--
--   * An announcement to EVERYONE, PARENTS or a CLASS may also be emailed to
--     the families (`email_families`). One row per (announcement, address) in
--     `announcement_emails`; a row is claimed once, so a retried job never
--     sends twice.
--   * `email_suppressions`: an unsubscribe (ANNOUNCEMENTS) or a hard bounce or
--     complaint (ALL non-essential) stops email to that address from that
--     school.
--   * `announcement_email_counters`: the plan's daily limit, taken atomically.
--
-- No new SECURITY DEFINER function; the count stays 23. The unsubscribe link
-- resolves the school by slug (`schools` has no RLS) and the webhook by the
-- school id tagged on the email, then each writes under that school's GUC.

ALTER TABLE "announcements" ADD COLUMN "email_families" BOOLEAN NOT NULL DEFAULT false;
-- Families in the audience with no address when the email was prepared.
ALTER TABLE "announcements" ADD COLUMN "email_no_address" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_email_families" CHECK (NOT "email_families" OR "audience" <> 'STAFF');

CREATE TABLE "announcement_emails" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "announcement_id" TEXT NOT NULL,
    "guardian_id" TEXT,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "skip_reason" TEXT,
    "provider_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "announcement_emails_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "announcement_emails_status" CHECK ("status" IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'SKIPPED')),
    CONSTRAINT "announcement_emails_skip" CHECK (
      ("status" = 'SKIPPED' AND "skip_reason" IN ('UNSUBSCRIBED', 'SUPPRESSED', 'CAPPED', 'EMAIL_OFF'))
      OR ("status" <> 'SKIPPED' AND "skip_reason" IS NULL)),
    CONSTRAINT "announcement_emails_email" CHECK ("email" = lower("email") AND char_length("email") <= 320)
);
CREATE UNIQUE INDEX "announcement_emails_announcement_id_email_key" ON "announcement_emails"("announcement_id", "email");
CREATE INDEX "announcement_emails_school_id_announcement_id_status_idx" ON "announcement_emails"("school_id", "announcement_id", "status");
CREATE UNIQUE INDEX "announcement_emails_provider_id_key" ON "announcement_emails"("provider_id");
ALTER TABLE "announcement_emails" ADD CONSTRAINT "announcement_emails_announcement_id_fkey"
  FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcement_emails" ADD CONSTRAINT "announcement_emails_guardian_id_fkey"
  FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_suppressions_reason" CHECK ("reason" IN ('UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED')),
    CONSTRAINT "email_suppressions_scope" CHECK ("scope" IN ('ANNOUNCEMENTS', 'ALL')),
    CONSTRAINT "email_suppressions_email" CHECK ("email" = lower("email") AND char_length("email") <= 320)
);
CREATE UNIQUE INDEX "email_suppressions_school_id_email_scope_key" ON "email_suppressions"("school_id", "email", "scope");

CREATE TABLE "announcement_email_counters" (
    "school_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "announcement_email_counters_pkey" PRIMARY KEY ("school_id", "day"),
    CONSTRAINT "announcement_email_counters_sent" CHECK ("sent" >= 0)
);

ALTER TABLE "announcement_emails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "announcement_emails" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON announcement_emails
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "announcement_emails" TO app_user;

ALTER TABLE "email_suppressions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_suppressions" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON email_suppressions
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "email_suppressions" TO app_user;

ALTER TABLE "announcement_email_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "announcement_email_counters" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON announcement_email_counters
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "announcement_email_counters" TO app_user;
