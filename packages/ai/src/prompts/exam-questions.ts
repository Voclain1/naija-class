// Exam question drafting — Phase 8c / CP5b (docs/modules/phase-8.md §22.2).
//
// Drafts questions for a school's question bank: a subject, a class level, a
// topic, a question type, a difficulty and a count. Grounded, like the lesson
// plan, in the school's own scheme of work through the Phase 7 retrieval.
//
// WHAT THE OUTPUT IS: DRAFTS. Every question this prompt produces is saved as
// a DRAFT and reaches an exam paper only after the subject teacher or an admin
// approves it (D62). The prompt says so to the model too, so it writes for a
// reviewer rather than pretending to be final.
//
// PII: structurally none. The inputs are a class level label, a subject name,
// a teacher-typed topic, a type, a difficulty and a count. No student is in
// scope at any point — a question bank is about a syllabus, not a child.
// Asserted mechanically by the PII eval suite rather than assumed.

import { MODELS } from "../models.js";
import type { PromptDefinition } from "./registry.js";

export const EXAM_QUESTIONS_PROMPT: PromptDefinition = {
  name: "exam-questions",
  version: "1",
  // Sonnet 5, as for lesson plans: low volume (a teacher drafts a batch while
  // setting a paper, not one per student), and quality is the whole product —
  // an ambiguous stem or a wrong key costs a teacher more time than it saves.
  model: MODELS.SONNET_5,
  // Ten theory questions with marking guides is the worst case the request
  // schema allows (QUESTION_GENERATE_MAX). About 500 tokens each, with
  // headroom. This is also the output half of the budget reservation.
  maxTokens: 6000,
};

export const EXAM_QUESTIONS_SYSTEM = `You are an experienced Nigerian secondary school teacher and examiner, drafting questions for your school's question bank. A colleague will review every question before it is used, so write each one ready to approve: clear, correct, and fair.

Follow the Nigerian national curriculum for the class level and, for senior classes, WAEC/NECO syllabus expectations and question styles. Use Nigerian contexts in question stems: Nigerian names, places, foods, markets and Naira amounts. Use British spelling.

Question types:
- Multiple choice: one stem and exactly four options (A to D), exactly one of them correct. Distractors should be plausible to a pupil who has partly understood the topic, never silly. Avoid "all of the above" and "none of the above". The options must not give the answer away by length or grammar.
- Short answer: a question answerable in a word, a number, a phrase or one or two sentences. The marking guide states the expected answer and any acceptable alternatives.
- Theory: a structured question in the WAEC essay style, often in parts — (a), (b), (c) — with the marks for each part stated in the question. The marking guide lists the points a pupil must make to earn each mark.

Pitch each question at the requested difficulty for the class level:
- Easy: recall and recognition of facts taught.
- Medium: understanding and straightforward application.
- Hard: multi-step application, analysis or evaluation — still answerable from the syllabus for that class.

Every question must be answerable in an ordinary Nigerian exam hall, with pen and paper only. Do not require a computer, the internet, a colour printout or laboratory equipment during the exam. If a diagram would be needed, describe it fully in words instead.

Set marks a Nigerian school would: one mark for most multiple-choice and short-answer questions, and a realistic allocation for theory questions that matches the marking guide.

Each question in a batch must test something different. Do not repeat a question in other words.`;

// Structured output. Every object has additionalProperties:false and a full
// `required` list (an API requirement for structured outputs), so `options`
// and `answerGuide` are present on every question: options is an empty list
// for short-answer and theory questions. The service enforces the per-type
// rules (exactly one correct option, a marking guide where one is needed) with
// the same function the bank's own form uses, and drops any draft that breaks
// them rather than saving it.
export const EXAM_QUESTIONS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The question as a pupil reads it. For theory questions include the parts and the marks for each part.",
          },
          marks: {
            type: "integer",
            description: "Total marks for the question, a whole number from 1 to 100.",
          },
          options: {
            type: "array",
            description:
              "For multiple choice: exactly four options in order A to D, exactly one with isCorrect true. For short answer and theory: an empty list.",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "The option text, without the letter." },
                isCorrect: { type: "boolean" },
              },
              required: ["text", "isCorrect"],
              additionalProperties: false,
            },
          },
          answerGuide: {
            type: "string",
            description:
              "For short answer and theory: the expected answer and the marking points. For multiple choice: one sentence on why the correct option is right.",
          },
        },
        required: ["text", "marks", "options", "answerGuide"],
        additionalProperties: false,
      },
    },
    groundedInScheme: {
      type: "boolean",
      description:
        "TRUE only if at least one supplied scheme-of-work section genuinely covers this topic and you used it. FALSE if none was supplied or none covers the topic.",
    },
  },
  required: ["questions", "groundedInScheme"],
  additionalProperties: false,
};

export type ExamQuestionType = "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "THEORY";
export type ExamQuestionDifficulty = "EASY" | "MEDIUM" | "HARD";

const TYPE_WORDS: Record<ExamQuestionType, { one: string; many: string }> = {
  MULTIPLE_CHOICE: { one: "multiple-choice question", many: "multiple-choice questions" },
  SHORT_ANSWER: { one: "short-answer question", many: "short-answer questions" },
  THEORY: { one: "theory question", many: "theory questions" },
};

/** One retrieved curriculum chunk, as the prompt sees it. */
export interface ExamQuestionsGroundingChunk {
  readonly heading: string | null;
  readonly content: string;
  readonly documentTitle: string;
}

export interface ExamQuestionsInput {
  readonly classLevel: string;
  readonly subject: string;
  readonly topic: string;
  readonly type: ExamQuestionType;
  readonly difficulty: ExamQuestionDifficulty;
  readonly count: number;
  readonly groundingChunks?: readonly ExamQuestionsGroundingChunk[];
  /** Why there is no extract, when there is none — said truthfully, as in the lesson plan prompt (v4). */
  readonly groundingAbsenceReason?: "no-documents" | "no-match" | "unavailable";
}

// A pure function of its inputs — no clock, no environment — so the eval
// harness can assert on the exact string that would be sent.
export function renderExamQuestionsPrompt(input: ExamQuestionsInput): string {
  const words = TYPE_WORDS[input.type];
  const lines = [
    `Class level: ${input.classLevel}`,
    `Subject: ${input.subject}`,
    `Topic: ${input.topic}`,
    `Question type: ${words.many}`,
    `Difficulty: ${input.difficulty.toLowerCase()}`,
  ];

  const grounding = input.groundingChunks ?? [];
  if (grounding.length > 0) {
    lines.push(
      "",
      "--- THIS SCHOOL'S OWN SCHEME OF WORK ---",
      "The sections below come from the scheme of work this school uses. They were selected",
      "automatically by similarity search and may not cover this topic. Use only the sections",
      "that genuinely cover it: test what they say pupils are taught at this level, and do not",
      "set questions on material they place in a later class. Ignore any section that does not",
      "cover the topic. Then set groundedInScheme to true only if you used at least one section.",
      "",
    );
    grounding.forEach((chunk, i) => {
      const label = chunk.heading ? `${chunk.documentTitle} — ${chunk.heading}` : chunk.documentTitle;
      lines.push(`[${i + 1}] ${label}`, chunk.content.trim(), "");
    });
    lines.push("--- END OF SCHEME OF WORK EXTRACT ---");
  } else {
    const why =
      input.groundingAbsenceReason === "no-match"
        ? "This school has a scheme of work for this subject and class level, but no section of it matched this topic closely enough to use."
        : input.groundingAbsenceReason === "unavailable"
          ? "This school's scheme of work could not be searched for this request."
          : "No scheme of work has been uploaded for this subject and class level.";
    lines.push(
      "",
      "--- NO CURRICULUM EXTRACT ---",
      why,
      "Set questions from your knowledge of the Nigerian curriculum for this class level, and set",
      "groundedInScheme to false.",
    );
  }

  const ask = input.count === 1 ? `Write 1 ${words.one}.` : `Write ${input.count} ${words.many}.`;
  lines.push("", ask);
  return lines.join("\n");
}
