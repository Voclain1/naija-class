-- Phase 5 / Slice 5 — weekly parent progress summary.
--
-- Plan-first: docs/modules/phase-5.md §11 (D16, locked 2026-08-13).
--
-- This is the first AI output in the product that reaches a person outside
-- the school with no staff member in between. Everything unusual about this
-- migration follows from that one fact:
--
--   * schools.parent_summary_enabled defaults FALSE — the opposite of
--     schools.ai_enabled, which slice 1 defaulted TRUE. AI features that
--     produce a teacher's draft can be on by default because a teacher reads
--     them before anyone else does. This one cannot.
--
--   * parent_summaries has no suggested/accepted split, unlike slices 3-4's
--     use of ai_interaction_logs. The row IS the delivered artifact. The
--     school-level opt-in is the control, and it is the only one.
--
--   * The unique constraint on (school_id, student_id, week_start) is not
--     tidiness — it is what makes the weekly cron idempotent. A retried,
--     double-scheduled, or manually re-run sweep must not bill a school twice
--     for the same child's week, and must not deliver the same note twice.

-- =========================================================================
-- 1. schools — the opt-in
-- =========================================================================
ALTER TABLE "schools"
  ADD COLUMN "parent_summary_enabled" BOOLEAN NOT NULL DEFAULT false;

-- =========================================================================
-- 2. parent_summaries
-- =========================================================================
-- week_start is DATE, not TIMESTAMP(3): a summary covers a calendar week, not
-- a moment (CLAUDE.md "Prisma column types in raw SQL"). Always the Monday of
-- the covered week in UTC; the week covered is [week_start, week_start + 7).
--
-- summary is NOT NULL — there is no draft state here, so a row exists only
-- once there is something a parent can read. A failed generation writes
-- nothing and the next sweep retries that week.
--
-- emailed_at NULL is an ordinary state, not an error: the school may have
-- email notifications off, no guardian may have an email address on file, or
-- a send may have failed. The portal reads the row either way; this column
-- exists so a re-run does not re-send and so "did they actually get it?" has
-- an answer.

CREATE TABLE "parent_summaries" (
  "id"             TEXT         NOT NULL,
  "school_id"      TEXT         NOT NULL,
  "student_id"     TEXT         NOT NULL,
  "week_start"     DATE         NOT NULL,
  "summary"        TEXT         NOT NULL,
  "prompt_version" TEXT         NOT NULL,
  "emailed_at"     TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "parent_summaries_pkey" PRIMARY KEY ("id")
);

-- Idempotency for the weekly sweep. See the header.
CREATE UNIQUE INDEX "parent_summaries_school_id_student_id_week_start_key"
  ON "parent_summaries"("school_id", "student_id", "week_start");

CREATE INDEX "parent_summaries_school_id_idx"
  ON "parent_summaries"("school_id");

-- The portal's read: one child's notes, newest first.
CREATE INDEX "parent_summaries_school_id_student_id_week_start_idx"
  ON "parent_summaries"("school_id", "student_id", "week_start");

-- Cascade: a deleted student's weekly notes have no reader and are not
-- recoverable content. Deliberately different from ai_generations, which
-- survives content deletion because it is the record that money was spent —
-- that ledger row still exists after this cascade fires, which is correct.
ALTER TABLE "parent_summaries"
  ADD CONSTRAINT "parent_summaries_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- app_user grants: ALTER DEFAULT PRIVILEGES auto-grants on tables created by
-- school_kit — no manual GRANT needed (same note as slice 1 CP2 / slice 2).

-- =========================================================================
-- 3. RLS — flat school_id policy
-- =========================================================================
-- Mirrors packages/db/prisma/policies/phase-5.sql. parent_summaries carries
-- its own school_id, so this is the cheap direct-column check. FORCE so the
-- migration role cannot bypass it either.
--
-- Worth stating plainly for this table specifically: RLS here is the boundary
-- between one school's children and another's, on rows that are readable by
-- people OUTSIDE the school (guardians, through the portal). Cross-family
-- isolation within a school is a separate control — withGuardian() — and
-- neither substitutes for the other. See phase-4.md Decision B.

ALTER TABLE "parent_summaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parent_summaries" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON parent_summaries
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- =========================================================================
-- 4. RBAC rollup — parent-summary.read / parent-summary.manage
-- =========================================================================
-- Two permissions, and the split mirrors the reasoning slice 3 used for
-- report-card-comment.generate vs .write, applied to a different axis:
--
--   parent-summary.read    — see what was sent to parents. Admin/owner, and
--                            teacher, because a form teacher fielding "the
--                            school said my child was late twice" needs to be
--                            able to read the note the parent is holding.
--   parent-summary.manage  — turn the feature on or off for the school, and
--                            trigger a manual re-run. Admin/owner only: this
--                            is the switch that decides whether unattended AI
--                            output reaches parents at all (D16), which is an
--                            operator decision, not a teaching one.
--
-- Owner already holds '*'. packages/db/src/seeds/system-roles.ts is updated in
-- the same PR so a fresh `pnpm db:seed` matches this UPDATE exactly.

UPDATE "roles"
SET "permissions" = "permissions" || '["parent-summary.read","parent-summary.manage"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["parent-summary.read"]'::jsonb);

UPDATE "roles"
SET "permissions" = "permissions" || '["parent-summary.read"]'::jsonb
WHERE "key" = 'teacher'
  AND "is_system" = true
  AND NOT ("permissions" @> '["parent-summary.read"]'::jsonb);
