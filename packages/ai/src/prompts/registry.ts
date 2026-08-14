// Versioned prompt registry.
//
// Every prompt the platform sends to Claude is declared here with a name, a
// version, and the model it runs on. AiGenerationService writes the name and
// version to ai_generations on every call, per CLAUDE.md's AI hard rule
// ("model, prompt name + version, ...").
//
// WHY A REGISTRY AND NOT FREE STRINGS AT THE CALL SITE (phase-5.md D8):
// compile-time safety where it matters. `PromptName` is a union derived from
// this object, so a typo is a tsc failure — the same reason queue.constants.ts
// centralises queue names so producers and consumers cannot drift.
//
// WHY THE DB COLUMNS STAY PLAIN `String` AND NOT AN ENUM OR AN FK: an
// ai_generations row is a historical record. It must be able to hold
// "report-card-subject-comment@3" forever, including after v3 is deleted from
// this file. Enum-ing the column would mean a migration per prompt version,
// and prompt versions bump often during tuning. Referential integrity here is
// actively wrong.
//
// VERSIONING RULE: bump `version` whenever the rendered text changes in a way
// that could change output. That is what makes a regression traceable to a
// specific prompt revision in the ledger — the whole point of storing it.
//
// `as const` object, never a TS enum — see the landmine note in ../index.ts.

import { MODELS, type ModelId } from "../models.js";
// Runtime import; lesson-plan.ts imports only the TYPE back from here, and
// type-only imports are erased at compile time, so there is no runtime cycle.
import { INSIGHTS_NARRATION_PROMPT, INSIGHTS_ROUTER_PROMPT } from "./insights.js";
import { LESSON_PLAN_PROMPT, LESSON_QUIZ_PROMPT } from "./lesson-plan.js";
import { PARENT_WEEKLY_SUMMARY_PROMPT } from "./parent-weekly-summary.js";
import { REPORT_CARD_COMMENT_PROMPT } from "./report-card-comment.js";
import { REPORT_CARD_FORM_COMMENT_PROMPT } from "./report-card-form-comment.js";

export interface PromptDefinition {
  readonly name: string;
  readonly version: string;
  readonly model: ModelId;
  // Pessimistic output ceiling. Doubles as the output half of the budget
  // reservation, so it should be a realistic worst case rather than a
  // generous round number — an inflated value reserves budget the call will
  // never use, and (until settle reconciles it) makes a school look closer to
  // its cap than it is.
  readonly maxTokens: number;
}

// Slice 1 CP2 ships exactly one prompt, and it exists to exercise the
// infrastructure end to end (budget reserve -> call -> settle -> ledger row)
// without waiting on a feature slice. Real feature prompts land with their own
// slices, each with golden eval fixtures — `pnpm ai:eval` becomes a real gate
// at slice 2, per phase-5.md.
export const PROMPTS = {
  CONNECTIVITY_CHECK: {
    name: "connectivity-check",
    version: "1",
    model: MODELS.HAIKU_4_5,
    maxTokens: 16,
  },
  LESSON_PLAN: LESSON_PLAN_PROMPT,
  LESSON_QUIZ: LESSON_QUIZ_PROMPT,
  REPORT_CARD_SUBJECT_COMMENT: REPORT_CARD_COMMENT_PROMPT,
  REPORT_CARD_FORM_COMMENT: REPORT_CARD_FORM_COMMENT_PROMPT,
  PARENT_WEEKLY_SUMMARY: PARENT_WEEKLY_SUMMARY_PROMPT,
  INSIGHTS_ROUTER: INSIGHTS_ROUTER_PROMPT,
  INSIGHTS_NARRATION: INSIGHTS_NARRATION_PROMPT,
} as const satisfies Record<string, PromptDefinition>;

export type PromptKey = keyof typeof PROMPTS;
export type PromptName = (typeof PROMPTS)[PromptKey]["name"];

// The `name@version` form written to ai_generations.prompt_version's sibling
// column pair, and the form used in logs. Kept in one place so the convention
// cannot drift between call sites.
export function promptRef(p: PromptDefinition): string {
  return `${p.name}@${p.version}`;
}
