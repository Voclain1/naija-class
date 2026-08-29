import type { SetupStateDto, SetupStepDto } from "@school-kit/types";

// Pure presentation rules for the setup checklist, kept out of the component
// so they can be tested as functions rather than through the DOM — the same
// split finance/invoice-list-state.ts and report-cards/workflow-guidance-copy
// already use in this app.
//
// Nothing here decides WHETHER a step is done; that is the API's job and only
// the API's job. These functions decide how much of the API's answer to show.

/**
 * Whether the checklist renders at all.
 *
 * The rule is deliberately a straight read of the API's `status` rather than
 * a second opinion assembled from the counts: two places computing "is this
 * school established?" is exactly how a client-side answer starts drifting
 * from the server's. A null state (request failed, or the viewer is not
 * owner/admin so no request was made) renders nothing — the checklist is
 * guidance, and guidance that cannot load should be silent, not broken.
 */
export function shouldShowChecklist(state: SetupStateDto | null): boolean {
  if (!state) return false;
  return state.status !== "established";
}

/**
 * Progress across the steps that represent real work: required plus
 * recommended.
 *
 * Optional steps are excluded on purpose. Counting them would leave a
 * fully-operational school reading "7 of 9 done" forever, which turns a
 * progress bar into a permanent reproach for work the product itself says
 * can wait.
 */
export function checklistProgress(steps: SetupStepDto[]): {
  done: number;
  total: number;
  percent: number;
} {
  const counted = steps.filter((s) => s.tier !== "optional");
  const done = counted.filter((s) => s.done).length;
  const total = counted.length;
  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

/**
 * What a completed row says instead of its `why`.
 *
 * A tick alone tells an owner that School Kit thinks something is done, not
 * whether School Kit and the owner agree about what. Reporting the count the
 * tick was derived from ("42 students on your roster") makes a wrong answer
 * visible instead of silently reassuring.
 *
 * Plain school language throughout — no record counts, no entity names, no
 * "configured". The one place a number could read oddly is a count of 1, so
 * every branch below pluralises.
 */
export function doneSummary(step: SetupStepDto): string {
  const n = step.count;
  const is = n === 1;
  switch (step.key) {
    case "academic-calendar":
      return "Your school year and its terms are set.";
    case "students":
      return `${n} ${is ? "student" : "students"} on your roster.`;
    case "enrollments":
      return `${n} ${is ? "student is" : "students are"} in a class this term.`;
    case "fee-catalog":
      return `${n} ${is ? "fee" : "fees"} priced.`;
    case "staff":
      return `${n} ${is ? "teacher" : "teachers"} invited or on board.`;
    case "form-teachers":
      return `${n} ${is ? "class has" : "classes have"} a form teacher.`;
    case "teacher-assignments":
      return `${n} teaching ${is ? "assignment" : "assignments"} recorded.`;
    case "class-subjects":
      return `${n} class-and-subject ${is ? "pairing" : "pairings"} recorded.`;
    case "guardians":
      return `${n} ${is ? "parent or guardian" : "parents and guardians"} on file.`;
    default:
      return "Done.";
  }
}
