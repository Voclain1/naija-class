-- Phase 2 / Slice 9 — RBAC rollup: grant the Phase 2 permission set to the
-- existing global `admin` and `teacher` system roles.
--
-- DATA migration (no schema diff), mirroring
-- 20260601130000_phase_1_slice_13_admin_rbac_rollup. System roles are global
-- singletons (school_id IS NULL, is_system = true) referenced by every tenant's
-- user_roles, so there is exactly ONE row per key to update — no per-school loop.
--
-- `owner` is unchanged (its `["*"]` wildcard already grants every Phase 2
-- permission). `admin` gets every Phase 0+1+2 permission MINUS the owner-only
-- ones (Phase 1 history-bearing deletes + Phase 2 report-card.reopen). `teacher`
-- gets its Phase 1 read-scope set PLUS the Phase 2 teacher subset
-- (PHASE_2_TEACHER_PERMISSIONS) — granted at the guard, narrowed to the
-- teacher's own (arm, subject) by getTeacherScope in the service.
--
-- These literals MUST stay in sync with ADMIN_PERMISSIONS + the teacher seed in
-- packages/db/src/seeds/system-roles.ts (which seeds a fresh `db:seed`); this
-- migration covers existing / CI databases via `migrate deploy`. If you edit one
-- list, edit both.
--
-- Idempotent: a plain full-literal UPDATE of a single row by stable key.
-- Re-running it simply rewrites the same JSON.

UPDATE "roles"
SET
  "permissions" = '[
    "school.read","school.update",
    "branch.read","branch.create","branch.update","branch.delete",
    "user.read","user.invite","user.update","user.deactivate",
    "role.read","role.update",
    "audit.read",
    "academic-year.read","academic-year.create","academic-year.update",
    "term.read","term.create","term.update",
    "class-level.read","class-level.create","class-level.update","class-level.delete",
    "class-arm.read","class-arm.create","class-arm.update","class-arm.delete",
    "subject.read","subject.create","subject.update","subject.delete",
    "class-subject.read","class-subject.create","class-subject.update","class-subject.delete",
    "teacher-assignment.read","teacher-assignment.create","teacher-assignment.update","teacher-assignment.delete",
    "student.read","student.create","student.update","student.deactivate","student.import",
    "guardian.read","guardian.create","guardian.update","guardian.delete","guardian.import",
    "enrollment.read","enrollment.create","enrollment.update",
    "teacher-profile.read","teacher-profile.create","teacher-profile.update","teacher-profile.delete",
    "teacher.import",
    "teacher-profile.self.read","teacher-profile.self.update",
    "mastery.read","ai-interaction.read",
    "grading-scheme.read","grading-scheme.update",
    "grading-component.read","grading-component.create","grading-component.update","grading-component.delete",
    "grade-boundary.read","grade-boundary.update",
    "assessment.read","assessment-score.read","assessment-score.create","assessment-score.update","assessment.sign-off","assessment.aggregate",
    "attendance.read","attendance.mark",
    "subject-attendance.read","subject-attendance.mark",
    "report-card.read","report-card.build","report-card.form-review","report-card.principal-approve","report-card.release","report-card.comment"
  ]'::jsonb,
  "description" = 'School administrator — every Phase 0 + Phase 1 + Phase 2 permission except the owner-only history-bearing deletes (academic-year/term/enrollment), report-card.reopen, and school deletion (TODO when school.delete lands).'
WHERE "school_id" IS NULL
  AND "key" = 'admin'
  AND "is_system" = true;

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
    "report-card.read","report-card.form-review","report-card.comment"
  ]'::jsonb,
  "description" = 'Teaching staff — read-scoped access to their assigned arms, subjects, and roster, self-service on their own profile, plus the Phase 2 score/attendance/report-card actions for their own arms (the service narrows these to scope). Phase 2 slice 9 RBAC rollup.'
WHERE "school_id" IS NULL
  AND "key" = 'teacher'
  AND "is_system" = true;
