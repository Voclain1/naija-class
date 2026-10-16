-- Phase 9 / CP4b — AI-drafted marking feedback, optional at every level
-- (docs/modules/phase-9.md §12).
--
-- Marking by hand is unchanged. A draft exists only when three switches are
-- on — the platform's schools.ai_enabled, the school's own
-- assignment_feedback_ai_enabled (OFF by default, set by owner/admin), and a
-- teacher pressing "Draft with AI" — and a draft is never a mark: only the
-- teacher's own "Save mark" writes one (CLAUDE.md: never auto-finalise AI
-- output for grades). The saved attempt then records feedback_ai_drafted, so
-- "was this AI-drafted?" stays answerable.
--
-- Drafts live in their own staff-only table, one per attempt. PENDING while
-- the queue job runs, READY with the suggestion, FAILED with a reason the
-- teacher can read ("the school's AI allowance for this month is used up").
-- The answer text is NOT copied here: the job reads it from the attempt.
--
-- Tenant data, RLS forced. No SECURITY DEFINER function; the count stays 23.

ALTER TABLE "schools" ADD COLUMN "assignment_feedback_ai_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "assignment_collections" ADD COLUMN "marking_guide" TEXT;
ALTER TABLE "assignment_collections" ADD CONSTRAINT "assignment_collections_marking_guide_length"
  CHECK ("marking_guide" IS NULL OR char_length("marking_guide") BETWEEN 1 AND 4000);

ALTER TABLE "assignment_submissions" ADD COLUMN "feedback_ai_drafted" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "AssignmentFeedbackDraftStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "assignment_feedback_drafts" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "status" "AssignmentFeedbackDraftStatus" NOT NULL DEFAULT 'PENDING',
    "mark" INTEGER,
    "feedback" TEXT,
    "reason" TEXT,
    "failure" TEXT,
    "prompt_version" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_feedback_drafts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assignment_feedback_drafts_mark" CHECK ("mark" IS NULL OR "mark" >= 0),
    CONSTRAINT "assignment_feedback_drafts_feedback_length" CHECK ("feedback" IS NULL OR char_length("feedback") <= 2000),
    CONSTRAINT "assignment_feedback_drafts_reason_length" CHECK ("reason" IS NULL OR char_length("reason") <= 500),
    CONSTRAINT "assignment_feedback_drafts_ready" CHECK ("status" <> 'READY' OR ("mark" IS NOT NULL AND "feedback" IS NOT NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "assignment_feedback_drafts_submission_id_key" ON "assignment_feedback_drafts"("submission_id");

-- AddForeignKey
ALTER TABLE "assignment_feedback_drafts" ADD CONSTRAINT "assignment_feedback_drafts_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, as on every tenant table.
ALTER TABLE "assignment_feedback_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_feedback_drafts" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assignment_feedback_drafts
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "assignment_feedback_drafts" TO app_user;
