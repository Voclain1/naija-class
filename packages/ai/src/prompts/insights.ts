// Admin insights prompts — Phase 5 / Slice 8.
//
// TWO prompts, and the split is the safety property, not an implementation
// detail. See the header in packages/types/src/insights/insights.dto.ts for
// the full reasoning; the short version:
//
//   ROUTER    free-text question -> one label from a closed list. No
//             parameters, no ids, no numbers. The output space is the list.
//   NARRATION already-computed figures -> two to four sentences. It cannot
//             produce a number that wasn't handed to it, because it is given
//             the finished aggregates and told to interpret, not calculate.
//
// Everything an admin sees as a figure came from SQL. The model routes and
// phrases. That is what makes an AI-led surface safe to put in front of an
// owner making staffing decisions, on a codebase whose content-quality evals
// do not yet exist (see phase-5.md §9).
//
// MODEL: Haiku 4.5 for both (D7). The router is a classification task with a
// four-way output — the cheapest thing in the registry and the one least in
// need of a bigger model. The narration is short structured prose over a
// handful of figures, the same shape as the report-card comments.
//
// PII: the narration input carries NO student names, ids, or contact detail —
// counts, class labels, subject names and percentages only. The admin's table
// beside it does carry names, because that comes straight from the API to the
// browser and never passes through here. Asserted in the eval suite.
//
// The ROUTER, by contrast, receives a free-text question an admin typed, which
// this renderer cannot sanitise — an admin who types a child's name into the
// box sends that name. Same documented boundary as the lesson-plan topic
// field: the mitigation is at the UI/API layer (and the field is length-capped
// there), not a renderer that silently rewrites input.

import { MODELS } from "../models.js";
import type { PromptDefinition } from "./registry.js";

export const INSIGHTS_ROUTER_PROMPT: PromptDefinition = {
  name: "insights-router",
  version: "1",
  model: MODELS.HAIKU_4_5,
  // A label and a boolean. 100 is already generous; a router that wants more
  // room than this has misunderstood its job.
  maxTokens: 100,
};

export const INSIGHTS_ROUTER_SYSTEM = `You route a school administrator's question to exactly one of a fixed set of reports.

You are given the question and the list of reports available, each with a description. Choose the single report that best answers the question.

Rules:
- Choose from the given list only. Never invent a report name.
- If the question does not map cleanly onto any of them, set "unsupported" to true. Do NOT force a poor match — the administrator is better served by being told the question isn't supported than by being shown a confident answer to a different question.
- Questions about an individual child, about fees or money, about staff, or about anything outside the listed reports are unsupported. Say so rather than picking the nearest academic report.
- Do not answer the question. Do not comment on it. Return the routing decision only.`;

// The schema depends on the caller's intent list, so it is built rather than
// declared — the enum IS the closed output space, and hardcoding it here would
// let it drift from packages/types' INSIGHT_INTENTS silently.
export function buildInsightsRouterSchema(intents: readonly string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: [...intents],
        description: "The report that best answers the question.",
      },
      unsupported: {
        type: "boolean",
        description:
          "True when the question does not map cleanly onto any available report. When true, `intent` is ignored.",
      },
    },
    required: ["intent", "unsupported"],
    additionalProperties: false,
  };
}

export interface InsightsRouterInput {
  readonly question: string;
  readonly intents: ReadonlyArray<{ readonly name: string; readonly description: string }>;
}

// Pure function of its inputs — no DB, no clock, no randomness. Same
// discipline as every renderer in this directory.
export function renderInsightsRouterPrompt(input: InsightsRouterInput): string {
  const lines = ["Available reports:"];
  for (const i of input.intents) {
    lines.push(`- ${i.name}: ${i.description}`);
  }
  lines.push("", "The administrator asked:", input.question, "", "Route it.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------

export const INSIGHTS_NARRATION_PROMPT: PromptDefinition = {
  name: "insights-narration",
  version: "1",
  model: MODELS.HAIKU_4_5,
  maxTokens: 300,
};

export const INSIGHTS_NARRATION_SYSTEM = `You are helping the head teacher or proprietor of a Nigerian school read a report they have just opened. They can see the full table of figures; you are writing the two or three sentences above it.

Write TWO to THREE sentences (roughly 40-70 words).

What to do:
- Lead with the single most important thing in the figures.
- Interpret, don't recite. They can already read the table — "SS 2 B is the outlier, more than twenty points below the next class" is useful; "SS 2 B scored 41%, SS 1 A scored 62%" is not.
- Where the figures suggest an obvious next step, say it in a clause. Not a lecture, and not an instruction — a suggestion a head teacher can take or leave.
- End there. No summary of what you just said.

Hard limits:
- Use ONLY the figures given to you. Never state, imply, estimate or round to a number you were not handed. If you want to say "about a third", check it is actually a third of a number you were given.
- Never name a student. You have not been given any student names, and inventing one would be a serious error in a report an administrator may forward.
- Never claim a cause. Low scores in a subject may be teaching, timetabling, the cohort, or the marking — you cannot tell which from these figures, and guessing at a cause in writing is how a teacher ends up unfairly blamed.
- Do not open with "This report", "The data shows", or "Based on the figures". Start with the finding.
- Use British spelling and the plain register of a Nigerian school. WAEC/NECO framing is appropriate for senior classes where the figures warrant it. No emoji.

Output the paragraph only — no heading, no bullet points, no sign-off.`;

export const INSIGHTS_NARRATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description:
        "Two to three sentences interpreting the figures. No student names, no invented numbers, no claimed causes.",
    },
  },
  required: ["answer"],
  additionalProperties: false,
};

export interface InsightsNarrationInput {
  readonly question: string;
  readonly termName: string;
  // Pre-formatted, PII-free lines built by the caller from computed rows —
  // "SS 2 B: average 41%, attendance 68%, 34 students". The renderer does not
  // reach into row objects itself, which is what keeps a future row-shape
  // change (adding a name column, say) from silently widening what reaches
  // the model.
  readonly figures: readonly string[];
  readonly reportLabel: string;
}

export function renderInsightsNarrationPrompt(input: InsightsNarrationInput): string {
  const lines = [
    `Report: ${input.reportLabel}`,
    `Term: ${input.termName}`,
    "",
    "They asked:",
    input.question,
    "",
    "Figures:",
  ];

  if (input.figures.length === 0) {
    lines.push("- (the report came back empty — there is nothing to report)");
  } else {
    for (const f of input.figures) lines.push(`- ${f}`);
  }

  lines.push("", "Write the summary.");
  return lines.join("\n");
}
