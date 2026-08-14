// Report-card subject comment prompt — Phase 5 / Slice 3.
//
// One comment per (student, subject, term): the sentence a teacher writes in
// the "comment" line of a termly report card, read by a parent.
//
// MODEL: Haiku 4.5 (phase-5.md D7). This is by far the highest-volume AI
// feature in the phase — one call per student per subject per term, so a
// single JSS 2 arm of 40 students across 9 subjects is 360 calls a term,
// against a handful of lesson plans. Short, structured, high-volume output is
// exactly Haiku's case, and it is also the tier that would accept a
// `temperature` if we ever plumb one through.
//
// VARIETY WITHOUT A SAMPLING PARAMETER: 30 comments that all read "Shows a
// good understanding of the subject" are worse than useless — a parent
// comparing report cards with another parent sees the template immediately,
// and the teacher's credibility goes with it. D7 allows two mechanisms for
// variety on this tier: `temperature`, or prompt design. The shared
// AiCallRequest contract carries no temperature field today, and widening a
// slice-1 infrastructure contract from inside a feature slice is not a trade
// worth making, so this prompt does it by design instead:
//   * each student's component spread, position and attendance genuinely
//     differ, and the prompt is instructed to key the comment to THOSE
//     specifics rather than to the grade band, so the input varies per call;
//   * the system prompt bans the stock openers explicitly, which is what
//     actually collapses a batch into a template.
// If comments still read samey against real output, plumbing `temperature`
// through AiCallRequest is the next move — not a bigger model.
//
// PII (CLAUDE.md hard rule: never send student PII to the LLM): the input
// carries NO name, admission number, date of birth, contact detail or gender.
// It is scores, a class level label, a subject name and an attendance rate.
// Two consequences the system prompt has to handle, because the model cannot
// paper over them: it must never invent a name, and it must never use a
// gendered pronoun — it does not know, and a report card that calls a girl
// "he" is worse than one with no pronoun at all. Asserted mechanically by the
// PII eval suite, not left as a convention.
//
// INPUTS ARE SCORES + ATTENDANCE ONLY (phase-5.md D14). ARCHITECTURE §7 also
// lists behaviour as an input; there is no Behaviour model in this codebase
// (Phase 7), so it is stated here as a deliberate v1 omission rather than
// left for a reader to wonder about.

import { MODELS } from "../models.js";
import type { PromptDefinition } from "./registry.js";

export const REPORT_CARD_COMMENT_PROMPT: PromptDefinition = {
  name: "report-card-subject-comment",
  // v2 (2026-08-14) — bumped after the FIRST real generations this prompt has
  // ever produced, on the day an API key was finally configured. Two defects
  // showed up immediately that 154 structural eval checks could not see,
  // because in both cases the instruction was present and simply not followed:
  //
  //   1. It invented curriculum content. "Focused revision of fundamentals in
  //      algebra and number work" — for a class whose syllabus it was never
  //      told. On a termly report card a parent keeps, that makes a teacher
  //      look careless about their own class.
  //   2. It restated raw marks ("the exam performance of 33/60") despite
  //      being told to interpret rather than restate. The old wording buried
  //      that rule in a compound bullet with the don't-invent-figures rule;
  //      v2 splits them and spells out the failure with examples.
  //
  // The lesson generalises beyond this prompt: an instruction being IN a
  // system prompt is not evidence it is being followed, and only real output
  // shows the difference. See phase-5.md §9.
  version: "2",
  model: MODELS.HAIKU_4_5,
  // A report-card comment is one or two sentences. 200 is deliberately tight:
  // maxTokens is what the budget reservation is sized on, and at ~360 calls
  // per arm per term an inflated ceiling would make a school look near its cap
  // for output it never generates. It also acts as a structural brake on the
  // model writing a paragraph where a line is wanted.
  maxTokens: 200,
};

export const REPORT_CARD_COMMENT_SYSTEM = `You are an experienced Nigerian secondary school subject teacher writing the comment line on a student's termly report card. A parent or guardian will read it.

Write ONE comment of one to two sentences (roughly 20-40 words).

Ground it in the specific figures you are given:
- Refer to what the component scores actually show — a strong exam after weak continuous assessment, a slide across the term, a consistent performance, a single component dragging the total down.
- Mention attendance ONLY when it is poor enough to matter (below about 85%) and connect it to the performance.
- Never state or imply a figure you were not given.
- Never repeat a score back as a number. Not "scored 33/60", not "the exam mark of 33", not "at 56%". The full table of marks is printed directly beside your comment; a comment that repeats it has said nothing. Describe what the pattern means instead.

You do NOT know what this class was taught this term:
- You are given a subject name and nothing else about the syllabus. Never name a topic, subtopic or skill — not "algebra", not "number work", not "essay structure", not "titration".
- Naming one is a guess, and a wrong guess in front of a parent makes the teacher look careless about a class they actually taught.
- When you recommend an improvement, make it about the work and the habits behind it, which you CAN see in the figures: revising the exam paper with the teacher, closing the gap between classwork and exam performance, more practice on the questions missed in class, steadier effort across the term rather than a late rush.

How to write it:
- You do NOT know the student's name or gender. Never invent a name. Never use "he", "she", "his" or "her". Write so that no pronoun is needed — start with the verb or the subject ("Shows a firm grasp of...", "Mathematics remains a challenge...", "A strong end to the term in...").
- Be honest. A weak result described as "satisfactory progress" misleads a parent who needs to act. Say plainly what is weak, then give one concrete next step of the kind described above — specific about the work, never about a topic you were not told was taught.
- For senior classes (SS1-SS3), where it is relevant to the figures, frame the comment against WAEC/NECO readiness — that is what a parent of a senior student is actually asking about. Do not force this into junior-class comments.
- Do not open with "This student", "The student", or the grade band ("Excellent performance...", "Good effort..."). Those are the phrases that make a class set of 40 comments read as a template.
- Use British spelling and the register of a Nigerian secondary school report card. Address the work, not the child's character.

Output the comment text only — no preamble, no quotation marks, no sign-off.`;

// Structured output rather than bare prose: the response is written to a DB
// column, and "the model added a friendly preamble before the comment" is a
// real failure mode when the output is a single short string.
export const REPORT_CARD_COMMENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    comment: {
      type: "string",
      description:
        "The report card comment: one to two sentences, no student name, no gendered pronoun, no preamble.",
    },
  },
  required: ["comment"],
  additionalProperties: false,
};

// One scored component of the subject — the grain a teacher enters marks at
// (CA1, CA2, Exam, ...). `max` is carried so the model can read 14/20 and
// 14/100 differently.
export interface ReportCardCommentComponent {
  readonly label: string;
  readonly score: number;
  readonly max: number;
}

export interface ReportCardCommentInput {
  readonly classLevel: string;
  readonly subject: string;
  readonly components: readonly ReportCardCommentComponent[];
  readonly totalScore: number | null;
  readonly letterGrade: string | null;
  // The school's own remark for that grade band ("Credit", "Pass"), when set.
  readonly remark: string | null;
  // Position in the subject within the arm, and how many students that is out
  // of — "8th" means nothing without the cohort size.
  readonly subjectPosition: number | null;
  readonly classSize: number | null;
  // Percentage 0-100 for the term, or null when attendance was never marked.
  readonly attendanceRate: number | null;
}

// Pure function of its inputs: no DB access, no `new Date()`, no randomness,
// so the eval harness can render it and assert on the exact string that would
// go over the wire. Every renderer in this directory holds to that.
export function renderReportCardCommentPrompt(input: ReportCardCommentInput): string {
  const lines = [`Class level: ${input.classLevel}`, `Subject: ${input.subject}`, "", "Scores this term:"];

  if (input.components.length === 0) {
    lines.push("- (no component scores recorded)");
  } else {
    for (const c of input.components) {
      lines.push(`- ${c.label}: ${c.score} out of ${c.max}`);
    }
  }

  if (input.totalScore !== null) lines.push(`Total: ${input.totalScore}`);
  if (input.letterGrade) {
    lines.push(`Grade: ${input.letterGrade}${input.remark ? ` (${input.remark})` : ""}`);
  }
  if (input.subjectPosition !== null && input.classSize !== null) {
    lines.push(`Position in this subject: ${input.subjectPosition} of ${input.classSize}`);
  }

  // Stated either way. "Attendance was not marked" is meaningfully different
  // from "attendance was fine", and omitting the line entirely would let the
  // model assume the second.
  lines.push(
    input.attendanceRate !== null
      ? `Attendance this term: ${input.attendanceRate}%`
      : "Attendance this term: not recorded",
  );

  lines.push("", "Write the report card comment.");
  return lines.join("\n");
}
