-- Phase 1 / Slice 13 — RBAC rollup: grant the Phase 1 permission set to the
-- existing global `admin` system role.
--
-- This is a DATA migration (no schema diff). System roles are global
-- singletons (school_id IS NULL, is_system = true) referenced by every
-- tenant's user_roles, so there is exactly ONE admin row to update — no
-- per-school loop. Same discipline as the slice-10 teacher-role seed.
--
-- The permission list below is the literal of
--   [...PHASE_0_PERMISSIONS, ...PHASE_1_PERMISSIONS]
-- MINUS the owner-only history-bearing deletes (academic-year.delete,
-- term.delete, enrollment.delete — see OWNER_ONLY_PERMISSIONS in
-- packages/types/src/permissions.ts). It MUST stay in sync with
-- ADMIN_PERMISSIONS in packages/db/prisma/seed-data.ts (which seeds a fresh
-- `db:seed`); this migration covers existing / CI databases via `migrate
-- deploy`. If you edit one permission list, edit both.
--
-- Idempotent: a plain UPDATE of a single row by stable key. Re-running it
-- (e.g. `migrate deploy` after a reset) simply rewrites the same JSON.

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
    "mastery.read","ai-interaction.read"
  ]'::jsonb,
  "description" = 'School administrator — every Phase 0 + Phase 1 permission except the owner-only history-bearing deletes (academic-year/term/enrollment) and school deletion (TODO when school.delete lands).'
WHERE "school_id" IS NULL
  AND "key" = 'admin'
  AND "is_system" = true;
