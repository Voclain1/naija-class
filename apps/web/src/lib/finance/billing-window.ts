import type { RevenueTrajectoryDto } from "@school-kit/types";

// "Billing window: Week 3 of 13" — where the term currently stands.
//
// Derived ENTIRELY from data the trajectory endpoint already returns. The
// mockup showed this line hard-coded; the week count here comes from the
// term's own stored dates, because Nigerian terms are not a uniform length
// and a school may set any span it likes (see RevenueTrajectoryDto).
//
// Pure function with its own spec, per this project's split: pure logic is
// unit-tested, rendered behaviour is Playwright. apps/web has no DOM runner.

export interface BillingWindow {
  /** 0 when the term has not started yet. */
  currentWeek: number;
  totalWeeks: number;
  label: string;
}

/**
 * Resolve the term's billing window, or null when there is nothing truthful
 * to say.
 *
 * Returns null rather than a placeholder when the term has no in-term weeks
 * at all — a term whose dates produce no weeks is a setup problem, and
 * "Week 0 of 0" states it in the least useful possible way.
 *
 * The three states are genuinely different and are NOT collapsed:
 *
 *   - Not started: every in-term week is still in the future. Saying "Week 1"
 *     would claim billing has begun when it has not.
 *   - In progress: the count of weeks that have actually arrived.
 *   - Ended: every week has arrived, so current === total.
 *
 * `isFuture` is the single source for "has this week arrived", reused rather
 * than re-deriving from dates here — the server already made that judgement
 * in UTC (D1 in docs/modules/revenue-trajectory.md), and a second, subtly
 * different opinion computed in the browser's timezone is exactly the drift
 * that decision exists to prevent.
 */
export function resolveBillingWindow(
  trajectory: RevenueTrajectoryDto | null | undefined,
): BillingWindow | null {
  if (!trajectory) return null;

  const inTerm = trajectory.buckets.filter((b) => b.kind === "IN_TERM");
  if (inTerm.length === 0) return null;

  const totalWeeks = inTerm.length;
  const currentWeek = inTerm.filter((b) => !b.isFuture).length;

  if (currentWeek === 0) {
    return { currentWeek, totalWeeks, label: `Term has not started — ${totalWeeks} weeks` };
  }

  return {
    currentWeek,
    totalWeeks,
    label: `Billing window: Week ${currentWeek} of ${totalWeeks}`,
  };
}
