// Weekly parent progress summary prompt — Phase 5 / Slice 5.
//
// One summary per (student, week): a short, plain-language note to a parent
// about how their child's week went, assembled from the last 7 days of
// attendance and any scores entered in that window.
//
// MODEL: Haiku 4.5 (phase-5.md D7). Highest standing volume in the phase by
// some distance — every enrolled student every week, forever, rather than
// once a term. A 400-student school is ~1,600 calls a month from this feature
// alone, which is why maxTokens below is tight and why the sweep skips quiet
// weeks entirely rather than generating "nothing happened".
//
// THE AUDIENCE IS THE DIFFERENCE. Slices 3 and 4 write for a report card: a
// formal document, teacher's register, read once a term beside a grade table.
// This is read on a phone, by a parent who may not have finished secondary
// school themselves, with no grade table beside it. So: short sentences,
// no register jargon ("CA1", "continuous assessment", "component weighting"),
// no percentages the parent has to interpret unaided, and never a bare figure
// where a plain-English reading of it would do.
//
// NO APPROVAL GATE ON THIS OUTPUT (phase-5.md D16). Unlike every other AI
// surface shipped in this phase, what this prompt produces reaches a parent
// with no teacher in the loop — the school opts in, and that is the whole
// control. Two consequences the prompt itself has to carry, because nothing
// downstream will catch them:
//   * It must never state or imply a judgement the figures don't support.
//     There is no teacher reading it who would notice "struggling badly" on a
//     week that held one middling test score.
//   * It must never instruct or alarm. "Contact the school immediately" from
//     an unsupervised model, to a parent, about their child, is a harm this
//     product cannot absorb. Concerns are phrased as something to raise at
//     the school in the ordinary way, never as urgency.
//
// PII (CLAUDE.md hard rule): identical posture to slices 3-4 and the same
// mechanical assertion in the eval suite. No name, admission number, DOB,
// contact detail or gender reaches the model. The parent already knows whose
// week this is — the portal renders the summary under the child's name, so
// the model has no reason to be told it. "Your child" throughout, and the
// no-gendered-pronoun rule applies exactly as it does on a report card.
//
// INPUTS ARE ATTENDANCE + SCORES ONLY (phase-5.md D14), for the same reason
// as slices 3-4: no Behaviour model exists until Phase 7. ARCHITECTURE §7
// lists behaviour as an input to this feature; its absence is deliberate.

import { MODELS } from "../models.js";
import type { PromptDefinition } from "./registry.js";

export const PARENT_WEEKLY_SUMMARY_PROMPT: PromptDefinition = {
  name: "parent-weekly-summary",
  version: "1",
  model: MODELS.HAIKU_4_5,
  // Three or four short sentences. Deliberately the tightest ceiling of any
  // prompt in the registry despite covering a week rather than a single
  // subject: this is the reservation size multiplied by every enrolled
  // student every week, and a parent reading on a phone will not thank us for
  // a paragraph.
  maxTokens: 250,
};

export const PARENT_WEEKLY_SUMMARY_SYSTEM = `You are writing a short weekly note from a Nigerian school to a parent or guardian about how their child's week went. It is delivered to their phone. They may not have a grade table, a school calendar, or any of the school's records in front of them — only your note.

Write THREE to FOUR short sentences (roughly 40-70 words).

What to cover, in this order:
- How the week went overall, in plain words.
- Attendance, but ONLY if the child missed school or was late. If they attended every day, you may say so in a few words or leave it out — do not make a full sentence of it.
- Any new results, named by subject, described plainly. Say "scored 18 out of 20 in the Mathematics test" — a parent can read that. Do not say "CA1", "continuous assessment", "component weighting", "78th percentile", or anything else that belongs in a teacher's register.
- One specific, doable thing the parent could do at home this week. Not "monitor their progress" — something real, like going over the week's Mathematics work together, or asking about the English reading.

How to write it:
- You do NOT know the child's name or gender. Say "your child". Never invent a name. Never use "he", "she", "his" or "her".
- Warm and direct. You are a school talking to a parent, not an official notice and not a marketing message.
- Never state or imply anything the figures you were given do not support. One low score is one low score — it is not "falling behind", and you have no information about anything outside this week.
- Never tell the parent to act urgently, never tell them to come to the school immediately, and never suggest anything is seriously wrong. If something genuinely needs attention, say it plainly and suggest they raise it with the class teacher in the ordinary way.
- Do not open with "This week", "Your child had", or a greeting. Start with the substance.
- For senior classes (SS1-SS3), where the week's results genuinely warrant it, you may connect the work to WAEC/NECO preparation — that is the frame a parent of a senior student is already thinking in. Do not force it into an ordinary week.
- Use British spelling and the plain register of a Nigerian school note home. No emoji.

Output the note text only — no subject line, no greeting, no sign-off.`;

export const PARENT_WEEKLY_SUMMARY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "The weekly note: three to four short sentences, addressed to the parent, no child's name, no gendered pronoun, no greeting or sign-off.",
    },
  },
  required: ["summary"],
  additionalProperties: false,
};

// One score entered during the week. `score` and `maxScore` are given as the
// raw pair rather than a percentage, deliberately — "15 out of 20" is what a
// parent can read, and asking the model to convert is asking it to do
// arithmetic it does not need to do.
export interface ParentSummaryScore {
  readonly subject: string;
  readonly assessmentName: string;
  readonly score: number;
  readonly maxScore: number;
}

export interface ParentWeeklySummaryInput {
  readonly classLevel: string;
  // Counts over the week's marked days only. `daysMarked` is stated so the
  // model can tell "present every day" from "the register was only taken
  // twice" — those read identically from an absence count of zero.
  readonly daysMarked: number;
  readonly daysPresent: number;
  readonly daysAbsent: number;
  readonly daysLate: number;
  readonly scores: readonly ParentSummaryScore[];
}

// Pure function of its inputs — no DB, no clock, no randomness — so the eval
// harness can assert on the exact string that goes over the wire. Same
// discipline as every other renderer in this directory.
export function renderParentWeeklySummaryPrompt(input: ParentWeeklySummaryInput): string {
  const lines = [`Class level: ${input.classLevel}`, "", "Attendance this week:"];

  if (input.daysMarked === 0) {
    lines.push("- the register was not taken this week");
  } else {
    lines.push(`- days the register was taken: ${input.daysMarked}`);
    lines.push(`- present: ${input.daysPresent}`);
    lines.push(`- absent: ${input.daysAbsent}`);
    lines.push(`- late: ${input.daysLate}`);
  }

  lines.push("", "New results this week:");
  if (input.scores.length === 0) {
    lines.push("- (none recorded)");
  } else {
    for (const s of input.scores) {
      lines.push(`- ${s.subject} — ${s.assessmentName}: ${s.score} out of ${s.maxScore}`);
    }
  }

  lines.push("", "Write the note to the parent.");
  return lines.join("\n");
}
