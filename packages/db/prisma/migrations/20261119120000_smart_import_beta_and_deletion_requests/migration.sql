-- Smart Student Import beta, and account deletion requests (2026-10-24).
-- docs/modules/smart-student-import.md §9, docs/modules/account-deletion-requests.md.
-- No SECURITY DEFINER function added or changed; count stays 23.

-- Who at the school accepted, before its first scan, how register photos are
-- handled. `schools` has no RLS (it is the tenant table).
ALTER TABLE "schools" ADD COLUMN "smart_import_consent_at" TIMESTAMP(3);
ALTER TABLE "schools" ADD COLUMN "smart_import_consent_by" TEXT;

-- Counts only, never text, for STUDENTS_SCAN jobs. import_jobs is already
-- FORCE RLS on the school's GUC.
ALTER TABLE "import_jobs" ADD COLUMN "scan_review" JSONB;

CREATE TABLE "account_deletion_requests" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "principal" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handled_at" TIMESTAMP(3),
    "handled_by" TEXT,
    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_deletion_requests_principal_check" CHECK ("principal" IN ('STAFF', 'GUARDIAN', 'STUDENT'))
);
CREATE INDEX "account_deletion_requests_school_id_handled_at_idx" ON "account_deletion_requests"("school_id", "handled_at");
-- One open request per person: asking twice changes nothing.
CREATE UNIQUE INDEX "account_deletion_requests_open_key"
  ON "account_deletion_requests"("school_id", "principal", "subject_id") WHERE "handled_at" IS NULL;
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "account_deletion_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_deletion_requests" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "account_deletion_requests"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
