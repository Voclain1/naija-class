// Form teacher's report-card comment prompt — Phase 5 / Slice 4.
//
// One comment per (student, term): the form teacher's holistic remark on the
// termly report card, written after every subject has been signed off. Where
// slice 3's subject comment interprets ONE subject's component scores, this one
// interprets the whole child across every subject — overall average, position
// in the class, the spread between their strongest and weakest subjects, and
// attendance.
//
// MODEL: Haiku 4.5 (phase-5.md D7), same reasoning as the subject comment —
// one call per student per term, short structured output, high volume.
//
// WHY A SEPARATE PROMPT AND VERSION rather than a mode flag on the subject
// comment: different inputs, different cardinality, and a different author with
// a different job. A subject teacher says "the exam paper showed rushed
// working"; a form teacher says "strong in the sciences, but English is now the
// subject holding the average down". Sharing a prompt would force both through
// one set of instructions and make either one's quality regression invisible in
// the other's eval — and the ai_generations ledger could no longer tell the two
// apart by promptName.
//
// PII: identical posture to the subject comment. No name, admission number,
// DOB, gender or contact detail — subject names, grades, positions, counts and
// an attendance percentage only. The system prompt must therefore forbid
// inventing a name and forbid gendered pronouns, because the model has no way
// to know either and a report card that guesses wrong is worse than one that
// avoids the construction entirely. Asserted mechanically in the eval suite.
//
// INPUTS ARE SCORES + ATTENDANCE ONLY (phase-5.md D14) — no behaviour model
// exists until Phase 7, so ARCHITECTURE §7's behaviour input is deliberately
// absent rather than quietly forgotten.

import { MODELS } from "../models.js";
import type { PromptDefinition } from "./registry.js";

export const REPORT_CARD_FORM_COMMENT_PROMPT: PromptDefinition = {
  name: "report-card-form-comment",
  version: "1",
  model: MODELS.HAIKU_4_5,
  // Slightly higher than the subject comment's 200: a form comment covers the
  // whole child and runs two to three sentences rather than one to two. Still
  // tight — this is the number the budget reservation is sized on, and one per
  // student per term across a school is a lot of reservations.
  maxTokens: 300,
};

export const REPORT_CARD_FORM_COMMENT_SYSTEM = `You are an experienced Nigerian secondary school form teacher (class teacher) writing the form teacher's comment on a student's termly report card. A parent or guardian will read it, alongside the subject teachers' comments and the full grade table.

Write TWO to THREE sentences (roughly 35-60 words).

Ground it in the specific figures you are given:
- Speak to the overall picture first: the average, and the position in the class if you are given one.
- Name actual subjects. "Strong in Mathematics and Basic Science, but English Language is holding the average down" is useful; "performed well in some subjects" is not.
- Mention attendance ONLY when it is poor enough to matter (below about 85%), and connect it to the performance rather than listing it.
- Never state or imply a figure you were not given, and do not restate the grade table — the parent can already see it. Interpret it.
- Close with one concrete, specific thing that would improve next term.

How to write it:
- You do NOT know the student's name or gender. Never invent a name. Never use "he", "she", "his" or "her". Write so that no pronoun is needed ("Has settled well into...", "A steady term overall, with...").
- Be honest. A weak term described as "fair effort" misleads a parent who needs to act, and the grade table beside your comment will contradict you.
- Do not open with "This student", "The student", or the grade band ("Excellent result...", "Good performance..."). Those are the openers that make a whole arm's report cards read as one template.
- For senior classes (SS1-SS3), where the figures warrant it, frame the comment against WAEC/NECO readiness — that is what a parent of a senior student is actually asking.
- Use British spelling and the register of a Nigerian secondary school report card. Address the work and the habits behind it, not the child's character.

Output the comment text only — no preamble, no quotation marks, no sign-off.`;

export const REPORT_CARD_FORM_COMMENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    comment: {
      type: "string",
      description:
        "The form teacher's comment: two to three sentences, no student name, no gendered pronoun, no preamble.",
    },
  },
  required: ["comment"],
  additionalProperties: false,
};

// One subject's outcome for this student this term. `score` is the materialised
// Assessment.totalScore (0-100); `grade` is the school's own letter.
export interface FormCommentSubjectResult {
  readonly subject: string;
  readonly score: number | null;
  readonly grade: string | null;
}

export interface ReportCardFormCommentInput {
  readonly classLevel: string;
  readonly termName: string;
  readonly subjects: readonly FormCommentSubjectResult[];
  // Percent, 0-100. Derived from ReportCard.overallAverage, which is stored in
  // hundredths — the caller converts, so this prompt never has to know that.
  readonly overallAverage: number | null;
  readonly overallPosition: number | null;
  readonly classSize: number | null;
  readonly attendanceRate: number | null;
}

// Pure function of its inputs — no DB, no clock, no randomness — so the eval
// harness can assert on the exact string that would go over the wire. Same
// discipline as every other renderer in this directory.
export function renderReportCardFormCommentPrompt(input: ReportCardFormCommentInput): string {
  const lines = [
    `Class level: ${input.classLevel}`,
    `Term: ${input.termName}`,
    "",
    "Results this term:",
  ];

  if (input.subjects.length === 0) {
    lines.push("- (no subject results recorded)");
  } else {
    for (const s of input.subjects) {
      const score = s.score === null ? "no score" : `${s.score}`;
      lines.push(`- ${s.subject}: ${score}${s.grade ? ` (${s.grade})` : ""}`);
    }
  }

  if (input.overallAverage !== null) lines.push(`Overall average: ${input.overallAverage}%`);
  if (input.overallPosition !== null && input.classSize !== null) {
    lines.push(`Position in class: ${input.overallPosition} of ${input.classSize}`);
  }

  // Stated either way — "not recorded" is meaningfully different from "fine",
  // and omitting the line lets the model assume the second.
  lines.push(
    input.attendanceRate !== null
      ? `Attendance this term: ${input.attendanceRate}%`
      : "Attendance this term: not recorded",
  );

  lines.push("", "Write the form teacher's comment.");
  return lines.join("\n");
}
