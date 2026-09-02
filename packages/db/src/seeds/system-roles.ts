// Static system-role seed data. Lives in src/seeds (alongside class-levels +
// grading) so it compiles into the package's public API and can be imported
// from tests (e.g. the permissions-coverage spec asserts the role grants)
// without running the seed routine as a side effect. Moved here from
// prisma/seed-data.ts in the Phase 2 slice 9 RBAC rollup — the old location was
// outside src/ and so couldn't be imported across packages (TS rootDir).

import {
  ADMIN_DASHBOARD_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  PHASE_0_PERMISSIONS,
  PHASE_1_PERMISSIONS,
  PHASE_2_OWNER_ONLY_PERMISSIONS,
  PHASE_2_PERMISSIONS,
  PHASE_2_TEACHER_PERMISSIONS,
  PHASE_3_BURSAR_PERMISSIONS,
  PHASE_3_OWNER_ONLY_PERMISSIONS,
  PHASE_3_PERMISSIONS,
  PHASE_4_PERMISSIONS,
  PHASE_5_PERMISSIONS,
  PHASE_5_TEACHER_PERMISSIONS,
  PHASE_7_TEACHER_PERMISSIONS,
  SMART_IMPORT_PERMISSIONS,
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
  // Phase 4 / Slice 2 — guardian.invite; Slice 6 — notification-preferences.
  // read/update. No owner-only subset to exclude (unlike Phases 1-3, this
  // phase hasn't needed one yet).
  ...PHASE_4_PERMISSIONS,
  // Phase 5 / Slice 2 — lesson-plan CRUD + ai-usage.read. No owner-only
  // subset: nothing here moves money or deletes an academic record.
  ...PHASE_5_PERMISSIONS,
  // Admin dashboard (2026-08-21). ADMIN_DASHBOARD_PERMISSIONS was spliced into
  // ALL_PERMISSIONS when the dashboard shipped and GET /dashboard has always
  // been guarded by it, but the admin role was never granted it — so every
  // INVITED admin 403'd on the page login routes them to. Owners were
  // unaffected (their grant is "*"). It stayed invisible because the dashboard
  // page only calls the API once a termId exists, and schools had no terms
  // (#198); fixing that is what surfaced this. Kept IN SYNC with the
  // idempotent append in
  // prisma/migrations/20260821000000_admin_dashboard_read_permission.
  ...ADMIN_DASHBOARD_PERMISSIONS,
  // Smart Student Import (2026-08-20) — `student.scan`. Admin/owner only;
  // deliberately absent from the teacher and bursar grants, because the
  // permission that COMMITS a scan's output (`student.import`) is already
  // admin/owner, and granting the spend more widely than the write would let
  // someone burn the school's AI budget on rows they cannot import.
  //
  // Kept IN SYNC with the idempotent append in
  // prisma/migrations/20260820000000_smart_student_import (which covers
  // existing and CI databases via `migrate deploy`; this covers a fresh
  // `db:seed`). If you edit one, edit both.
  ...SMART_IMPORT_PERMISSIONS,
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
      "School administrator — every Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4 permission except the owner-only ones (history-bearing deletes, report-card.reopen, auth.2fa.manage) and school deletion (TODO when school.delete lands).",
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
  // additions land via the slice-9 RBAC rollup migration; `grading-scheme.read`
  // was added to PHASE_2_TEACHER_PERMISSIONS on 2026-07-28 (a slice-9 gap, not
  // a new grant here) via the 20260728000000_teacher_grading_scheme_read_permission
  // migration — see that const's own header comment for why.
  {
    key: "teacher",
    name: "Teacher",
    description:
      "Teaching staff — read-scoped access to their assigned arms, subjects, and roster, self-service on their own profile, plus the Phase 2 score/attendance/report-card actions for their own arms (the service narrows these to scope). Phase 2 slice 9 RBAC rollup (grading-scheme.read added 2026-07-28, closing a slice-9 gap).",
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
      // Phase 5 / Slice 2 — the lesson-plan generator is teacher-facing by
      // definition. Deliberately excludes ai-usage.read: school-level AI spend
      // is operator information, not teaching workflow.
      ...PHASE_5_TEACHER_PERMISSIONS,
      // Phase 7 / CP2 — curriculum upload + read. Teacher-facing for the same
      // reason lesson plans are: the person who knows whether a scheme of work
      // is the CURRENT one is the teacher who works from it. curriculum.delete
      // is deliberately excluded — deleting a document changes what every other
      // teacher's plans are grounded in.
      ...PHASE_7_TEACHER_PERMISSIONS,
    ],
  },
  // Phase 3 / Slice 15 — `bursar` role wire-up + RBAC close-out. Finance-only
  // system role: fee catalog, discounts, invoices, payments (not refunds),
  // payment plans, debtor reminders, expenses, the finance dashboard, and
  // (payroll CP3) running payroll — no academic, roster, staff, or
  // school-settings access, and no payroll.transfer (moving real money is
  // owner+admin only). Brand-new role row (unlike the admin/refund/BVN
  // migrations, which UPDATE an existing row), so it needs an
  // INSERT-if-not-exists migration for already-provisioned DBs alongside
  // this seed entry. See PHASE_3_BURSAR_PERMISSIONS for the exclusion
  // rationale (auth.2fa.*, staff-bvn.*, payment.refund, payroll.transfer) and
  // its 2026-08-02 addendum (academic-year.read/term.read/class-arm.read —
  // read-only scoping context every finance page's year/term/class-arm
  // selector needs; not "academic access").
  {
    key: "bursar",
    name: "Bursar",
    description:
      "Finance operator — fee catalog, discounts, invoices, payments (excluding refunds), payment plans, debtor reminders, expenses, the finance dashboard, and running payroll (excluding the actual bank transfer). Read-only access to academic years/terms/class arms to scope finance work. No staff or school-settings access. Phase 3 slice 15 RBAC close-out, extended payroll CP3.",
    permissions: [...PHASE_3_BURSAR_PERMISSIONS],
  },
];
