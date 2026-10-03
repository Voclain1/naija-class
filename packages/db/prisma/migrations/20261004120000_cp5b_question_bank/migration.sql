-- Phase 8c / CP5b — the question bank (docs/modules/phase-8.md §22.2).
--
-- Two tables, both FORCE RLS on their own school_id, and four permissions.
-- No SECURITY DEFINER function (count stays 23): every read and write here
-- happens inside a tenant.

-- =========================================================================
-- 1. Enums
-- =========================================================================
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'SHORT_ANSWER', 'THEORY');
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');
CREATE TYPE "QuestionSource" AS ENUM ('MANUAL', 'AI');
CREATE TYPE "QuestionDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- =========================================================================
-- 2. questions
-- =========================================================================
CREATE TABLE "questions" (
    "id"             TEXT NOT NULL,
    "school_id"      TEXT NOT NULL,
    "subject_id"     TEXT NOT NULL,
    "class_level_id" TEXT NOT NULL,
    "topic"          TEXT NOT NULL,
    "type"           "QuestionType" NOT NULL,
    "difficulty"     "QuestionDifficulty" NOT NULL DEFAULT 'MEDIUM',
    "text"           TEXT NOT NULL,
    "marks"          INTEGER NOT NULL,
    "answer_guide"   TEXT,
    "status"         "QuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "source"         "QuestionSource" NOT NULL DEFAULT 'MANUAL',
    "created_by"     TEXT NOT NULL,
    "approved_by"    TEXT,
    "approved_at"    TIMESTAMP(3),
    "retired_at"     TIMESTAMP(3),
    "supersedes_id"  TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id"),
    -- A mark allocation a paper can actually carry.
    CONSTRAINT "questions_marks_check" CHECK ("marks" BETWEEN 1 AND 100),
    CONSTRAINT "questions_text_check" CHECK (length(btrim("text")) > 0),
    CONSTRAINT "questions_topic_check" CHECK (length(btrim("topic")) > 0),
    -- The approval gate, in the database: nothing reads as approved without
    -- saying who approved it and when. A DRAFT carries neither.
    CONSTRAINT "questions_approval_check" CHECK (
      ("status" = 'DRAFT' AND "approved_by" IS NULL AND "approved_at" IS NULL)
      OR ("status" <> 'DRAFT' AND "approved_by" IS NOT NULL AND "approved_at" IS NOT NULL)
    ),
    CONSTRAINT "questions_retired_check" CHECK (("status" = 'RETIRED') = ("retired_at" IS NOT NULL))
);

CREATE INDEX "questions_school_id_idx" ON "questions"("school_id");
-- Serves the bank's browse filter and CP5c's "approved questions for this
-- subject and level".
CREATE INDEX "questions_school_id_subject_id_class_level_id_status_idx"
  ON "questions"("school_id", "subject_id", "class_level_id", "status");
-- At most one open revision per approved question, so two teachers editing
-- the same question cannot each produce a "new version" of it.
CREATE UNIQUE INDEX "questions_one_open_revision_idx"
  ON "questions"("supersedes_id") WHERE "status" = 'DRAFT' AND "supersedes_id" IS NOT NULL;

-- RESTRICT, unlike lesson_plans' CASCADE: a question bank is a school's exam
-- content, and a deleted subject must not quietly take it with it. Subjects
-- are deactivated, not deleted, in normal use.
ALTER TABLE "questions" ADD CONSTRAINT "questions_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "questions" ADD CONSTRAINT "questions_class_level_id_fkey"
  FOREIGN KEY ("class_level_id") REFERENCES "class_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "questions" ADD CONSTRAINT "questions_supersedes_id_fkey"
  FOREIGN KEY ("supersedes_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =========================================================================
-- 3. question_options
-- =========================================================================
CREATE TABLE "question_options" (
    "id"          TEXT NOT NULL,
    "school_id"   TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "text"        TEXT NOT NULL,
    "is_correct"  BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "question_options_order_check" CHECK ("order_index" BETWEEN 0 AND 5),
    CONSTRAINT "question_options_text_check" CHECK (length(btrim("text")) > 0)
);

CREATE UNIQUE INDEX "question_options_question_id_order_index_key"
  ON "question_options"("question_id", "order_index");
-- One correct option at most. "At least one" needs the whole set, so the
-- service checks it — this index makes "two keys" impossible however a row
-- got written.
CREATE UNIQUE INDEX "question_options_one_correct_idx"
  ON "question_options"("question_id") WHERE "is_correct";
CREATE INDEX "question_options_school_id_idx" ON "question_options"("school_id");

ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_fkey"
  FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- 4. RLS — flat school_id policies, FORCE so the migration role is bound too
-- =========================================================================
ALTER TABLE "questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "questions" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON questions
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

ALTER TABLE "question_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "question_options" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON question_options
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- =========================================================================
-- 5. Permissions — QUESTION_BANK_PERMISSIONS in packages/types
-- =========================================================================
-- admin and teacher get all four. A teacher is held by the SERVICE to the
-- subjects they teach at each class level (D62: the subject teacher approves).
-- Bursar gets none. Owner holds "*". Kept IN SYNC with
-- packages/db/src/seeds/system-roles.ts. Idempotent: appends only what is
-- missing.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["question.read","question.write","question.approve","question.generate"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" IN ('admin', 'teacher')
  AND "is_system" = true;
