import { PLAN_LABELS, type PlanEnforcement, type WebsiteSectionStateDto } from "@school-kit/types";

// What a website section needs from the plan (docs/modules/school-website.md
// W3). Never hides the section: a school sees what it would get. Tinted, with
// the words, never an accent border.
export function SectionLock({ state, enforcement }: { state: WebsiteSectionStateDto; enforcement: PlanEnforcement }) {
  if (state.inPlan) return null;
  const plan = PLAN_LABELS[state.minPlan];
  if (state.open && enforcement === "warn") {
    return (
      <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        {plan} plan — included free during early access.
      </p>
    );
  }
  return (
    <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      Locked: comes with the {plan} plan. You can fill it in now; it shows on your page once your plan includes it.
    </p>
  );
}
