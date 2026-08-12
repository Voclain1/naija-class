// Phase 5 / Slice 1 CP2 — AI budget constants and period helpers.

// Fallback when School.aiMonthlyTokenBudget is NULL, which is the default for
// every school. Deliberately conservative (phase-5.md D6: platform-subsidised,
// conservative cap, hard block on exhaustion — there is no plan/tier concept in
// the product code, so metered billing is not buildable yet).
//
// Sizing: 2M tokens/month. Worst case — every token billed at Haiku 4.5's
// OUTPUT rate of $5/MTok — is ~$10 per school per month, and realistic mixes
// are far cheaper because input dominates and input is $1/MTok. With six live
// schools that is a bounded, known platform cost rather than an open tap.
// Raise per-school via School.aiMonthlyTokenBudget when a school demonstrably
// needs more; raise this constant when the *default* is wrong for everyone.
export const DEFAULT_MONTHLY_TOKEN_BUDGET = 2_000_000;

// Per-user daily CALL cap (not tokens). Exists because a school-level monthly
// budget alone lets one teacher batch-generating burn the whole school's month
// in an afternoon — ARCHITECTURE.md §7 calls for "hard rate limits per
// student/teacher" alongside the school budget, and this is that limit.
//
// 200/day is generous for real use (a teacher generating comments for two
// classes of 40, three times over while tuning, is 240 — so this will
// occasionally bite, which is the point of a cap) while still bounding a
// runaway loop to a small fraction of the monthly budget.
export const DEFAULT_USER_DAILY_CALL_CAP = 200;

// First day of the current UTC month, as a date-only value.
//
// UTC, not Africa/Lagos, deliberately: the budget period is an accounting
// boundary, not a school-day boundary, and every row is compared against the
// same clock. The column is DATE (no time-of-day, no zone) — see the
// "midnight in which zone?" note in CLAUDE.md's Prisma column-type section.
export function currentPeriodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// Start of the current UTC day — the window for the per-user call cap.
export function currentDayStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Error codes surfaced to callers. Distinct codes rather than one generic
// "AI unavailable" so a UI can say something useful and so the three
// exhaustion modes are distinguishable in logs and Sentry.
export const AI_ERROR_CODES = {
  DISABLED_PLATFORM: "AI_DISABLED_PLATFORM",
  DISABLED_SCHOOL: "AI_DISABLED_SCHOOL",
  NOT_CONFIGURED: "AI_NOT_CONFIGURED",
  BUDGET_EXCEEDED: "AI_BUDGET_EXCEEDED",
  USER_RATE_LIMITED: "AI_USER_RATE_LIMITED",
} as const;
