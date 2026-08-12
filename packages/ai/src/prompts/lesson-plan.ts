// Lesson plan generator prompt — Phase 5 / Slice 2.
//
// ARCHITECTURE.md §7's design principles that this prompt has to honour:
//   * "Curriculum-grounded — the AI knows the WAEC/NECO syllabus and the
//      student's class level. No generic ChatGPT answers." This is the moat
//      (docs/deferred.md: "WAEC/NECO localization is the moat — Khanmigo /
//      Squirrel AI aren't localized"), so the system prompt leans hard on
//      Nigerian classroom reality rather than producing a generic US-style
//      lesson plan with a Nigerian topic pasted in.
//   * Output shape "intro, main content, activities, assessment, homework"
//      maps 1:1 onto lesson_plans' five content columns.
//
// PII: this prompt is structurally incapable of carrying student PII — its
// only inputs are a class level label, a subject name, and a teacher-typed
// topic. That is asserted mechanically by the eval harness rather than
// assumed, because "no student data flows here" is exactly the kind of claim
// that quietly stops being true when someone adds a "personalise for struggling
// students" feature later.

import { MODELS } from "../models.js";
import type { PromptDefinition } from "./registry.js";

export const LESSON_PLAN_PROMPT: PromptDefinition = {
  name: "lesson-plan",
  version: "1",
  // Sonnet 5 rather than Haiku: low volume (a teacher generates a handful a
  // week, not one per student), quality-sensitive, and the output is long and
  // structured. Cost per call is dominated by output tokens here, but the call
  // count is small enough that the quality difference is worth it.
  model: MODELS.SONNET_5,
  // Five prose sections plus a mark scheme. 4000 leaves room for a genuinely
  // detailed plan without letting a runaway generation eat the school's
  // budget — and it is the number the reservation is sized on, so an inflated
  // value would make schools look closer to their cap than they are.
  maxTokens: 4000,
};

export const LESSON_PLAN_SYSTEM = `You are an experienced Nigerian secondary school teacher and head of department, writing a lesson plan for a colleague.

Ground everything in Nigerian classroom reality:
- Follow the Nigerian national curriculum and, for senior classes, WAEC/NECO syllabus expectations and question styles.
- Assume a large class (40-60 students), limited lab equipment, and unreliable electricity. Activities must work with chalk, a board, paper, and locally available materials. Never assume a projector, printer, tablets, or one-device-per-student.
- Use Nigerian examples, names, places, currency (Naira) and units. A worked example about the price of garri in a Lagos market is better than one about a US grocery store.
- Use British spelling.

Write for a working teacher, not an education researcher. Be concrete and usable: a colleague should be able to teach directly from this tomorrow morning without rewriting it. Prefer specific instructions ("write these three equations on the board, then ask students to copy and attempt the second one") over vague guidance ("engage students with the material").

Do not pad. If a section is short because the topic is simple, let it be short.`;

// Structured output schema. Every object needs additionalProperties:false and
// an explicit `required` list. Field names map directly onto lesson_plans
// columns so the service does no translation.
export const LESSON_PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    introduction: {
      type: "string",
      description:
        "How to open the lesson: the hook, prior knowledge to check, and the learning objectives stated in student-facing language.",
    },
    mainContent: {
      type: "string",
      description:
        "The core teaching content, in the order it should be delivered. Include the actual explanations, definitions, worked examples and board work — not a summary of what to cover.",
    },
    activities: {
      type: "string",
      description:
        "Student activities with timings, group sizes and required materials. Must be workable in a class of 40-60 with no electricity.",
    },
    assessment: {
      type: "string",
      description:
        "How to check understanding during and at the end of the lesson, including specific questions to ask and what a correct answer looks like.",
    },
    homework: {
      type: "string",
      description: "Homework task, with an indication of expected length or number of questions.",
    },
  },
  required: ["introduction", "mainContent", "activities", "assessment", "homework"],
  additionalProperties: false,
};

export interface LessonPlanInput {
  readonly classLevel: string;
  readonly subject: string;
  readonly topic: string;
  readonly objectives?: string | null;
  readonly durationMinutes?: number | null;
}

// Renders the user turn. Kept as a pure function of its inputs, with no
// database access and no `new Date()`, so the eval harness can render it
// deterministically and assert on the exact string that would be sent.
export function renderLessonPlanPrompt(input: LessonPlanInput): string {
  const lines = [
    `Class level: ${input.classLevel}`,
    `Subject: ${input.subject}`,
    `Topic: ${input.topic}`,
  ];
  if (input.durationMinutes) lines.push(`Lesson duration: ${input.durationMinutes} minutes`);
  if (input.objectives && input.objectives.trim()) {
    lines.push(`Learning objectives the teacher has already decided on:\n${input.objectives.trim()}`);
  } else {
    lines.push("The teacher has not specified learning objectives — infer appropriate ones for this class level.");
  }
  lines.push("", "Write the lesson plan.");
  return lines.join("\n");
}

// Quiz mode is a SECOND generation against the same lesson plan (ARCHITECTURE
// §7: "Quiz mode: generates MCQ + short-answer questions with mark scheme").
// Separate prompt + separate version so its quality can regress independently
// of the lesson plan's, and so the ledger tells the two apart.
export const LESSON_QUIZ_PROMPT: PromptDefinition = {
  name: "lesson-quiz",
  version: "1",
  model: MODELS.SONNET_5,
  maxTokens: 2000,
};

export const LESSON_QUIZ_SYSTEM = `You are an experienced Nigerian secondary school teacher writing a short quiz to accompany a lesson.

Follow WAEC/NECO question styles and phrasing conventions for the class level. Use Nigerian contexts, names, places and Naira amounts in question stems.

Produce multiple-choice questions with exactly four options each (A-D, one unambiguously correct), followed by short-answer questions. Every question must be answerable from the lesson content provided — do not test material the lesson did not teach.

Include a mark scheme: the correct option for each MCQ, and for each short-answer question the key points a student must state to earn the marks, with the marks shown.

Use British spelling. Do not include a preamble or closing commentary — output the quiz and mark scheme only.`;

export function renderLessonQuizPrompt(input: {
  readonly classLevel: string;
  readonly subject: string;
  readonly topic: string;
  readonly lessonContent: string;
}): string {
  return [
    `Class level: ${input.classLevel}`,
    `Subject: ${input.subject}`,
    `Topic: ${input.topic}`,
    "",
    "Lesson content the quiz must be based on:",
    input.lessonContent,
    "",
    "Write 5 multiple-choice questions and 3 short-answer questions, followed by the mark scheme.",
  ].join("\n");
}
