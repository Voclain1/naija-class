-- Phase 9 / CP4.3 — questions and automatic marking (docs/modules/phase-9.md
-- §11 CP4-D6).
--
-- A collected homework item may carry a short list of questions:
--   MULTIPLE_CHOICE — 2 to 5 options, exactly one right (the question bank's
--     shape; a teacher may copy one in from the bank, recorded in
--     source_question_id);
--   FILL_IN — the teacher lists every accepted answer. An answer is right
--     when it equals one after ignoring case, spaces at either end and
--     repeated spaces inside. Nothing fuzzier.
-- The questions are fixed once anyone has handed in, so an automatic mark
-- never has to be worked out again against different questions.
--
-- The student's answers live on their attempt, keyed by question id
-- (multiple choice: the option's index; fill-in: the text), with the
-- automatic mark worked out by the server when they hand in. The teacher sees
-- it and gives the real mark; the student and parents see only the released
-- one.
--
-- Tenant data, RLS forced. No SECURITY DEFINER function; the count stays 23.

-- CreateEnum
CREATE TYPE "AssignmentQuestionType" AS ENUM ('MULTIPLE_CHOICE', 'FILL_IN');

-- CreateTable
CREATE TABLE "assignment_questions" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "type" "AssignmentQuestionType" NOT NULL,
    "text" TEXT NOT NULL,
    "marks" INTEGER NOT NULL,
    "options" JSONB,
    "correct_index" INTEGER,
    "accepted_answers" JSONB,
    "source_question_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_questions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assignment_questions_text_length" CHECK (char_length("text") BETWEEN 1 AND 2000),
    CONSTRAINT "assignment_questions_marks" CHECK ("marks" BETWEEN 1 AND 100),
    CONSTRAINT "assignment_questions_order" CHECK ("order_index" BETWEEN 1 AND 50),
    CONSTRAINT "assignment_questions_shape" CHECK (
      ("type" = 'MULTIPLE_CHOICE'
        AND jsonb_typeof("options") = 'array'
        AND jsonb_array_length("options") BETWEEN 2 AND 5
        AND "correct_index" >= 0
        AND "correct_index" < jsonb_array_length("options")
        AND "accepted_answers" IS NULL)
      OR
      ("type" = 'FILL_IN'
        AND jsonb_typeof("accepted_answers") = 'array'
        AND jsonb_array_length("accepted_answers") BETWEEN 1 AND 10
        AND "options" IS NULL
        AND "correct_index" IS NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "assignment_questions_collection_id_order_index_key" ON "assignment_questions"("collection_id", "order_index");

-- AddForeignKey
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "assignment_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The student's answers and the automatic mark, on the attempt.
ALTER TABLE "assignment_submissions" ADD COLUMN "answers" JSONB;
ALTER TABLE "assignment_submissions" ADD COLUMN "auto_mark" INTEGER;
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_answers_shape"
  CHECK ("answers" IS NULL OR jsonb_typeof("answers") = 'object');
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_auto_mark"
  CHECK ("auto_mark" IS NULL OR "auto_mark" >= 0);

-- Tenant isolation, as on every tenant table.
ALTER TABLE "assignment_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_questions" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assignment_questions
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "assignment_questions" TO app_user;
