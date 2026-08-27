// Choosing a sensible starting academic year for the finance screens.
//
// F-29 asked whether the current academic year and term could be defaulted
// from the existing `isCurrent` flags. The answer here is DELIBERATELY
// SPLIT, and the split follows a decision this repo has already made:
//
//   packages/types/src/imports/options.ts — the student import's target term
//   has NO default, "overriding the plan-first's original 'default to
//   Term.isCurrent'", because "a silent default is at its most dangerous
//   exactly when it is most likely to be wrong: a school onboarding
//   mid-transition between terms."
//
// Invoice GENERATION is the same category of action as that one — it writes
// financial records for a whole class arm against a term. So the TERM is
// never auto-selected here; the bursar picks it, and the picker labels which
// term the school considers current so that choice is informed rather than
// guessed.
//
// The academic YEAR is different, and safe to default: `generateInvoices`
// takes only `termId` and `classArmId`. The year selector does not reach the
// request at all — it exists solely to narrow which terms are listed. Landing
// on the current year saves a click and cannot, on its own, cause anything to
// be billed.

interface CurrentFlagged {
  id: string;
  isCurrent: boolean;
}

/**
 * The unambiguously-current record, or null.
 *
 * Returns null when zero OR MORE THAN ONE record is flagged current. Two
 * current years is a data problem, and picking one of them arbitrarily would
 * hide it behind a screen that looks like it worked — the user stays in
 * control instead.
 */
export function unambiguousCurrent<T extends CurrentFlagged>(records: T[]): T | null {
  const current = records.filter((r) => r.isCurrent);
  return current.length === 1 ? (current[0] ?? null) : null;
}

/**
 * Suffix appended to a term/year option label so the school's own current
 * record is visible in the dropdown. This is what replaces auto-selection
 * for the term: the information is surfaced, the choice stays explicit.
 */
export function currentSuffix(isCurrent: boolean): string {
  return isCurrent ? " (current)" : "";
}
