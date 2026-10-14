import type { SchoolPlanDto } from "@school-kit/types";

// The words for a school's plan usage. The web's sentences
// (apps/web/src/lib/plans/plan-copy.ts), so the app's Students notice says
// exactly what the website's does; brought over by the pre-build audit
// (2026-10-14). Pure, so it is unit-tested.

const n = (v: number) => v.toLocaleString("en-NG");

/** One sentence: where the school is against its cap. */
export function planUsageSentence(p: SchoolPlanDto): string {
  if (p.studentCap === null) {
    return `Your school is on the ${p.label} plan, with no limit on students. ${n(p.studentsOnRoll)} are on the roll.`;
  }
  if (p.status === "over") {
    return `Your school has ${n(p.studentsOnRoll)} students on the roll, more than the ${n(p.studentCap)} its ${p.label} plan covers.`;
  }
  return `Your school has ${n(p.studentsOnRoll)} of the ${n(p.studentCap)} students its ${p.label} plan covers.`;
}

/** What happens next, or null when there is nothing to say. */
export function planConsequenceSentence(p: SchoolPlanDto): string | null {
  if (p.studentCap === null || p.status === "ok") return null;
  if (p.enforcement === "warn") {
    return "During early access nothing is blocked. Talk to SchoolKit about a bigger plan.";
  }
  return p.status === "over"
    ? "New students can't be added until your plan changes. Talk to SchoolKit about a bigger plan."
    : `Once you reach ${n(p.studentCap)}, new students can't be added until your plan changes.`;
}
