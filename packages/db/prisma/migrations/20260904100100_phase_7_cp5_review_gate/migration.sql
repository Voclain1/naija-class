-- Phase 7 / CP5 — the curriculum review gate.
--
-- A teacher confirms the term/week/topic structure the parser extracted BEFORE
-- the document is embedded and becomes usable for lesson planning. See
-- docs/modules/phase-7.md D28-D35. Depends on the enum values added by
-- 20260904100000_phase_7_cp5_review_statuses — see that file for why the two
-- cannot be one migration.
--
-- Every statement is additive and idempotent. Nothing here rewrites an existing
-- row: D34 grandfathers documents that predate the gate, which stay READY with
-- reviewed_at NULL.

-- 1. Who approved, and when.
--    reviewed_at NULL is MEANINGFUL (D34) — "predates the gate", not "missing".
--    Deliberately NOT a declared FK to users: uploaded_by beside it is a plain
--    scoping column too, and a deactivated staff member must not block the row.
ALTER TABLE "curriculum_documents"
  ADD COLUMN IF NOT EXISTS "reviewed_by" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);

-- 2. What the teacher changed before approving (D31).
--    These are the measurement, not decoration: zero edits is evidence the
--    chunker read the document correctly, and no synthetic fixture can produce
--    that evidence.
ALTER TABLE "curriculum_documents"
  ADD COLUMN IF NOT EXISTS "heading_edit_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discarded_chunk_count" INTEGER NOT NULL DEFAULT 0;

-- 3. A chunk may now exist without a vector (D29).
--    Dropping NOT NULL is safe on existing rows: every row currently holds a
--    vector and keeps it. The invariant it enforced moves up to the document
--    status, and retrieval additionally filters `embedding IS NOT NULL` so a
--    query that forgets the status filter still cannot return a draft chunk.
ALTER TABLE "curriculum_chunks"
  ALTER COLUMN "embedding" DROP NOT NULL;

-- 4. Find documents waiting on a human, per school, without a sequential scan.
--    Partial: the queue is by definition a small slice of the table, and this
--    index backs the "Needs your review" surface D35 relies on instead of an
--    expiry job.
CREATE INDEX IF NOT EXISTS "curriculum_documents_awaiting_review_idx"
  ON "curriculum_documents" ("school_id", "created_at")
  WHERE "status" = 'AWAITING_REVIEW';
