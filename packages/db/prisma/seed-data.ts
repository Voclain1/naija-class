// Static seed data. Kept separate from seed.ts so it can be imported from
// tests (e.g. to assert the 'owner' role row exists) without running the seed
// routine as a side effect.

import { PHASE_0_PERMISSIONS } from "@school-kit/types";

export interface SystemRoleSeed {
  key: string;
  name: string;
  description: string;
  permissions: readonly string[];
}

// System roles are global (school_id = NULL, is_system = true) and referenced
// by `key`. Per docs/modules/phase-0.md → RBAC → Seeded roles.
//
// `owner` is the wildcard role attached to the user who signs up the school.
// `admin` carries every Phase 0 permission. The spec calls out "except
// school.delete", which doesn't exist yet as a permission — preserved here as
// a TODO comment so the intent isn't lost when school.delete lands.
export const SYSTEM_ROLE_SEEDS: SystemRoleSeed[] = [
  {
    key: "owner",
    name: "Owner",
    description: "School owner — full access to everything in the tenant.",
    permissions: ["*"],
  },
  {
    key: "admin",
    name: "Administrator",
    description:
      "School administrator — every Phase 0 permission except school deletion (TODO when school.delete lands).",
    permissions: [...PHASE_0_PERMISSIONS],
  },
  // Phase 1 / Slice 10 — minimal `teacher` role. Read-scoped access to a
  // teacher's own arms/subjects/roster + self-service on their profile (per
  // phase-1.md:1087). Pulled forward into slice 10 (rather than the slice-13
  // RBAC rollup) because without it invitation-accept of a teacher rolls back
  // and class-arms' assertUserIsTeacher always fails — the whole staff branch
  // is untestable. The full permission rollup + existing-school role migration
  // stays slice 13. Kept IN SYNC with the idempotent seed in
  // prisma/migrations/20260530120000_phase_1_slice_10_teacher_profiles
  // (the migration covers existing/CI DBs via `migrate deploy`; this covers a
  // fresh `db:seed`). If you edit one permission list, edit both.
  {
    key: "teacher",
    name: "Teacher",
    description:
      "Teaching staff — read-scoped access to their assigned arms, subjects, and roster, plus self-service on their own profile. Full RBAC rollup lands in slice 13.",
    permissions: [
      "class-arm.read",
      "class-level.read",
      "subject.read",
      "class-subject.read",
      "teacher-assignment.read",
      "teacher-profile.self.read",
      "teacher-profile.self.update",
      "student.read",
      "enrollment.read",
    ],
  },
];
