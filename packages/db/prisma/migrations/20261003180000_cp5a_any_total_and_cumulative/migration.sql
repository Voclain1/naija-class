-- Phase 8c / CP5a — marks out of any total, and cumulative results
-- (docs/modules/phase-8.md §22.1, D60, D61). Hand-written, like CP6a/CP6b, so
-- the pre-existing drift is not swept in. No RLS change: both tables are
-- already tenant-isolated; these are new columns on them. No SECURITY DEFINER.

-- 1. The raw mark a teacher typed and what it was out of. Both NULL for a
--    score entered directly in weight units — every existing row. Set
--    together or not at all, and the raw mark never exceeds its total.
ALTER TABLE "assessment_scores" ADD COLUMN "raw_score" INTEGER;
ALTER TABLE "assessment_scores" ADD COLUMN "raw_out_of" INTEGER;
ALTER TABLE "assessment_scores" ADD CONSTRAINT "assessment_scores_raw_pair_check" CHECK (
  (raw_score IS NULL AND raw_out_of IS NULL)
  OR (raw_out_of BETWEEN 1 AND 1000 AND raw_score BETWEEN 0 AND raw_out_of)
);

-- 2. Cumulative results, snapshotted on the final term's card.
ALTER TABLE "report_cards" ADD COLUMN "cumulative_average" INTEGER;
ALTER TABLE "report_cards" ADD COLUMN "cumulative_terms" INTEGER;
ALTER TABLE "report_cards" ADD COLUMN "cumulative_position" INTEGER;
ALTER TABLE "report_cards" ADD COLUMN "cumulative_subjects" JSONB;
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_cumulative_check" CHECK (
  (cumulative_terms IS NULL OR cumulative_terms >= 1)
  AND (cumulative_position IS NULL OR cumulative_position >= 1)
);
