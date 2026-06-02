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

// Phase 1 canonical permission rollup. Slice 13 consolidates here every
// permission string introduced across slices 1–12 — the earlier slices landed
// their strings as reference-only `PHASE_1_SLICE_N_PERMISSIONS` constants (or,
// for slices 1/2/5 and the AI-foundation reads, did not land them at all),
// deferring the load-bearing wiring to this one auditable diff (per the
// slice-13 entry in docs/modules/phase-1.md). This array is now the single
// source of truth — it is granted to the `admin` role (minus the owner-only
// deletes) in packages/db/prisma/seed-data.ts and enforced by the
// PermissionsGuard. Mirrors docs/modules/phase-1.md "RBAC implementation →
// New permission strings".
//
// Notes carried forward from the per-slice constants:
//   - `class-subject.update` is a slice-3 addition over the spec enumeration:
//     the matrix UI's PATCH-isCore endpoint needs a permission to gate against
//     (modelling the toggle as delete+create was ruled out).
//   - `student.delete` is intentionally absent — owner-only hard-delete on
//     history-bearing tables is deferred; withdraw/graduate/reactivate are the
//     modelled lifecycle exits, gated by `student.deactivate`.
//   - `teacher-profile.self.*` is the teacher self-service surface
//     (GET/PATCH /teacher-profiles/me), granted to the `teacher` role.
//   - `*.delete` on history-bearing tables (academic-year, term, enrollment)
//     is owner-only — see OWNER_ONLY_PERMISSIONS below. teacher-assignment /
//     teacher-profile / guardian / class-* deletes are admin-scoped (they
//     leave history in audit_logs).
export const PHASE_1_PERMISSIONS = [
  // Academic structure
  "academic-year.read",
  "academic-year.create",
  "academic-year.update",
  "academic-year.delete",
  "term.read",
  "term.create",
  "term.update",
  "term.delete",
  "class-level.read",
  "class-level.create",
  "class-level.update",
  "class-level.delete",
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
  "teacher-assignment.read",
  "teacher-assignment.create",
  "teacher-assignment.update",
  "teacher-assignment.delete",

  // Roster
  "student.read",
  "student.create",
  "student.update",
  "student.deactivate",
  "student.import",
  "guardian.read",
  "guardian.create",
  "guardian.update",
  "guardian.delete",
  "guardian.import",
  "enrollment.read",
  "enrollment.create",
  "enrollment.update",
  "enrollment.delete",

  // Staff
  "teacher-profile.read",
  "teacher-profile.create",
  "teacher-profile.update",
  "teacher-profile.delete",
  "teacher.import",
  "teacher-profile.self.read",
  "teacher-profile.self.update",

  // AI foundation (Phase 5 extends)
  "mastery.read",
  "ai-interaction.read",
] as const;

// History-bearing hard-deletes are owner-only. The `admin` role seed is the
// Phase 1 rollup MINUS these; the PermissionsGuard then denies admin on the
// delete endpoints (owner passes via the `*` wildcard). `student.delete` is
// not listed because it is not a permission at all (no endpoint exposed it).
export const OWNER_ONLY_PERMISSIONS = [
  "academic-year.delete",
  "term.delete",
  "enrollment.delete",
] as const;

// Phase 2 / Slice 1 — grading configuration permissions. REFERENCE-ONLY for
// now: this constant is NOT yet spread into ALL_PERMISSIONS, NOT granted to any
// seeded role, and NOT enforced by a guard. The grading controller gates via
// assertUserActiveAndHasOneOf(['owner','admin']) at the service layer (the
// slice-1-era pattern), exactly as Phase 1 slice 1 did before the slice-13
// PermissionsGuard retrofit. The Phase 2 RBAC rollup (slice 9) consolidates
// every PHASE_2_SLICE_N constant, spreads them into ALL_PERMISSIONS, grants
// them to admin in the seed + a data migration, and wires @Permissions onto
// these handlers — mirroring the Phase 1 slice-13 rollup. Landing the strings
// here now keeps them discoverable for that diff.
export const PHASE_2_SLICE_1_PERMISSIONS = [
  "grading-scheme.read",
  "grading-scheme.update",
  "grading-component.read",
  "grading-component.create",
  "grading-component.update",
  "grading-component.delete",
  "grade-boundary.read",
  "grade-boundary.update",
] as const;

// Phase 2 / Slice 2 — assessment score-entry permissions. REFERENCE-ONLY (not
// in ALL_PERMISSIONS, not granted to a role, not guarded) until the slice-9
// rollup, exactly like PHASE_2_SLICE_1_PERMISSIONS. The slice-2 controllers
// (cp2/cp3) gate via assertUserActiveAndHasOneOf(['owner','admin','teacher'])
// with the teacher-scope pre-check; admins/owners are unscoped. `assessment.aggregate`
// is intentionally absent here — it belongs to slice 4's aggregation pass.
export const PHASE_2_SLICE_2_PERMISSIONS = [
  "assessment.read",
  "assessment-score.create",
  "assessment-score.update",
  "assessment.sign-off",
] as const;

export const ALL_PERMISSIONS = [
  ...PHASE_0_PERMISSIONS,
  ...PHASE_1_PERMISSIONS,
  /* PHASE_2_SLICE_1_PERMISSIONS + PHASE_2_SLICE_2_PERMISSIONS folded in by the slice-9 rollup */
  /* extend per phase */
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number] | "*";

export const PERMISSION_WILDCARD: Permission = "*";
