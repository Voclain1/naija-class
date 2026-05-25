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

export const ALL_PERMISSIONS = [...PHASE_0_PERMISSIONS] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number] | "*";

export const PERMISSION_WILDCARD: Permission = "*";
