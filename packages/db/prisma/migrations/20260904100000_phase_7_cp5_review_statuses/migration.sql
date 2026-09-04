-- Phase 7 / CP5 — the two new lifecycle stops, ALONE in their own migration.
--
-- WHY THIS IS SPLIT FROM THE REST OF CP5 (and must stay split):
-- Prisma wraps each migration file in a transaction. PostgreSQL permits
-- `ALTER TYPE ... ADD VALUE` inside a transaction, but it REFUSES to let the
-- new value be USED in that same transaction ("unsafe use of new value of enum
-- type"). The companion migration creates a partial index whose predicate is
-- `status = 'AWAITING_REVIEW'` — a use. Kept together, the pair fails on a
-- fresh database while appearing to work on one where the enum already had the
-- values. Splitting them is the fix, not a stylistic preference.
--
-- IF NOT EXISTS makes both statements safe to re-run.

ALTER TYPE "CurriculumDocumentStatus" ADD VALUE IF NOT EXISTS 'AWAITING_REVIEW' AFTER 'PROCESSING';
ALTER TYPE "CurriculumDocumentStatus" ADD VALUE IF NOT EXISTS 'EMBEDDING' AFTER 'AWAITING_REVIEW';
