-- Phase 5 / Slice 2 — Lesson plan generator (the first AI FEATURE).
--
-- Plan-first: docs/modules/phase-5.md. This slice leads the feature sequence
-- because it is the only one of ARCHITECTURE.md §7's five features with ZERO
-- dependency on data a school has already entered — it works for a school on
-- its first day, before a single assessment score exists.
--
-- Topic is FREE TEXT, deliberately (phase-5.md D13). No Topic table, no
-- syllabus tree, no taxonomy. See the schema.prisma header comment for why
-- inventing one now would be premature and would retroactively constrain
-- MasteryRecord.topicRef.

-- =========================================================================
-- 1. ai_budget_periods — non-negativity CHECK (defence in depth)
-- =========================================================================
-- Slice 1 CP2 shipped the budget counter with reconciliation arithmetic in
-- AiGenerationService.settle():
--
--   tokens_reserved = GREATEST(0, tokens_reserved - <reserved> + <actual>)
--
-- That GREATEST() SILENTLY CLAMPS a counter that would otherwise go negative.
-- Silent clamping hides exactly the bug worth knowing about: a
-- double-settle, or a settle whose reservation does not match the one the
-- reserve step actually took, would quietly corrupt the counter and
-- under-report a school's spend rather than failing loudly.
--
-- These constraints make that case an error instead. They are a genuine
-- second line of defence, but be precise about what they do and do NOT do:
--
--   THEY DO     catch reconciliation arithmetic driving a counter below zero.
--   THEY DO NOT backstop the monthly cap itself. A CHECK constraint cannot
--               reference another table, and the budget lives on
--               schools.ai_monthly_token_budget — so "tokens_reserved <=
--               budget" is not expressible here. Cap enforcement remains the
--               conditional atomic UPDATE in AiGenerationService.reserve(),
--               which is proven race-free by the concurrency spec.
--
-- Added in slice 2 rather than slice 1 only because the need became clear
-- once the reconciliation path existed to look at.

ALTER TABLE "ai_budget_periods"
  ADD CONSTRAINT "ai_budget_periods_tokens_reserved_non_negative"
  CHECK ("tokens_reserved" >= 0);

ALTER TABLE "ai_budget_periods"
  ADD CONSTRAINT "ai_budget_periods_tokens_actual_non_negative"
  CHECK ("tokens_actual" >= 0);

ALTER TABLE "ai_budget_periods"
  ADD CONSTRAINT "ai_budget_periods_call_count_non_negative"
  CHECK ("call_count" >= 0);

-- =========================================================================
-- 2. lesson_plans
-- =========================================================================
-- The five content columns mirror ARCHITECTURE.md §7's specified output
-- ("intro, main content, activities, assessment, homework"). Separate columns
-- rather than one JSON blob because the teacher edits and regenerates them
-- INDIVIDUALLY — a blob would make a per-section update a read-modify-write
-- race between two open tabs.
--
-- All content columns are nullable: the row is created when generation is
-- requested, so a failed generation leaves an inspectable record rather than
-- disappearing.

CREATE TYPE "LessonPlanStatus" AS ENUM ('DRAFT', 'ACCEPTED');

CREATE TABLE "lesson_plans" (
    "id"               TEXT NOT NULL,
    "school_id"        TEXT NOT NULL,
    "created_by"       TEXT NOT NULL,
    "class_level_id"   TEXT NOT NULL,
    "subject_id"       TEXT NOT NULL,
    "topic"            TEXT NOT NULL,
    "objectives"       TEXT,
    "duration_minutes" INTEGER,
    "status"           "LessonPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "introduction"     TEXT,
    "main_content"     TEXT,
    "activities"       TEXT,
    "assessment"       TEXT,
    "homework"         TEXT,
    "quiz"             TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lesson_plans_school_id_idx"
  ON "lesson_plans"("school_id");
-- Serves "my lesson plans" — the teacher's own list is the primary read.
CREATE INDEX "lesson_plans_school_id_created_by_idx"
  ON "lesson_plans"("school_id", "created_by");
-- Serves the level+subject filter on the browse screen.
CREATE INDEX "lesson_plans_school_id_class_level_id_subject_id_idx"
  ON "lesson_plans"("school_id", "class_level_id", "subject_id");

-- Cascade matches class_subjects' convention: deleting a subject or class
-- level already cascades class_subjects, and a lesson plan scoped to a
-- level/subject that no longer exists has no valid curriculum context.
ALTER TABLE "lesson_plans"
  ADD CONSTRAINT "lesson_plans_class_level_id_fkey"
  FOREIGN KEY ("class_level_id") REFERENCES "class_levels"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lesson_plans"
  ADD CONSTRAINT "lesson_plans_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- app_user grants: ALTER DEFAULT PRIVILEGES auto-grants on tables created by
-- school_kit — no manual GRANT needed (same note as slice 1 CP2).

-- =========================================================================
-- 3. RLS — flat school_id policy
-- =========================================================================
-- Mirrors packages/db/prisma/policies/phase-5.sql. lesson_plans carries its
-- own school_id, so this is the cheap direct-column check rather than an
-- EXISTS-through-class_levels subquery. FORCE so the migration role cannot
-- bypass it either.

ALTER TABLE "lesson_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lesson_plans" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lesson_plans
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- =========================================================================
-- 4. RBAC rollup — grant the Phase 5 permissions
-- =========================================================================
-- Slice 1 CP2 landed PHASE_5_PERMISSIONS as REFERENCE-ONLY because it shipped
-- no HTTP surface. This slice DOES expose endpoints, so the rollup happens
-- here: same idempotent pattern as every prior RBAC-rollup migration, and
-- packages/db/src/seeds/system-roles.ts is updated in the same PR so a fresh
-- `pnpm db:seed` matches this UPDATE exactly.
--
-- TEACHER is granted lesson-plan.* — this is the first Phase 5 permission set
-- and it is teacher-facing by definition; a lesson plan generator that only
-- admins could use would have no users. Owner already holds '*'.
--
-- ai-usage.read is admin/owner only: it exposes school-level spend, which is
-- operator information rather than teaching workflow.

UPDATE "roles"
SET "permissions" = "permissions" || '["lesson-plan.read","lesson-plan.create","lesson-plan.update","lesson-plan.delete","ai-usage.read"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["lesson-plan.read"]'::jsonb);

UPDATE "roles"
SET "permissions" = "permissions" || '["lesson-plan.read","lesson-plan.create","lesson-plan.update","lesson-plan.delete"]'::jsonb
WHERE "key" = 'teacher'
  AND "is_system" = true
  AND NOT ("permissions" @> '["lesson-plan.read"]'::jsonb);
