-- Smart Student Import — schema support.
-- See docs/modules/smart-student-import.md.
--
-- Two additions, no new tables. The feature deliberately introduces no
-- storage of its own: the captured register image is never persisted (D3),
-- and the extracted rows live in the existing import_jobs.preview_snapshot
-- JSONB column until the admin commits them (D4).

-- ---------------------------------------------------------------------------
-- 1. STUDENTS_SCAN import job type.
--
-- A separate enum value rather than a discriminator column on STUDENTS,
-- because the two differ in LIFECYCLE and not merely in provenance: a
-- STUDENTS job has a source file in object storage and a column-mapping
-- step; a STUDENTS_SCAN job has neither. Keeping it on the enum the validate
-- worker already dispatches on means "does this job have a source file?"
-- stays answerable from the row itself, instead of from a second nullable
-- column that could contradict it.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
-- PostgreSQL < 12. We target 16, where it is permitted, so Prisma's implicit
-- per-migration transaction is fine here. It is still irreversible — an enum
-- value cannot be dropped — which is the usual reason to be sure the name is
-- right before it ships.
ALTER TYPE "ImportJobType" ADD VALUE 'STUDENTS_SCAN';

-- ---------------------------------------------------------------------------
-- 2. students.ai_extracted — extraction provenance.
--
-- TRUE when the row's values originated from a camera-captured register
-- transcribed by the model, rather than typed by a human or parsed from a
-- CSV the school produced.
--
-- Added WITH the feature rather than after it, on the same reasoning
-- phase-5.md D15 gives for report comments: "was this AI-drafted or
-- human-written?" is not a question you can retrofit an answer to. Once a
-- term of scanned intakes exists, no later migration can separate those rows
-- from hand-typed ones.
--
-- This is NOT a trust signal and nothing branches on it. Every scanned row
-- was reviewed and explicitly confirmed by an admin before it was written
-- (D4), so it is exactly as authoritative as a typed row. It exists so that
-- if a systematic extraction defect is ever found — a prompt version that
-- misread a date format, say — the affected population is identifiable
-- rather than hypothetical.
--
-- NOT NULL DEFAULT false, not nullable: every pre-existing student was
-- demonstrably not scanned, so there is no "unknown" state to represent, and
-- a nullable column would invite someone to invent one. The default also
-- makes this a metadata-only rewrite on PG 11+, so the backfill across
-- existing student rows is free.
ALTER TABLE "students" ADD COLUMN "ai_extracted" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- RLS: nothing to do, deliberately.
--
-- `students` and `import_jobs` both already carry FORCE ROW LEVEL SECURITY
-- with school_id-keyed policies. Adding a column to a table under RLS does
-- not require a policy change — policies gate ROWS, not columns — and this
-- migration creates no new table and no new SECURITY DEFINER function.
--
-- SECURITY DEFINER inventory count is therefore UNCHANGED at 20. The next
-- "+3" cadence review remains due at 23. This migration is noted here only
-- so a reader auditing the inventory can confirm it was considered and
-- correctly required nothing, rather than wondering whether it was missed.

-- ---------------------------------------------------------------------------
-- 3. Grant `student.scan` to the global `admin` system role.
--
-- `owner` needs nothing — it holds the "*" wildcard.
--
-- APPEND, not the full-literal UPDATE that
-- 20260728000000_teacher_grading_scheme_read_permission and the RBAC rollups
-- use. That pattern is right for `teacher` and `bursar`, whose grants are
-- short hand-maintained lists that a reviewer can diff against the
-- corresponding TS constant by eye. It is the wrong tool here: ADMIN_PERMISSIONS
-- in packages/db/src/seeds/system-roles.ts is COMPUTED — six constants spread
-- together with three `.filter(...)` exclusions applied — so a literal would be
-- a hand-transcribed snapshot of a derived list. It would be stale the next time
-- any phase adds a permission, and it would silently REVOKE anything added
-- between now and whenever this migration last ran on a given database.
--
-- Appending touches only the one permission this change is actually about, and
-- leaves every other grant exactly as the database already has it.
--
-- Idempotent via the NOT @> guard: re-running is a no-op rather than producing
-- ["student.scan","student.scan"].
UPDATE "roles"
SET "permissions" = "permissions" || '["student.scan"]'::jsonb
WHERE "school_id" IS NULL
  AND "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["student.scan"]'::jsonb);

-- Deliberately NOT granted to `teacher` or `bursar`. Bulk student intake is an
-- office task: `student.import` (which commits a scan's output) is already
-- owner/admin only, and granting the extraction more widely than the commit
-- would let a teacher spend the school's monthly AI budget producing rows they
-- have no permission to import.
