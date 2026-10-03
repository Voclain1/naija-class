-- Phase 8c / CP5c — exam papers (docs/modules/phase-8.md §22.3).
--
-- Three tables, all FORCE RLS on their own school_id, and three permissions.
-- No SECURITY DEFINER function (count stays 23).

CREATE TYPE "ExamPaperStatus" AS ENUM ('DRAFT', 'FINAL');

-- =========================================================================
-- 1. exam_papers
-- =========================================================================
CREATE TABLE "exam_papers" (
    "id"                 TEXT NOT NULL,
    "school_id"          TEXT NOT NULL,
    "subject_id"         TEXT NOT NULL,
    "class_level_id"     TEXT NOT NULL,
    "term_id"            TEXT NOT NULL,
    "component_id"       TEXT,
    "title"              TEXT NOT NULL,
    "duration_minutes"   INTEGER NOT NULL,
    "instructions"       TEXT,
    "version_count"      INTEGER NOT NULL DEFAULT 1,
    "status"             "ExamPaperStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by"         TEXT NOT NULL,
    "finalised_by"       TEXT,
    "finalised_at"       TIMESTAMP(3),
    "duplicated_from_id" TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_papers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exam_papers_title_check" CHECK (length(btrim("title")) > 0),
    CONSTRAINT "exam_papers_duration_check" CHECK ("duration_minutes" BETWEEN 5 AND 600),
    -- Versions A–D.
    CONSTRAINT "exam_papers_version_count_check" CHECK ("version_count" BETWEEN 1 AND 4),
    -- FINAL says who froze it and when; a DRAFT says neither.
    CONSTRAINT "exam_papers_final_check" CHECK (
      ("status" = 'DRAFT' AND "finalised_by" IS NULL AND "finalised_at" IS NULL)
      OR ("status" = 'FINAL' AND "finalised_by" IS NOT NULL AND "finalised_at" IS NOT NULL)
    )
);

CREATE INDEX "exam_papers_school_id_idx" ON "exam_papers"("school_id");
CREATE INDEX "exam_papers_school_id_subject_id_class_level_id_term_id_idx"
  ON "exam_papers"("school_id", "subject_id", "class_level_id", "term_id");

ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_class_level_id_fkey"
  FOREIGN KEY ("class_level_id") REFERENCES "class_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_term_id_fkey"
  FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_component_id_fkey"
  FOREIGN KEY ("component_id") REFERENCES "grading_components"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =========================================================================
-- 2. exam_paper_sections
-- =========================================================================
CREATE TABLE "exam_paper_sections" (
    "id"           TEXT NOT NULL,
    "school_id"    TEXT NOT NULL,
    "paper_id"     TEXT NOT NULL,
    "order_index"  INTEGER NOT NULL,
    "title"        TEXT NOT NULL,
    "instructions" TEXT,

    CONSTRAINT "exam_paper_sections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exam_paper_sections_title_check" CHECK (length(btrim("title")) > 0)
);

CREATE UNIQUE INDEX "exam_paper_sections_paper_id_order_index_key"
  ON "exam_paper_sections"("paper_id", "order_index");
CREATE INDEX "exam_paper_sections_school_id_idx" ON "exam_paper_sections"("school_id");

ALTER TABLE "exam_paper_sections" ADD CONSTRAINT "exam_paper_sections_paper_id_fkey"
  FOREIGN KEY ("paper_id") REFERENCES "exam_papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- 3. exam_paper_items
-- =========================================================================
CREATE TABLE "exam_paper_items" (
    "id"          TEXT NOT NULL,
    "school_id"   TEXT NOT NULL,
    "paper_id"    TEXT NOT NULL,
    "section_id"  TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,

    CONSTRAINT "exam_paper_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exam_paper_items_paper_id_question_id_key"
  ON "exam_paper_items"("paper_id", "question_id");
CREATE UNIQUE INDEX "exam_paper_items_section_id_order_index_key"
  ON "exam_paper_items"("section_id", "order_index");
CREATE INDEX "exam_paper_items_school_id_idx" ON "exam_paper_items"("school_id");
CREATE INDEX "exam_paper_items_question_id_idx" ON "exam_paper_items"("question_id");

ALTER TABLE "exam_paper_items" ADD CONSTRAINT "exam_paper_items_paper_id_fkey"
  FOREIGN KEY ("paper_id") REFERENCES "exam_papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_paper_items" ADD CONSTRAINT "exam_paper_items_section_id_fkey"
  FOREIGN KEY ("section_id") REFERENCES "exam_paper_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT: a question a paper sets cannot be deleted from under it. (Only
-- drafts are ever deleted, and a paper holds only approved questions, so this
-- is a backstop rather than a path anyone takes.)
ALTER TABLE "exam_paper_items" ADD CONSTRAINT "exam_paper_items_question_id_fkey"
  FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =========================================================================
-- 4. A FINAL paper is frozen, in the database
-- =========================================================================
-- The service never edits a FINAL paper, but "frozen" is the promise a printed
-- paper rests on, so it is also a property of the tables: no change to a FINAL
-- paper's own row (other than nothing), and no insert, update or delete of its
-- sections or items. Deleting a FINAL paper is refused too.
CREATE OR REPLACE FUNCTION exam_paper_frozen_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_paper_id TEXT;
  v_status   "ExamPaperStatus";
BEGIN
  IF TG_TABLE_NAME = 'exam_papers' THEN
    IF OLD."status" = 'FINAL' THEN
      RAISE EXCEPTION 'exam paper % is FINAL and cannot be changed', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_paper_id := COALESCE(NEW."paper_id", OLD."paper_id");
  SELECT "status" INTO v_status FROM "exam_papers" WHERE "id" = v_paper_id;
  -- A missing paper means its own cascade delete is running; nothing to guard.
  IF v_status = 'FINAL' THEN
    RAISE EXCEPTION 'exam paper % is FINAL and cannot be changed', v_paper_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- On exam_papers: BEFORE UPDATE/DELETE of an already-FINAL row. The transition
-- DRAFT -> FINAL is an update of a DRAFT row, so it passes.
CREATE TRIGGER exam_papers_frozen
  BEFORE UPDATE OR DELETE ON "exam_papers"
  FOR EACH ROW EXECUTE FUNCTION exam_paper_frozen_guard();
CREATE TRIGGER exam_paper_sections_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "exam_paper_sections"
  FOR EACH ROW EXECUTE FUNCTION exam_paper_frozen_guard();
CREATE TRIGGER exam_paper_items_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "exam_paper_items"
  FOR EACH ROW EXECUTE FUNCTION exam_paper_frozen_guard();

-- =========================================================================
-- 5. RLS — flat school_id policies, FORCE so the migration role is bound too
-- =========================================================================
ALTER TABLE "exam_papers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_papers" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exam_papers
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

ALTER TABLE "exam_paper_sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_paper_sections" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exam_paper_sections
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

ALTER TABLE "exam_paper_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_paper_items" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exam_paper_items
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- =========================================================================
-- 6. Permissions — EXAM_PAPER_PERMISSIONS in packages/types
-- =========================================================================
-- admin and teacher get all three; the SERVICE holds a teacher to the
-- subjects they teach at each level, as for the question bank (D62). Bursar
-- none. Owner holds "*". Kept IN SYNC with packages/db/src/seeds/system-roles.ts.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["exam-paper.read","exam-paper.write","exam-paper.finalise"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" IN ('admin', 'teacher')
  AND "is_system" = true;
