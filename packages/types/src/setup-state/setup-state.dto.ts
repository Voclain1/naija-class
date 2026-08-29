// Setup state — the derived answer to "what must I configure first, what can
// wait, and what is already done?" for a school's owner/admin.
//
// WHY THIS EXISTS (F-25, 2026-08-29). Every fact below was already knowable
// from the database, and every one of these screens already existed, but
// nothing in the product ever put them in ORDER. A fresh school's dashboard
// said exactly one thing — "add your first student" — and then went quiet;
// the next four things you must do (enrol those students into a term, price
// your fees, invite teachers, name a form teacher) were discoverable only by
// walking into a screen that silently did nothing. See
// docs/modules/first-school-setup.md.
//
// DERIVED, NEVER STORED. There is no `setup_progress` table and deliberately
// no localStorage flag: every step's `done` is a live count against the
// tenant's own rows, so a school that configured something through a
// different route (CSV import, the API, a colleague's session) is already
// complete here with nothing to reconcile. The cost is one aggregate query
// per dashboard load; the benefit is that this can never disagree with
// reality.

// Ordered by how a first-time school actually proceeds. The keys are stable
// (they appear in tests and telemetry); the copy is not.
export type SetupStepKey =
  | "academic-calendar"
  | "students"
  | "enrollments"
  | "fee-catalog"
  | "staff"
  | "form-teachers"
  | "teacher-assignments"
  | "class-subjects"
  | "guardians";

// The distinction this whole feature exists to make. Presenting every
// configuration item as mandatory is the failure mode being fixed, not a
// safer default.
//
//   required     — a core workflow is inert until this is done.
//   recommended  — a specific named workflow stays unavailable, but the
//                  school can operate without it.
//   optional     — genuinely can wait; nothing is blocked today.
export type SetupStepTier = "required" | "recommended" | "optional";

export interface SetupStepDto {
  key: SetupStepKey;
  tier: SetupStepTier;
  done: boolean;
  /** Plain-language step name, e.g. "Put students in their classes". */
  title: string;
  /** Why it matters — what stays broken or unavailable until it is done. */
  why: string;
  /** The route that actually completes this step. */
  href: string;
  /** Button copy for that route. */
  actionLabel: string;
  /**
   * Live count behind `done` (students added, arms with a form teacher, …).
   * Surfaced so a completed step can say what it found rather than just
   * showing a tick.
   */
  count: number;
}

// Things a school never has to do because signup already did them
// (packages/db/src/seeds/school-defaults.ts). Listed so "what is already
// complete" is an answer the product gives, rather than something an owner
// has to go and verify.
export interface SetupReadyItemDto {
  label: string;
  detail: string;
  href: string;
}

export interface SetupStateDto {
  /**
   * How much setup UI the school should see.
   *
   *   "setup"       — at least one required step outstanding. Always shown.
   *   "finishing"   — required work done, recommended work outstanding, and
   *                   the school has no real activity yet. Shown compactly.
   *   "established" — nothing outstanding, or the school is demonstrably in
   *                   day-to-day use. No setup UI at all.
   *
   * Derived from persisted rows only — see `hasRealActivity`.
   */
  status: "setup" | "finishing" | "established";
  /**
   * True once the school has marked a register, issued an invoice, or
   * entered a score. This is what stops the checklist becoming permanent
   * furniture for a school that has deliberately skipped, say, fees.
   */
  hasRealActivity: boolean;
  steps: SetupStepDto[];
  alreadyDone: SetupReadyItemDto[];
  /** Count of `tier: "required"` steps still outstanding. */
  requiredRemaining: number;
  /** Count of `tier: "recommended"` steps still outstanding. */
  recommendedRemaining: number;
  /** The one thing to do next — the first outstanding step in order, or null. */
  nextStepKey: SetupStepKey | null;
}
