-- =========================================================================
-- Phase 5 / Slice 3 — report-card subject comments: RBAC rollup
-- =========================================================================
-- NO SCHEMA CHANGE IN THIS SLICE. That is the point of it: the suggestion
-- lives in the existing `ai_interaction_logs` (shipped Phase 1, empty until
-- now) and acceptance writes the existing `assessments.subject_comment`
-- column, which has carried an "AI-hook-ready (Phase 5)" comment since Phase 2.
-- So this migration grants permissions and nothing else — no new table, no new
-- RLS policy, no new SECURITY DEFINER function (count stays at 16).
--
-- Two permissions rather than one, because the actions have different stakes:
--   * report-card-comment.generate — spends the school's AI token budget
--     (a whole arm is one call per student).
--   * report-card-comment.write    — puts text into a student's permanent
--     termly record, and is the teacher-approval gate CLAUDE.md's AI hard rule
--     requires for report-card comments specifically.
-- Splitting them lets a school have comments drafted centrally but accepted by
-- the subject teacher. A single `report-card-comment.manage` could not express
-- that, and the pair costs nothing to carry.
--
-- TEACHER gets both: the subject teacher is the only person who knows whether
-- a drafted comment is true of the student in front of them, and granting
-- `.generate` alone would leave a teacher able to spend budget on drafts they
-- could not then use. Owner already holds '*'.
--
-- Same idempotent pattern as every prior RBAC-rollup migration, and
-- packages/db/src/seeds/system-roles.ts is updated in the same PR so a fresh
-- `pnpm db:seed` matches this UPDATE exactly.

UPDATE "roles"
SET "permissions" = "permissions" || '["report-card-comment.generate","report-card-comment.write"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["report-card-comment.generate"]'::jsonb);

UPDATE "roles"
SET "permissions" = "permissions" || '["report-card-comment.generate","report-card-comment.write"]'::jsonb
WHERE "key" = 'teacher'
  AND "is_system" = true
  AND NOT ("permissions" @> '["report-card-comment.generate"]'::jsonb);
