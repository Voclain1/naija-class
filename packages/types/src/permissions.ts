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

// Phase 2 / Slice 4 — position aggregation. REFERENCE-ONLY (slice 9 rollup).
// The aggregation endpoints gate via the service (owner/admin OR the arm's form
// teacher), not @Permissions, until the slice-9 PermissionsGuard retrofit.
export const PHASE_2_SLICE_4_PERMISSIONS = ["assessment.aggregate"] as const;

// Phase 2 / Slice 5 — report cards. REFERENCE-ONLY (slice 9 rollup). build/render
// gate to owner/admin in the service; reads to owner/admin OR the arm's form
// teacher. `report-card.release` lands here for cohesion though the release
// transition itself is slice 6.
export const PHASE_2_SLICE_5_PERMISSIONS = [
  "report-card.read",
  "report-card.build",
  "report-card.render",
  "report-card.release",
] as const;

// Phase 2 / Slice 7 — daily attendance. REFERENCE-ONLY (slice 9 rollup). Both
// mark and read gate to owner/admin OR the arm's FORM teacher in the service; a
// subject teacher of the arm is forbidden (subject-period attendance is slice 8).
export const PHASE_2_SLICE_7_PERMISSIONS = ["attendance.mark", "attendance.read"] as const;

// Phase 2 canonical permission rollup (slice 9). Synthesized from the spec's
// "RBAC implementation → New permission strings" list (docs/modules/phase-2.md),
// NOT mechanically concatenated from the per-slice reference consts above —
// slices 3/6/8 emitted no const, slice 2 omitted `assessment-score.read`, and
// slice 5's `report-card.render` is not a permission (render is a build/release
// side-effect, gated by `report-card.build`). This array is now the single
// source of truth: spread into ALL_PERMISSIONS below, granted to admin (minus
// the owner-only reopen) + teacher (the subset) in
// packages/db/prisma/seed-data.ts, enforced by PermissionsGuard, and applied to
// existing/CI DBs by the 20260609..._phase_2_slice_9_rbac_rollup data migration.
// The per-slice PHASE_2_SLICE_N_PERMISSIONS consts above are superseded by this
// and kept only as historical reference.
export const PHASE_2_PERMISSIONS = [
  // Grading configuration
  "grading-scheme.read",
  "grading-scheme.update",
  "grading-component.read",
  "grading-component.create",
  "grading-component.update",
  "grading-component.delete",
  "grade-boundary.read",
  "grade-boundary.update",

  // Assessment
  "assessment.read",
  "assessment-score.read",
  "assessment-score.create",
  "assessment-score.update",
  "assessment.sign-off",
  "assessment.aggregate",

  // Attendance (daily, universal)
  "attendance.read",
  "attendance.mark",

  // Subject-period attendance (opt-in)
  "subject-attendance.read",
  "subject-attendance.mark",

  // Report cards + approval workflow
  "report-card.read",
  "report-card.build",
  "report-card.form-review",
  "report-card.principal-approve",
  "report-card.release",
  "report-card.reopen",
  "report-card.comment",
] as const;

// Owner-only Phase 2 permission — reopening a RELEASED arm (audited rollback to
// DRAFT). Admin gets every Phase 2 permission EXCEPT this. Mirrors
// OWNER_ONLY_PERMISSIONS for Phase 1.
export const PHASE_2_OWNER_ONLY_PERMISSIONS = ["report-card.reopen"] as const;

// Phase 3 auth-hardening permissions. `auth.2fa.manage` lets a user enrol,
// verify, and disable their own TOTP 2FA — owner-only so that only the school
// owner can gate their own account with a second factor. `auth.2fa.read` lets
// admin view 2FA status on the user list (CP2 admin surface). Owner gets both
// via the '*' wildcard; admin gets only auth.2fa.read (see
// PHASE_3_OWNER_ONLY_PERMISSIONS + system-roles seed).
//
// Fee catalog permissions (slice 4) are admin-accessible with no owner-only
// restriction in this slice. The billing.delete owner-only gate lands at
// slice 15 close-out alongside the bursar role wire-up.
export const PHASE_3_PERMISSIONS = [
  "auth.2fa.manage",
  "auth.2fa.read",

  // Slice 4 — fee catalog
  "fee-category.read",
  "fee-category.create",
  "fee-category.update",
  "fee-category.delete",
  "fee-item.read",
  "fee-item.create",
  "fee-item.update",
  "fee-item.delete",

  // Slice 5 — discount rules (manual per-student assignment)
  // Bursar role wire-up deferred to slice 15; strings must exist now.
  "discount-rule.read",
  "discount-rule.create",
  "discount-rule.update",
  "discount-rule.deactivate",

  // Slice 6 — invoices (snapshot-on-issue)
  // Bursar role wire-up deferred to slice 15.
  "invoice.read",
  "invoice.issue",
  "invoice.cancel",

  // Slice 7 — manual payment recording + receipts
  "payment.read",
  "payment.record",

  // Slice 11 — refunds (owner + admin only; bursar excluded — highest-trust mutation)
  "payment.refund",

  // Slice 9 — installment plans
  // No payment-plan.update — plans are immutable; replace = delete + create.
  "payment-plan.create",
  "payment-plan.read",
  "payment-plan.delete",

  // Slice 10 — debtor list + email reminders
  "finance.debtors.read",
  "finance.debtors.remind",

  // Slice 12 — BVN capture/reveal (owner + admin only; bursar excluded —
  // mirrors payment.refund, the highest-trust read/write in the payroll
  // surface). The /users/me/bvn* self-service routes need no permission
  // string — every authenticated user manages their own BVN regardless of role.
  "staff-bvn.manage-others",
  "staff-bvn.read",
  "staff-bvn.reveal",

  // Slice 13 — expense tracking. No owner-only restriction (unlike
  // payment.refund/staff-bvn.reveal, this isn't a highest-trust surface).
  // Bursar wire-up deferred to slice 15, same as every other Phase 3 bucket.
  "expense-category.read",
  "expense-category.create",
  "expense-category.update",
  "expense-category.delete",
  "expense.read",
  "expense.create",
  "expense.update",
  "expense.delete",

  // Slice 14 — finance dashboard. Read-only aggregation, not a highest-trust
  // surface — no owner-only restriction. Bursar wire-up deferred to slice 15.
  "finance.dashboard.read",
] as const;

export const PHASE_3_OWNER_ONLY_PERMISSIONS = ["auth.2fa.manage"] as const;

// The Phase 2 subset granted to the `teacher` role at the GUARD level. The
// SERVICE layer (getTeacherScope) then narrows these to the teacher's own
// arms/subjects — two-layer gate: the guard authorizes the role, the service
// scopes the row. form-review + comment are INCLUDED because a form teacher
// needs them; withholding them at the guard to "enforce scope" would 403
// legitimate form teachers (the service checks ClassArm.classTeacherId).
// subject-attendance.* is granted unconditionally here; the service's opt-in
// (assertEnabled) 404s when the school hasn't turned the feature on.
export const PHASE_2_TEACHER_PERMISSIONS = [
  "assessment.read",
  "assessment-score.read",
  "assessment-score.create",
  "assessment-score.update",
  "assessment.sign-off",
  "assessment.aggregate",
  "attendance.read",
  "attendance.mark",
  "subject-attendance.read",
  "subject-attendance.mark",
  "report-card.read",
  "report-card.form-review",
  "report-card.comment",
] as const;

export const ALL_PERMISSIONS = [
  ...PHASE_0_PERMISSIONS,
  ...PHASE_1_PERMISSIONS,
  ...PHASE_2_PERMISSIONS,
  ...PHASE_3_PERMISSIONS,
  /* extend per phase */
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number] | "*";

export const PERMISSION_WILDCARD: Permission = "*";
