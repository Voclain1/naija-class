// Static system-role seed data. Lives in src/seeds (alongside class-levels +
// grading) so it compiles into the package's public API and can be imported
// from tests (e.g. the permissions-coverage spec asserts the role grants)
// without running the seed routine as a side effect. Moved here from
// prisma/seed-data.ts in the Phase 2 slice 9 RBAC rollup — the old location was
// outside src/ and so couldn't be imported across packages (TS rootDir).

import {
  OWNER_ONLY_PERMISSIONS,
  PHASE_0_PERMISSIONS,
  PHASE_1_PERMISSIONS,
  PHASE_2_OWNER_ONLY_PERMISSIONS,
  PHASE_2_PERMISSIONS,
  PHASE_2_TEACHER_PERMISSIONS,
  PHASE_3_OWNER_ONLY_PERMISSIONS,
  PHASE_3_PERMISSIONS,
} from "@school-kit/types";

export interface SystemRoleSeed {
  key: string;
  name: string;
  description: string;
  permissions: readonly string[];
}

// admin gets every Phase 0 + Phase 1 + Phase 2 + Phase 3 permission EXCEPT the
// owner-only ones — the Phase 1 history-bearing deletes (academic-year/term/
// enrollment), the Phase 2 `report-card.reopen`, and the Phase 3
// `auth.2fa.manage` (owners manage their own 2FA). Phase 1 slice 13 + Phase 2
// slice 9 + Phase 3 slice 2 RBAC rollups. Keep IN SYNC with the migrations that
// update the existing global admin role row.
const ADMIN_PERMISSIONS: readonly string[] = [
  ...PHASE_0_PERMISSIONS,
  ...PHASE_1_PERMISSIONS.filter(
    (p) => !(OWNER_ONLY_PERMISSIONS as readonly string[]).includes(p),
  ),
  ...PHASE_2_PERMISSIONS.filter(
    (p) => !(PHASE_2_OWNER_ONLY_PERMISSIONS as readonly string[]).includes(p),
  ),
  ...PHASE_3_PERMISSIONS.filter(
    (p) => !(PHASE_3_OWNER_ONLY_PERMISSIONS as readonly string[]).includes(p),
  ),
];

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
      "School administrator — every Phase 0 + Phase 1 + Phase 2 + Phase 3 permission except the owner-only ones (history-bearing deletes, report-card.reopen, auth.2fa.manage) and school deletion (TODO when school.delete lands).",
    permissions: ADMIN_PERMISSIONS,
  },
  // Phase 1 / Slice 10 — minimal `teacher` role. Read-scoped access to a
  // teacher's own arms/subjects/roster + self-service on their profile (per
  // phase-1.md:1087). Pulled forward into slice 10 (rather than the slice-13
  // RBAC rollup) because without it invitation-accept of a teacher rolls back
  // and class-arms' assertUserIsTeacher always fails — the whole staff branch
  // is untestable. Kept IN SYNC with the idempotent seed in
  // prisma/migrations/20260530120000_phase_1_slice_10_teacher_profiles
  // (the migration covers existing/CI DBs via `migrate deploy`; this covers a
  // fresh `db:seed`). If you edit one permission list, edit both. The Phase 2
  // additions land via the slice-9 RBAC rollup migration.
  {
    key: "teacher",
    name: "Teacher",
    description:
      "Teaching staff — read-scoped access to their assigned arms, subjects, and roster, self-service on their own profile, plus the Phase 2 score/attendance/report-card actions for their own arms (the service narrows these to scope). Phase 2 slice 9 RBAC rollup.",
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
      // Phase 2 (slice 9) — granted at the guard; getTeacherScope narrows them
      // to the teacher's own (arm, subject). See PHASE_2_TEACHER_PERMISSIONS.
      ...PHASE_2_TEACHER_PERMISSIONS,
    ],
  },
];
