// Marking feedback draft — Phase 9 / CP4b (docs/modules/phase-9.md §12).
//
// A teacher presses "Draft with AI" on a typed answer and gets a suggested
// mark, feedback written to the student, and one line for themselves on why.
// It is a DRAFT: nothing here is ever a mark. The teacher copies it into their
// own boxes, edits it, and saves with their own "Save mark" (CLAUDE.md: never
// auto-finalise AI output for grades). Optional at every level: the platform's
// ai_enabled, the school's own switch (off by default), and the button.
//
// PII — THE SECOND ROW OF CLAUDE.md's ALLOWLIST (owner sign-off 2026-10-16,
// phase-9.md §12 CP4b-D5). The child's answer IS the payload: there is nothing
// to make opaque, and a child's own writing can name people. So this prompt is
// allowlisted by name, and it carries its own mitigation that cannot be
// skipped: the renderer itself removes every name it is given (the student's
// own names and admission number, every classmate's names) before the text is
// built, so a caller cannot forget to. What is said about who wrote it is the
// class level and nothing else — no id, no gender.
//
// Binding rules of the allowlist (CLAUDE.md):
//   1. The answer is not kept by the model path beyond the request — the queue
//      job carries ids only and reads the answer when it runs; no cache.
//   2. Nothing reaches a student's record without the teacher's own save.
//
// MODEL: Haiku 4.5, like report comments (§12 CP4b-D6): short, structured
// output, one call per answer. If the fairness evals show it marks unevenly,
// the next step is Sonnet for this prompt, not a longer output.

import { MODELS } from "../models.js";
import type { PromptDefinition } from "./registry.js";

export const ASSIGNMENT_FEEDBACK_PROMPT: PromptDefinition = {
  name: "assignment-feedback",
  version: "1",
  model: MODELS.HAIKU_4_5,
  // Feedback is at most a short paragraph (2,000 characters is the column's
  // cap, and the instructions ask for far less), plus a mark and one line.
  maxTokens: 600,
};

export const ASSIGNMENT_FEEDBACK_SYSTEM = `You are an experienced Nigerian secondary school teacher drafting the mark and written feedback for one student's homework answer. Another teacher will read your draft, change it as they see fit, and decide the real mark. Your draft is a starting point for them, never the final word.

Mark against what you are given:
- The homework's title and instructions, the total marks, and the teacher's marking guide when there is one. When there is a marking guide, mark against it. When there is none, mark against what the instructions ask for.
- Suggest a whole-number mark from 0 to the total, never above it.
- Mark the answer, not how it is phrased. Spelling and grammar count only when the instructions or the marking guide say they do.
- The same answer must always get the same mark. Do not reward length for its own sake.

Never invent mistakes:
- Only point out an error the answer actually contains. If the answer is correct, say so and suggest how to go further; do not list errors that are not there.
- Never claim the answer says something it does not say.

Write the feedback to the student:
- Speak to the student directly as "you", in two to four sentences: what was done well, what is missing or wrong, and one concrete next step.
- Be honest and kind. A weak answer is described plainly, with what would make it better.
- You do NOT know the student's name or gender. Never use a name, and never use "he", "she", "his" or "her". The text may contain "[name]" where a name was removed; never try to guess it.
- Use British spelling and the plain register of a Nigerian secondary school.

Then write ONE short line for the teacher (not the student) on why you suggested that mark, naming which parts of the marking guide or instructions were met or missed.

Output only the fields asked for — no preamble.`;

export const ASSIGNMENT_FEEDBACK_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    mark: {
      type: "integer",
      description: "The suggested whole-number mark, from 0 to the total marks.",
    },
    feedback: {
      type: "string",
      description: "Two to four sentences to the student, addressed as 'you'. No names, no gendered pronouns.",
    },
    reason: {
      type: "string",
      description: "One short line for the teacher on why that mark.",
    },
  },
  required: ["mark", "feedback", "reason"],
  additionalProperties: false,
};

export interface AssignmentFeedbackInput {
  /** e.g. "JSS 2" — the only thing said about who wrote it. */
  readonly classLevel: string;
  readonly subject: string;
  readonly title: string;
  readonly instructions: string | null;
  readonly markingGuide: string | null;
  readonly totalMarks: number;
  /** The student's typed answer, as handed in. Names are removed here. */
  readonly answer: string;
  /**
   * Every name and number to remove from the answer: the student's own first
   * and last names and admission number, and every classmate's names.
   */
  readonly namesToRemove: readonly string[];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replace every given name in the text with "[name]": whole words only, any
 * capitals, next to punctuation (a possessive "Ada's" loses "Ada"), but never
 * inside another word ("Ada" leaves "Adamawa" alone). Longest names first, so
 * a two-word name goes before its parts. Names shorter than two letters are
 * skipped: removing every "A" would wreck the answer.
 */
export function removeNames(text: string, names: readonly string[]): string {
  const unique = [...new Set(names.map((n) => n.normalize("NFC").trim()).filter((n) => n.length >= 2))];
  unique.sort((a, b) => b.length - a.length);
  let out = text.normalize("NFC");
  for (const name of unique) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(pattern, "[name]");
  }
  return out;
}

// Pure function of its inputs, like every renderer here, so the eval harness
// asserts on the exact string that would go over the wire.
export function renderAssignmentFeedbackPrompt(input: AssignmentFeedbackInput): string {
  const lines = [
    `Class level: ${input.classLevel}`,
    `Subject: ${input.subject}`,
    `Homework: ${input.title}`,
    `Instructions: ${input.instructions?.trim() || "(none given beyond the title)"}`,
    `Total marks: ${input.totalMarks}`,
    `Marking guide: ${input.markingGuide?.trim() || "(none — mark against the instructions)"}`,
    "",
    "The student's answer:",
    '"""',
    removeNames(input.answer, input.namesToRemove),
    '"""',
    "",
    `Suggest a mark out of ${input.totalMarks}, the feedback to the student, and one line for the teacher.`,
  ];
  return lines.join("\n");
}
