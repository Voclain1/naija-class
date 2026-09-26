-- Homework (docs/modules/the-school-day.md Part B).
--
-- B7: information, not workflow. A teacher posts what is due and when; nobody
-- submits anything. The table has no submission column on purpose — see the
-- model's own comment for why that is a separate product.

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "class_arm_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    -- DATE, not TIMESTAMP: "due Friday" has no time of day, and a timestamp
    -- would reintroduce the "midnight in which zone?" trap.
    "due_date" DATE NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMP(3),
    "withdrawn_by" TEXT,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignments_school_id_class_arm_id_due_date_idx" ON "assignments"("school_id", "class_arm_id", "due_date");
CREATE INDEX "assignments_school_id_created_by_posted_at_idx" ON "assignments"("school_id", "created_by", "posted_at");

-- Tenant isolation — ENABLE + FORCE with WITH CHECK, like every tenant table.
ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignments" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON assignments
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "assignments" TO app_user;

-- Grant to the roles that already exist, so a school that signed up yesterday
-- can use this today (same backfill shape as the announcements migration).
--
-- homework.create goes to TEACHER as well as owner/admin: setting homework is
-- teaching work, unlike an announcement, which is the school speaking. The
-- service still holds a teacher to the classes and subjects their own scope
-- lists (B8).
UPDATE roles
SET permissions = permissions || '["homework.read","homework.create"]'::jsonb
WHERE key IN ('owner', 'admin', 'teacher') AND is_system = true
  AND NOT (permissions @> '["homework.create"]'::jsonb);

UPDATE roles
SET permissions = permissions || '["homework.read"]'::jsonb
WHERE key = 'bursar' AND is_system = true
  AND NOT (permissions @> '["homework.read"]'::jsonb);
