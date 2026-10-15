-- Phase 9 / CP3.1 — health profiles and the Health officer role
-- (docs/modules/phase-9.md §10 CP3-D1, CP3-D2, CP3-D4).
--
-- 1. `health_profiles`, one per student, tenant data with RLS forced.
-- 2. A DATA migration: every student with a blood group or medical notes gets
--    a profile, blood group copied as it is and medical notes into
--    "conditions". Then the two columns are dropped from `students`, so the
--    health data lives in one place, read by fewer people and audited.
-- 3. The `health_officer` system role, and three permissions appended to the
--    admin role (owner is the wildcard). Teacher gets `health.note.read`
--    only: the "For teachers" note, for a child they teach.
--
-- No SECURITY DEFINER function; the count stays 23. Keep the permission lists
-- IN SYNC with packages/db/src/seeds/system-roles.ts and HEALTH_* in
-- packages/types/src/permissions.ts.

-- CreateTable
CREATE TABLE "health_profiles" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "allergies" TEXT,
    "conditions" TEXT,
    "medication" TEXT,
    "gp_clinic" TEXT,
    "emergency_notes" TEXT,
    "blood_group" TEXT,
    "teacher_note" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "health_profiles_text_lengths" CHECK (
      char_length(coalesce("allergies", '')) <= 1000 AND
      char_length(coalesce("conditions", '')) <= 2000 AND
      char_length(coalesce("medication", '')) <= 1000 AND
      char_length(coalesce("gp_clinic", '')) <= 200 AND
      char_length(coalesce("emergency_notes", '')) <= 1000 AND
      char_length(coalesce("blood_group", '')) <= 10 AND
      char_length(coalesce("teacher_note", '')) <= 500
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "health_profiles_student_id_key" ON "health_profiles"("student_id");

-- CreateIndex
CREATE INDEX "health_profiles_school_id_idx" ON "health_profiles"("school_id");

-- AddForeignKey
ALTER TABLE "health_profiles" ADD CONSTRAINT "health_profiles_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, as on every tenant table.
ALTER TABLE "health_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_profiles" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON health_profiles
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "health_profiles" TO app_user;

-- The data move. Runs as the migration role, which is not subject to RLS.
-- Blank strings count as nothing, so no empty profiles are created.
INSERT INTO "health_profiles" ("id", "school_id", "student_id", "blood_group", "conditions", "updated_at")
SELECT
    gen_random_uuid()::text,
    s."school_id",
    s."id",
    NULLIF(btrim(s."blood_group"), ''),
    NULLIF(btrim(s."medical_notes"), ''),
    CURRENT_TIMESTAMP
FROM "students" s
WHERE NULLIF(btrim(coalesce(s."blood_group", '')), '') IS NOT NULL
   OR NULLIF(btrim(coalesce(s."medical_notes", '')), '') IS NOT NULL;

-- AlterTable: the old columns go, after the copy above.
ALTER TABLE "students" DROP COLUMN "blood_group",
DROP COLUMN "medical_notes";

-- The Health officer role (CP3-D1). WHERE NOT EXISTS because roles'
-- (school_id, key) treats a NULL school_id as distinct, as in the bursar
-- migration.
INSERT INTO "roles" ("id", "school_id", "key", "name", "description", "is_system", "permissions", "created_at")
SELECT
    gen_random_uuid()::text,
    NULL,
    'health_officer',
    'Health officer',
    'School health officer — reads and keeps students'' health records and the sickbay log, and writes the note teachers see. No academic, finance, staff or settings access.',
    true,
    '["health.read","health.manage","sickbay.manage"]'::jsonb,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "roles"
    WHERE "school_id" IS NULL AND "key" = 'health_officer' AND "is_system" = true
);

-- Admin: all four health permissions. Teacher: the note only.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["health.read","health.manage","sickbay.manage","health.note.read"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'admin' AND "is_system" = true;

UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["health.note.read"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'teacher' AND "is_system" = true;
