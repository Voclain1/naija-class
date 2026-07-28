-- Closes a Phase 2 slice 9 RBAC rollup gap: the `teacher` system role has
-- never held `grading-scheme.read`, but every teacher's gradebook grid
-- (GradebookGridPage) unconditionally calls GET /grading-scheme (guarded by
-- `@Permissions("grading-scheme.read")`) to read the components/weights it
-- renders. Every real teacher account has therefore 403'd the moment they
-- opened any subject's gradebook, since the role was created in
-- 20260530120000_phase_1_slice_10_teacher_profiles and re-set (without this
-- permission) by 20260609120000_phase_2_slice_9_rbac_rollup.
--
-- Found during the Phase 4 design-system restyle's mandatory live-
-- verification pass (2026-07-28) — see docs/deferred.md and
-- packages/types/src/permissions.ts's PHASE_2_TEACHER_PERMISSIONS header
-- comment for the full trail. Read-only grant: teachers do NOT get
-- `grading-scheme.update` (scheme/weight configuration stays owner/admin).
--
-- DATA migration (no schema diff), same idempotent full-literal-UPDATE
-- pattern as 20260609120000_phase_2_slice_9_rbac_rollup — system roles are
-- global singletons (school_id IS NULL, is_system = true), exactly one row
-- per key. This literal MUST stay in sync with PHASE_2_TEACHER_PERMISSIONS +
-- the teacher seed in packages/db/src/seeds/system-roles.ts (which seeds a
-- fresh `db:seed`); this migration covers existing/CI databases via
-- `migrate deploy`. If you edit one list, edit both.
--
-- Idempotent: re-running rewrites the same JSON.

UPDATE "roles"
SET
  "permissions" = '[
    "class-arm.read","class-level.read","subject.read","class-subject.read",
    "teacher-assignment.read","teacher-profile.self.read","teacher-profile.self.update",
    "student.read","enrollment.read",
    "assessment.read","assessment-score.read","assessment-score.create","assessment-score.update",
    "assessment.sign-off","assessment.aggregate",
    "attendance.read","attendance.mark",
    "subject-attendance.read","subject-attendance.mark",
    "report-card.read","report-card.form-review","report-card.comment",
    "grading-scheme.read"
  ]'::jsonb,
  "description" = 'Teaching staff — read-scoped access to their assigned arms, subjects, and roster, self-service on their own profile, plus the Phase 2 score/attendance/report-card actions for their own arms (the service narrows these to scope). Phase 2 slice 9 RBAC rollup (grading-scheme.read added 2026-07-28, closing a slice-9 gap).'
WHERE "school_id" IS NULL
  AND "key" = 'teacher'
  AND "is_system" = true;
