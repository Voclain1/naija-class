-- =========================================================================
-- Online exams (CBT), slice 3 — results (docs/modules/cbt.md D5, D8)
-- =========================================================================
--
-- Marking itself stores nothing: a sitting is always on a FINAL, frozen
-- paper, so an attempt's objective score is computed from its answers and
-- the paper's key whenever results are read. Only the teacher's decisions
-- are stored:
--
--   * cbt_attempts.chosen — which computer's attempt counts, for a student
--     who sat on more than one (D5). At most one per candidate, held by a
--     partial unique index. A student with a single attempt needs no choice.
--     On the ATTEMPT rather than a chosen_attempt_id on the candidate, so the
--     two tables do not point at each other (attempts already reference
--     candidates, RESTRICT).
--   * cbt_candidates.theory_mark — the mark for the questions sat on paper,
--     typed in from the scripts (Q2). Whole marks, like every exam-paper
--     mark; the service caps it at the paper's on-paper total.
--
-- Scores reach the gradebook only through the CP5a preview-then-save path,
-- by a teacher (D8): nothing here writes to assessment_scores.
--
-- No new table, no new policy (both tables are already FORCE RLS with the
-- flat school_id policy), no SECURITY DEFINER function (count stays 23).

ALTER TABLE "cbt_attempts" ADD COLUMN "chosen" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "cbt_attempts_one_chosen_per_candidate" ON "cbt_attempts"("candidate_id") WHERE "chosen";

ALTER TABLE "cbt_candidates" ADD COLUMN "theory_mark" INTEGER;
ALTER TABLE "cbt_candidates" ADD CONSTRAINT "cbt_candidates_theory_mark_check" CHECK ("theory_mark" IS NULL OR "theory_mark" BETWEEN 0 AND 1000);
