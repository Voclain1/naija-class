// The carry-over wizard's default-selection rule, extracted so it can be
// tested.
//
// Extracted 2026-08-25 during the carry-over incident. It previously lived
// inline inside a React effect in
// app/(admin)/enrollments/bulk/page.tsx, where it could not be executed by
// any test — apps/web had no test runner at all until this incident. The rule
// is the incident's entire root cause, so it now lives somewhere a regression
// guard can reach it.
//
// See docs/runbooks/carry-over-incident-2026-08-25.md.

export type CarryOverGroup = "carried" | "withdrew" | "admitted";

/**
 * Which candidates arrive pre-ticked.
 *
 * - `carried`  — enrolled in the source term IN THIS ARM. Arm-scoped, so
 *                pre-ticking is safe and is the whole point of the feature.
 * - `withdrew` — arm-scoped too, but a withdrawal is a decision the operator
 *                should re-make deliberately. Never pre-ticked.
 * - `admitted` — students with no source-term place at all. This group is
 *                SCHOOL-WIDE by necessity: an unplaced student has no arm to
 *                filter on. **Never pre-ticked**, because its only real filter
 *                is `admittedAt > source.endDate` and `Student.admittedAt`
 *                defaults to `now()` — so on a recently onboarded school the
 *                entire roster matches. Pre-ticked, one click moved a whole
 *                school into a single arm, and the per-term uniqueness rule
 *                then turned every other arm's carry-over into a silent no-op.
 */
export function initialCarryOverSelection(
  rows: ReadonlyArray<{ studentId: string; group: CarryOverGroup }>,
): Map<string, boolean> {
  const initial = new Map<string, boolean>();
  for (const row of rows) {
    initial.set(row.studentId, row.group === "carried");
  }
  return initial;
}
