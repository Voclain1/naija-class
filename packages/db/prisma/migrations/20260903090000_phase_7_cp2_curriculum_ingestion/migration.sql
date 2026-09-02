-- Phase 7 / CP2 — curriculum document ingestion.
--
-- CP1 created curriculum_documents, curriculum_chunks and embedding_generations
-- with their RLS policies and the HNSW index. This migration adds only what the
-- ingestion PIPELINE needs on top of that:
--
--   1. An index supporting the duplicate-upload check.
--   2. The RBAC rollup for the new curriculum.* permissions.
--
-- No new tables, no new SECURITY DEFINER functions. The SECURITY DEFINER count
-- stays at 22 and the next inventory review stays due at 23 — worth stating
-- explicitly, because "a new phase landed" is exactly when that count is
-- assumed to have moved.

-- =========================================================================
-- 1. Duplicate-upload index
-- =========================================================================
-- curriculum.service.ts checks for an existing live document with the same
-- content checksum before accepting an upload, so a teacher who re-sends a file
-- they already sent is told it is already there rather than paying to embed it
-- twice.
--
-- Without this index that check is a sequential scan of the school's documents
-- on every single upload. The volumes are small (a 200-document cap), so this
-- is cheap insurance rather than a fix for an observed problem — but it is the
-- index the query was written to use.
--
-- NOT a unique constraint, deliberately. The same scheme of work legitimately
-- appears under two class levels, and a school that deletes a document must be
-- able to re-upload it. Uniqueness would turn both of those into errors; the
-- service-level check refuses only documents that are still LIVE.
CREATE INDEX IF NOT EXISTS "curriculum_documents_school_id_checksum_idx"
  ON "curriculum_documents" ("school_id", "checksum");

-- =========================================================================
-- 2. RBAC rollup — grant the Phase 7 permissions
-- =========================================================================
-- Same idempotent pattern as every prior RBAC-rollup migration, and
-- packages/db/src/seeds/system-roles.ts is updated in the same PR so a fresh
-- `pnpm db:seed` produces exactly what this UPDATE does.
--
-- TEACHER gets curriculum.read + curriculum.upload but NOT curriculum.delete.
-- Uploading a scheme of work is a teaching act — the teacher who works from a
-- document is the one who knows whether it is current — but deleting one
-- cascades its chunks and silently changes what every OTHER teacher's lesson
-- plans are grounded in. That is a shared-corpus effect the deleter cannot see,
-- so the action with the wider blast radius gets the narrower grant. Same
-- instinct that split report-card-comment.generate from .write.
--
-- Owner already holds '*'.

UPDATE "roles"
SET "permissions" = "permissions" || '["curriculum.read","curriculum.upload","curriculum.delete"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["curriculum.read"]'::jsonb);

UPDATE "roles"
SET "permissions" = "permissions" || '["curriculum.read","curriculum.upload"]'::jsonb
WHERE "key" = 'teacher'
  AND "is_system" = true
  AND NOT ("permissions" @> '["curriculum.read"]'::jsonb);
