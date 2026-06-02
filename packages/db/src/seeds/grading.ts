// Phase 2 / Slice 1 — default grading configuration seed.
//
// Every new school created via signupOwner is auto-populated with one
// GradingScheme, its three default GradingComponents, and the nine WAEC
// GradeBoundary bands — inside the SAME transaction that creates the school
// (see apps/api/src/modules/auth/auth.service.ts signupOwner). Schools then
// edit weights, rename components, add components (e.g. a Project), or adjust
// boundary ranges via the settings UI.
//
// Idempotency: the scheme is seeded with `upsert` (on the school_id unique),
// the components + boundaries with `createMany({ skipDuplicates: true })`
// against their unique indexes — so a hypothetical signup-tx retry inserts no
// duplicates. Same belt-and-braces discipline as DEFAULT_CLASS_LEVELS.
//
// KEEP IN SYNC: the slice-1 migration
// (20260602000000_phase_2_slice_1_grading_config) backfills existing schools
// with these exact values via inline SQL VALUES lists. If you change a default
// here, change the migration's backfill block too (it is a one-time data
// migration, so the drift only matters until every environment has run it —
// but a mismatch would mean new vs. backfilled schools differ).

export interface DefaultGradingComponent {
  key: string;
  label: string;
  weight: number; // integer percent; the three below sum to 100
  orderIndex: number;
}

export interface DefaultGradeBoundary {
  letter: string;
  minScore: number; // inclusive
  maxScore: number; // inclusive
  remark: string;
  orderIndex: number;
}

// The school's single scheme name. Free-text and renameable; this is just the
// day-one label.
export const DEFAULT_GRADING_SCHEME_NAME = "WAEC-style (default)";

// CA1 20 + CA2 20 + Exam 60 = 100. The most common Nigerian private-school
// split; schools that run e.g. CA1/CA2/Project/Exam re-weight in settings.
export const DEFAULT_GRADING_COMPONENTS: readonly DefaultGradingComponent[] = [
  { key: "ca1", label: "First CA", weight: 20, orderIndex: 1 },
  { key: "ca2", label: "Second CA", weight: 20, orderIndex: 2 },
  { key: "exam", label: "Exam", weight: 60, orderIndex: 3 },
] as const;

// WAEC nine-point scale. Inclusive ranges that tile 0..100 with no gaps or
// overlaps (A1 75–100 … F9 0–39). Exact values are locked by phase-2.md
// acceptance criterion #2.
export const DEFAULT_GRADE_BOUNDARIES: readonly DefaultGradeBoundary[] = [
  { letter: "A1", minScore: 75, maxScore: 100, remark: "Excellent", orderIndex: 1 },
  { letter: "B2", minScore: 70, maxScore: 74, remark: "Very Good", orderIndex: 2 },
  { letter: "B3", minScore: 65, maxScore: 69, remark: "Good", orderIndex: 3 },
  { letter: "C4", minScore: 60, maxScore: 64, remark: "Credit", orderIndex: 4 },
  { letter: "C5", minScore: 55, maxScore: 59, remark: "Credit", orderIndex: 5 },
  { letter: "C6", minScore: 50, maxScore: 54, remark: "Credit", orderIndex: 6 },
  { letter: "D7", minScore: 45, maxScore: 49, remark: "Pass", orderIndex: 7 },
  { letter: "E8", minScore: 40, maxScore: 44, remark: "Pass", orderIndex: 8 },
  { letter: "F9", minScore: 0, maxScore: 39, remark: "Fail", orderIndex: 9 },
] as const;
