-- Phase 7 / CP3 (D20) — record what a lesson plan was grounded in.
--
-- Holds chunk ids, heading paths, document titles and cosine distances, plus
-- the retrieval reason when nothing was used.
--
-- A COLUMN rather than a join to curriculum_chunks. A lesson plan is a
-- HISTORICAL RECORD: it must keep showing what grounded it after the document
-- is deleted and its chunks cascade away. Same instinct that keeps
-- embedding_generations from cascading — evidence about a past event outlives
-- the thing it describes.
--
-- Nullable, and deliberately not back-filled: every plan generated before CP3
-- has no grounding, and an ungrounded generation is a first-class outcome
-- (D18) rather than a gap to be repaired.
--
-- Additive and idempotent. No RLS change — lesson_plans already has its
-- tenant_isolation policy, and a new column inherits it. No SECURITY DEFINER
-- functions; count stays at 22.

ALTER TABLE "lesson_plans" ADD COLUMN IF NOT EXISTS "grounded_on" JSONB;
