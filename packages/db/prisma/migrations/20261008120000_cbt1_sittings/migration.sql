-- =========================================================================
-- Online exams (CBT), slice 1 — sittings, arms, candidates (docs/modules/cbt.md)
-- =========================================================================
--
-- A sitting schedules one FINAL exam paper for one or more class arms (D1).
-- Publishing freezes the candidate list and builds the encrypted exam pack
-- (D2, D3), stored on the sitting as a JSON envelope. The answer key is never
-- in the pack (D4).
--
-- Every table is tenant-scoped with the flat school_id policy, FORCE RLS. No
-- SECURITY DEFINER function: the public pack download (CBT2) resolves the
-- school from its slug (schools has no RLS) and then reads under that
-- school's GUC, like every other tenant read. Count stays 23.

CREATE TYPE "CbtSittingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

CREATE TABLE "cbt_sittings" (
  "id"               TEXT NOT NULL,
  "school_id"        TEXT NOT NULL,
  "paper_id"         TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "starts_at"        TIMESTAMP(3) NOT NULL,
  "window_ends_at"   TIMESTAMP(3) NOT NULL,
  "duration_minutes" INTEGER NOT NULL,
  "status"           "CbtSittingStatus" NOT NULL DEFAULT 'DRAFT',
  "access_code"      TEXT NOT NULL,
  "unlock_code"      TEXT NOT NULL,
  "pack"             JSONB,
  "pack_built_at"    TIMESTAMP(3),
  "created_by"       TEXT NOT NULL,
  "published_by"     TEXT,
  "published_at"     TIMESTAMP(3),
  "closed_by"        TEXT,
  "closed_at"        TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cbt_sittings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cbt_sittings_window_check" CHECK ("window_ends_at" > "starts_at"),
  CONSTRAINT "cbt_sittings_duration_check" CHECK ("duration_minutes" BETWEEN 5 AND 600),
  CONSTRAINT "cbt_sittings_access_code_check" CHECK ("access_code" ~ '^[A-Z2-9]{6}$'),
  CONSTRAINT "cbt_sittings_unlock_code_check" CHECK ("unlock_code" ~ '^[A-Z2-9]{12}$'),
  -- A published sitting always has its pack; a draft never does.
  CONSTRAINT "cbt_sittings_pack_check" CHECK (("status" = 'DRAFT') = ("pack" IS NULL)),
  CONSTRAINT "cbt_sittings_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "exam_papers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cbt_sittings_school_id_access_code_key" ON "cbt_sittings"("school_id", "access_code");
CREATE INDEX "cbt_sittings_school_id_idx" ON "cbt_sittings"("school_id");
CREATE INDEX "cbt_sittings_paper_id_idx" ON "cbt_sittings"("paper_id");

CREATE TABLE "cbt_sitting_arms" (
  "sitting_id"   TEXT NOT NULL,
  "class_arm_id" TEXT NOT NULL,
  "school_id"    TEXT NOT NULL,
  CONSTRAINT "cbt_sitting_arms_pkey" PRIMARY KEY ("sitting_id", "class_arm_id"),
  CONSTRAINT "cbt_sitting_arms_sitting_id_fkey" FOREIGN KEY ("sitting_id") REFERENCES "cbt_sittings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cbt_sitting_arms_class_arm_id_fkey" FOREIGN KEY ("class_arm_id") REFERENCES "class_arms"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "cbt_sitting_arms_school_id_idx" ON "cbt_sitting_arms"("school_id");

CREATE TABLE "cbt_candidates" (
  "id"           TEXT NOT NULL,
  "school_id"    TEXT NOT NULL,
  "sitting_id"   TEXT NOT NULL,
  "student_id"   TEXT NOT NULL,
  "class_arm_id" TEXT NOT NULL,
  "version"      TEXT NOT NULL,
  CONSTRAINT "cbt_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cbt_candidates_version_check" CHECK ("version" IN ('A', 'B', 'C', 'D')),
  CONSTRAINT "cbt_candidates_sitting_id_fkey" FOREIGN KEY ("sitting_id") REFERENCES "cbt_sittings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cbt_candidates_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cbt_candidates_class_arm_id_fkey" FOREIGN KEY ("class_arm_id") REFERENCES "class_arms"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cbt_candidates_sitting_id_student_id_key" ON "cbt_candidates"("sitting_id", "student_id");
CREATE INDEX "cbt_candidates_school_id_idx" ON "cbt_candidates"("school_id");

-- RLS — flat school_id policies, FORCE so the migration role is bound too.
ALTER TABLE "cbt_sittings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cbt_sittings" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cbt_sittings
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

ALTER TABLE "cbt_sitting_arms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cbt_sitting_arms" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cbt_sitting_arms
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

ALTER TABLE "cbt_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cbt_candidates" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cbt_candidates
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- Permissions — CBT_PERMISSIONS in packages/types. admin and teacher get both;
-- the SERVICE holds a teacher to the subjects they teach at each level (D62).
-- Bursar none. Owner holds "*". Kept IN SYNC with
-- packages/db/src/seeds/system-roles.ts.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["cbt.read","cbt.manage"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" IN ('admin', 'teacher')
  AND "is_system" = true;
