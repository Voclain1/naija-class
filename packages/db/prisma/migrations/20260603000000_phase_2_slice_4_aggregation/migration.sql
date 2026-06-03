-- Phase 2 / Slice 4 — position aggregation.
--
-- One additive nullable column on `assessments`: positions_computed_at. Set by
-- the aggregation pass when it writes subjectPosition/classPosition; distinct
-- from computed_at (the score-MATERIALIZATION stamp, set on score entry). The
-- GET /assessments/aggregate/status endpoint sources max(positions_computed_at)
-- per subject (and overall, where class_position IS NOT NULL).
--
-- NULL is the correct starting state — no positions have been computed yet, so
-- no backfill. No new table → no RLS change (the column rides the existing
-- `assessments` tenant_isolation policy). SECURITY DEFINER count stays 4.

-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "positions_computed_at" TIMESTAMP(3);
