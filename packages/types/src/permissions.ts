// Permission strings. Canonical source — referenced by:
//   - apps/api guards (`@Permissions(...)`)
//   - packages/db seed (system role permission lists)
//
// Phases extend this list as new resources land. The `*` wildcard is a magic
// value used by the `owner` role to mean "every permission."

export const PHASE_0_PERMISSIONS = [
  "school.read",
  "school.update",
  "branch.read",
  "branch.create",
  "branch.update",
  "branch.delete",
  "user.read",
  "user.invite",
  "user.update",
  "user.deactivate",
  "role.read",
  "role.update",
  "audit.read",
] as const;

// Phase 1 slice 3 contributes class-arm + subject + class-subject permission
// strings. These are reference-only until slice 13 wires the PermissionsGuard
// and gathers the canonical Phase 1 permission rollup across all slices (per
// the slice-13 entry in docs/modules/phase-1.md). Slices 1 and 2 deliberately
// did NOT land their permission constants in code — slice 13 owns that
// retroactive cleanup so every slice's strings arrive in one auditable diff.
//
// `class-subject.update` is a slice-3 addition over the spec's enumeration
// (docs/modules/phase-1.md line 1018, which lists only read/create/delete)
// because the matrix UI's PATCH-isCore endpoint needs a permission to gate
// against and modelling the toggle as delete+create has been ruled out — see
// packages/types/src/class-subjects/update-class-subject.dto.ts. Tracked
// against the running slice-3 spec-reconciliation list.
export const PHASE_1_SLICE_3_PERMISSIONS = [
  "class-arm.read",
  "class-arm.create",
  "class-arm.update",
  "class-arm.delete",
  "subject.read",
  "subject.create",
  "subject.update",
  "subject.delete",
  "class-subject.read",
  "class-subject.create",
  "class-subject.update",
  "class-subject.delete",
] as const;

// Phase 1 slice 4 contributes student permission strings. Reference-only
// until slice 13 wires PermissionsGuard. `student.delete` is intentionally
// absent — owner-only hard-delete is deferred (see docs/modules/phase-1.md
// "Updated seeded roles": delete on history-bearing tables is owner-scoped
// in slice 13). `student.deactivate` covers the named transitions
// (withdraw / graduate / reactivate) — they change roster state without
// removing rows. `student.import` lands with slice 6.
export const PHASE_1_SLICE_4_PERMISSIONS = [
  "student.read",
  "student.create",
  "student.update",
  "student.deactivate",
] as const;

// Phase 1 slice 6 contributes the student-import permission. Reference-only
// until slice 13 wires PermissionsGuard — until then the imports controller
// gates on owner/admin via assertUserActiveAndHasOneOf (same pattern as
// every prior Phase 1 slice).
export const PHASE_1_SLICE_6_PERMISSIONS = [
  "student.import",
] as const;

// Phase 1 slice 8 contributes the guardian-import permission. `teacher.import`
// is deferred to slice 10 — the Invitation table can't carry staffNumber /
// specialty per phase-1.md:478, so the spec's teacher-import shape needs
// TeacherProfile (slice 10) to land first. cp1 design call captured in the
// 2026-05-29 journal entry.
export const PHASE_1_SLICE_8_PERMISSIONS = [
  "guardian.import",
] as const;

// Phase 1 slice 9 contributes the enrollment permissions. Reference-only
// until slice 13 wires PermissionsGuard. `enrollment.delete` is
// owner-only per the slice 13 role table at phase-1.md:1086; the slice 9
// service accepts owner|admin (the same belt-and-braces pattern every
// prior Phase 1 slice uses) and slice 13 will tighten delete to owner.
export const PHASE_1_SLICE_9_PERMISSIONS = [
  "enrollment.read",
  "enrollment.create",
  "enrollment.update",
  "enrollment.delete",
] as const;

// Phase 1 slice 10 contributes the teacher-profile + teacher-import
// permissions. Reference-only until slice 13 wires PermissionsGuard — until
// then the controller gates on owner/admin via assertUserActiveAndHasOneOf
// (every prior Phase 1 slice uses this same belt-and-braces pattern). The
// two `*.self.*` strings are the teacher self-service surface (GET/PATCH
// /teacher-profiles/me) and are already granted to the minimal `teacher`
// role seeded in slice 10's migration (per phase-1.md:1087). `teacher.import`
// lands its endpoint in slice 10 cp2. `teacher-profile.delete` is the
// soft-delete (via User.isActive) path — admin-scoped, not owner-only,
// because it removes no history (the profile row is preserved).
export const PHASE_1_SLICE_10_PERMISSIONS = [
  "teacher-profile.read",
  "teacher-profile.create",
  "teacher-profile.update",
  "teacher-profile.delete",
  "teacher.import",
  "teacher-profile.self.read",
  "teacher-profile.self.update",
] as const;

// Phase 1 slice 11 contributes the teacher-assignment permissions.
// Reference-only until slice 13 wires PermissionsGuard — until then the
// controller gates on owner/admin via assertUserActiveAndHasOneOf (every
// prior Phase 1 slice uses this same belt-and-braces pattern). Note that
// `teacher-assignment.read` is ALREADY granted to the minimal `teacher`
// system role seeded in slice 10's migration (phase-1.md:1087) — the read-
// scoped teacher endpoints land in slice 11 cp2; this CRUD set is the
// admin-facing create/update/delete surface. `teacher-assignment.delete` is
// admin-scoped (not owner-only): a deleted assignment leaves history in
// audit_logs, so it is not a history-bearing hard-delete like
// student/enrollment/academic-year.
export const PHASE_1_SLICE_11_PERMISSIONS = [
  "teacher-assignment.read",
  "teacher-assignment.create",
  "teacher-assignment.update",
  "teacher-assignment.delete",
] as const;

export const ALL_PERMISSIONS = [...PHASE_0_PERMISSIONS] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number] | "*";

export const PERMISSION_WILDCARD: Permission = "*";
