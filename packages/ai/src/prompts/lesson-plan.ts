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
  // v3 (Phase 7 / CP3): adds curriculum grounding. The registry pins name +
  // version into every ai_generations row, so v2 and v3 are separable in the
  // ledger and A/B-able with the evals/ab-lesson-plan-format.ts pattern.
  //
  // The version bumps even though the SYSTEM prompt is unchanged, because what
  // reaches the model genuinely differs: a grounded call carries the school's
  // own scheme of work. A ledger that could not distinguish the two would make
  // any later quality comparison meaningless.
  version: "3",
  // Sonnet 5 rather than Haiku: low volume (a teacher generates a handful a
  // week, not one per student), quality-sensitive, and the output is long and
  // structured. Cost per call is dominated by output tokens here, but the call
  // count is small enough that the quality difference is worth it.
  model: MODELS.SONNET_5,
  // Eight prose sections. 4000 leaves room for a genuinely detailed plan
  // without letting a runaway generation eat the school's budget — and it is
  // the number the reservation is sized on, so an inflated value would make
  // schools look closer to their cap than they are. Held at 4000 across the
  // v1 -> v2 restructure: v2 has more sections but they are individually
  // shorter (materials and references are lists, not prose), and the live
  // eval asserts stop_reason != max_tokens, so a real overflow fails loudly
  // rather than silently truncating a teacher's Conclusion.
  maxTokens: 4000,
};

// v2 (2026-08-17) — STRUCTURE ONLY. v1's teaching content was good; what was
// wrong was the shape. v1 emitted a generic international lesson plan
// (objectives -> warm-up -> instruction -> practice -> wrap-up), which is not
// what a Nigerian teacher writes in a scheme book and not what a head of
// department or an inspector expects to see. Reported from Virgo Fidelis's
// first pilot generation.
//
// v2 emits the conventional Nigerian lesson note: behavioural objectives in
// the "By the end of the lesson, pupils should be able to..." form,
// Instructional Materials, Previous Knowledge / Entry Behaviour, Reference
// Materials, a Presentation broken into numbered Steps, Evaluation,
// Assignment, and Conclusion.
//
// The section ORDER is enforced by the schema's `required` array and asserted
// by the eval suite, not left to the prose below — a model that reorders
// sections produces a document a teacher has to reshuffle by hand, which is
// exactly the defect being fixed here.
//
// NOT generated, deliberately: the header block (Subject, Class, Date, Time,
// Duration) and the Topic. Subject, class and duration are already structured
// columns on the row, and Topic is the teacher's own input — regenerating them
// as prose would let the model contradict the record it is attached to. Date
// and Time are rendered as blank fill-in lines because a lesson note is dated
// when it is taught, not when it is drafted, and a model inventing a date is a
// wrong date. The teacher UI composes that header from the row; see the
// lesson-plan detail page.
export const LESSON_PLAN_SYSTEM = `You are an experienced Nigerian secondary school teacher and head of department, writing a lesson note for a colleague.

Write it in the standard Nigerian lesson note format, in this order: Behavioural Objectives, Instructional Materials, Previous Knowledge, Reference Materials, Presentation, Evaluation, Assignment, Conclusion. This is the format teachers copy into their scheme books and that head teachers and inspectors check, so the shape matters as much as the content.

Section conventions to follow exactly:
- Behavioural objectives open with "By the end of the lesson, pupils should be able to:" and are then listed as numbered, observable outcomes starting with a measurable verb (state, define, identify, calculate, describe, demonstrate). Avoid unobservable verbs like "understand", "know" or "appreciate".
- Instructional materials are the physical items to bring to class, listed. Chalk, a chalkboard, a wall chart you draw yourself, a real leaf, sachet water, a plastic bottle — things that actually exist in the room.
- Previous knowledge states what the pupils already know that this lesson builds on, phrased as a fact about the pupils ("Pupils have already learnt...").
- Reference materials cite real, commonly used Nigerian textbooks and syllabus documents for the class level, with author, title and edition where you are confident of them. If you are not confident a specific book exists, cite the curriculum or syllabus rather than inventing a title, author or edition.
- The presentation is broken into clearly labelled steps — Step 1, Step 2, Step 3 and so on. Each step names what the teacher does and what the pupils do in response. This is where the actual teaching lives: the explanations, definitions, worked examples and board work, in the order they happen.
- Evaluation is a short list of specific questions to ask the class to check the objectives were met, not a description of how you would assess.
- The assignment is the task pupils take home, with the number of questions or expected length.
- The conclusion is how the lesson is closed: what is summarised on the board and what pupils copy into their notes.

Ground everything in Nigerian classroom reality:
- Follow the Nigerian national curriculum and, for senior classes, WAEC/NECO syllabus expectations and question styles.
- Assume a large class (40-60 pupils), limited lab equipment, and unreliable electricity. Every activity must work with chalk, a board, paper, and locally available materials. Never assume a projector, printer, tablets, or one-device-per-pupil.
- Use Nigerian examples, names, places, currency (Naira) and units. A worked example about the price of garri in a Lagos market is better than one about a US grocery store.
- Use British spelling.

Write for a working teacher, not an education researcher. Be concrete and usable: a colleague should be able to teach directly from this tomorrow morning without rewriting it. Prefer specific instructions ("write these three equations on the board, then ask pupils to copy and attempt the second one") over vague guidance ("engage pupils with the material").

Do not pad. If a section is short because the topic is simple, let it be short.`;

// Structured output schema. Every object needs additionalProperties:false and
// an explicit `required` list. Field names map directly onto lesson_plans
// columns so the service does no translation.
//
// The `required` array is in Nigerian lesson-note order and is the machine-
// readable source of truth for that order — LESSON_PLAN_SECTION_ORDER below is
// derived from it rather than repeated, so the two cannot drift.
//
// `mainContent`, `assessment` and `homework` keep their v1 column names while
// carrying the v2 sections (Presentation, Evaluation, Assignment). The names
// are generic enough to stay accurate, and reusing them means the restructure
// needs no data migration and no column rename. `introduction` and
// `activities` are NOT in this schema any more: v1's Introduction is replaced
// by Previous Knowledge plus Behavioural Objectives, and v1's separate
// Activities section is folded into the Presentation steps, where the Nigerian
// format puts pupil activity. Both columns remain on the table, unpopulated,
// so pre-v2 rows stay readable.
export const LESSON_PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    behaviouralObjectives: {
      type: "string",
      description:
        'Behavioural/instructional objectives. Must open with "By the end of the lesson, pupils should be able to:" followed by numbered, observable outcomes each starting with a measurable verb.',
    },
    instructionalMaterials: {
      type: "string",
      description:
        "The physical teaching materials to bring to the class, as a list. Must be items available in an ordinary Nigerian classroom — no projector, printer or per-pupil device.",
    },
    previousKnowledge: {
      type: "string",
      description:
        'Previous knowledge / entry behaviour: what the pupils already know that this lesson builds on, phrased as a fact about the pupils (e.g. "Pupils have already learnt...").',
    },
    referenceMaterials: {
      type: "string",
      description:
        "Reference materials and textbooks for this class level, with author, title and edition where known. Cite the curriculum or syllabus rather than inventing a title, author or edition.",
    },
    mainContent: {
      type: "string",
      description:
        "The Presentation, broken into clearly labelled steps (Step 1, Step 2, Step 3...). Each step states what the teacher does and what the pupils do. Include the actual explanations, definitions, worked examples and board work — not a summary of what to cover.",
    },
    assessment: {
      type: "string",
      description:
        "Evaluation: the specific questions to ask the class to check each objective was met. Actual questions, not a description of how assessment would be carried out.",
    },
    homework: {
      type: "string",
      description:
        "Assignment/homework task for pupils to take home, with the number of questions or expected length.",
    },
    conclusion: {
      type: "string",
      description:
        "Conclusion/summary: how the lesson is closed — what the teacher summarises on the board and what the pupils copy into their notes.",
    },
  },
  required: [
    "behaviouralObjectives",
    "instructionalMaterials",
    "previousKnowledge",
    "referenceMaterials",
    "mainContent",
    "assessment",
    "homework",
    "conclusion",
  ],
  additionalProperties: false,
};

// Canonical section order, derived from the schema so the two cannot drift.
// The service, the teacher UI and the eval suite all read this rather than
// hard-coding their own list — an ordering regression then fails in one place
// instead of rendering a scrambled note.
export const LESSON_PLAN_SECTION_ORDER = LESSON_PLAN_SCHEMA.required as readonly string[];

/** One retrieved curriculum chunk, as the prompt sees it. */
export interface LessonPlanGroundingChunk {
  /** Citable path, e.g. "First Term > WEEK 5". Null when the chunker found no structure. */
  readonly heading: string | null;
  readonly content: string;
  /** The uploaded document's title, so the model can name its source. */
  readonly documentTitle: string;
}

export interface LessonPlanInput {
  readonly classLevel: string;
  readonly subject: string;
  readonly topic: string;
  readonly objectives?: string | null;
  readonly durationMinutes?: number | null;
  /**
   * Retrieved chunks of the school's own scheme of work. Empty or omitted is a
   * FIRST-CLASS case, not a degraded one — see the render function.
   */
  readonly groundingChunks?: readonly LessonPlanGroundingChunk[];
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
  // ---- curriculum grounding (v3) ----------------------------------------
  //
  // ONE prompt with a conditional block, not two prompts. Two would drift, and
  // only one of them would ever get an eval written for it — so the empty case
  // is handled INSIDE this function, where the same string is under test.
  const grounding = input.groundingChunks ?? [];
  if (grounding.length > 0) {
    lines.push(
      "",
      "--- THIS SCHOOL'S OWN SCHEME OF WORK ---",
      "The sections below are extracted from the scheme of work this school actually uses.",
      "Prefer them over your own knowledge wherever they differ: they are what this",
      "school's inspectors and head teacher will check the lesson against.",
      "Draw the Reference Materials section from these sections, citing them by their",
      "heading, rather than naming textbooks you were not given.",
      "",
    );
    grounding.forEach((chunk, i) => {
      const label = chunk.heading ? `${chunk.documentTitle} — ${chunk.heading}` : chunk.documentTitle;
      lines.push(`[${i + 1}] ${label}`, chunk.content.trim(), "");
    });
    lines.push("--- END OF SCHEME OF WORK EXTRACT ---");
  } else {
    // Said explicitly rather than by silence. Without this the model has no way
    // to know whether it was given a curriculum and ignored it, and the v3
    // instruction to "draw Reference Materials from the sections above" would
    // refer to nothing — inviting it to invent sections that look cited.
    lines.push(
      "",
      "No scheme of work has been uploaded for this subject and class level, so no",
      "curriculum extract is provided. Write the plan from your knowledge of the",
      "Nigerian curriculum, and keep Reference Materials to widely-available texts",
      "rather than inventing a specific page or week reference.",
    );
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
