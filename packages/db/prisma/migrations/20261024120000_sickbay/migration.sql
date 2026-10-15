-- Phase 9 / CP3.3 — the sickbay log (docs/modules/phase-9.md §10 CP3-D5, CP3-D6).
--
-- A visit: when, the complaint, the action taken, whether the child was sent
-- home, whether the details are shared with the parent, and who recorded it.
-- Medicine given is its own list on the visit. Withdrawn, never deleted.
-- Parents are told once per guardian per visit, enforced by the unique
-- (visit_id, guardian_id) row in sickbay_notices.
--
-- Tenant data, RLS forced on all three. The permission (sickbay.manage) was
-- added in 20261022120000_health_profiles. No SECURITY DEFINER function; the
-- count stays 23.

-- CreateTable
CREATE TABLE "sickbay_visits" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "visited_at" TIMESTAMP(3) NOT NULL,
    "complaint" TEXT NOT NULL,
    "action_taken" TEXT,
    "sent_home" BOOLEAN NOT NULL DEFAULT false,
    "share_with_parent" BOOLEAN NOT NULL DEFAULT false,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMP(3),
    "withdrawn_by" TEXT,

    CONSTRAINT "sickbay_visits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sickbay_visits_complaint_length" CHECK (char_length("complaint") BETWEEN 1 AND 500),
    CONSTRAINT "sickbay_visits_action_length" CHECK ("action_taken" IS NULL OR char_length("action_taken") BETWEEN 1 AND 500),
    CONSTRAINT "sickbay_visits_withdrawn" CHECK (("withdrawn_at" IS NULL) = ("withdrawn_by" IS NULL))
);

-- CreateTable
CREATE TABLE "sickbay_medications" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "given_at" TIMESTAMP(3) NOT NULL,
    "given_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sickbay_medications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sickbay_medications_name_length" CHECK (char_length("name") BETWEEN 1 AND 120),
    CONSTRAINT "sickbay_medications_dose_length" CHECK (char_length("dose") BETWEEN 1 AND 60)
);

-- CreateTable
CREATE TABLE "sickbay_notices" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sickbay_notices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sickbay_notices_channel" CHECK ("channel" IN ('PUSH', 'SMS', 'NONE'))
);

-- CreateIndex
CREATE INDEX "sickbay_visits_school_id_visited_at_idx" ON "sickbay_visits"("school_id", "visited_at");
CREATE INDEX "sickbay_visits_school_id_student_id_idx" ON "sickbay_visits"("school_id", "student_id");
CREATE INDEX "sickbay_medications_visit_id_idx" ON "sickbay_medications"("visit_id");
CREATE UNIQUE INDEX "sickbay_notices_visit_id_guardian_id_key" ON "sickbay_notices"("visit_id", "guardian_id");

-- AddForeignKey
ALTER TABLE "sickbay_visits" ADD CONSTRAINT "sickbay_visits_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sickbay_medications" ADD CONSTRAINT "sickbay_medications_visit_id_fkey"
  FOREIGN KEY ("visit_id") REFERENCES "sickbay_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sickbay_notices" ADD CONSTRAINT "sickbay_notices_visit_id_fkey"
  FOREIGN KEY ("visit_id") REFERENCES "sickbay_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, as on every tenant table.
ALTER TABLE "sickbay_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sickbay_visits" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sickbay_visits
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "sickbay_visits" TO app_user;

ALTER TABLE "sickbay_medications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sickbay_medications" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sickbay_medications
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "sickbay_medications" TO app_user;

ALTER TABLE "sickbay_notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sickbay_notices" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sickbay_notices
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "sickbay_notices" TO app_user;
