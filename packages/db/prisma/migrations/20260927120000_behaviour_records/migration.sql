-- Behaviour records (docs/modules/the-school-day.md Part C).
--
-- C14: internal in v1 — staff write and read, parents do not see them. There is
-- no portal or student-portal endpoint for this table, deliberately.

-- CreateEnum
CREATE TYPE "behaviour_kind" AS ENUM ('COMMENDATION', 'CONCERN');

-- CreateTable
CREATE TABLE "behaviour_records" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "kind" "behaviour_kind" NOT NULL,
    "note" TEXT NOT NULL,
    -- DATE: the day it happened, which is not always the day it was written up.
    "occurred_on" DATE NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMP(3),
    "withdrawn_by" TEXT,

    CONSTRAINT "behaviour_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "behaviour_records_school_id_student_id_occurred_on_idx"
  ON "behaviour_records"("school_id", "student_id", "occurred_on");

-- Tenant isolation — ENABLE + FORCE with WITH CHECK, like every tenant table.
ALTER TABLE "behaviour_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "behaviour_records" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON behaviour_records
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "behaviour_records" TO app_user;

-- Grant to existing roles, so a school that signed up yesterday can use this
-- today. Owner/admin and TEACHER may write: a behaviour note is the judgement
-- of the person who was in the room.
--
-- BURSAR gets neither, unlike homework and the calendar. A conduct record is
-- not finance-adjacent context — it is the most sensitive thing a school writes
-- about a child, and "no reason to read it" is the whole test.
UPDATE roles
SET permissions = permissions || '["behaviour.read","behaviour.create"]'::jsonb
WHERE key IN ('owner', 'admin', 'teacher') AND is_system = true
  AND NOT (permissions @> '["behaviour.create"]'::jsonb);
