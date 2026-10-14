import { describe, expect, it } from "vitest";

import type { GenerateQuestionsResponse, QuestionDto, QuestionScopeDto } from "@school-kit/types";

import {
  addOption,
  emptyQuestionForm,
  formToInput,
  generatedSummary,
  questionToForm,
  removeOption,
  subjectChoicesFor,
} from "./question-form";

// Phase 8c / CP5b — the editor refuses what the API refuses, with the same words.

describe("question form", () => {
  const mcq = () => ({
    ...emptyQuestionForm("Motion"),
    text: "Which is a vector?",
    options: ["Speed", "Velocity", "Mass", "Time"],
    correctIndex: 1,
  });

  it("converts a complete multiple-choice question", () => {
    const result = formToInput(mcq());
    expect(result).toEqual({
      ok: true,
      input: {
        topic: "Motion",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        text: "Which is a vector?",
        marks: 1,
        answerGuide: null,
        options: [
          { text: "Speed", isCorrect: false },
          { text: "Velocity", isCorrect: true },
          { text: "Mass", isCorrect: false },
          { text: "Time", isCorrect: false },
        ],
      },
    });
  });

  it("says which field is wrong, in the API's own words", () => {
    expect(formToInput({ ...mcq(), correctIndex: -1 })).toMatchObject({ ok: false, field: "options", message: "Mark exactly one option as the correct answer." });
    expect(formToInput({ ...mcq(), options: ["Speed", "", "Mass", "Time"] })).toMatchObject({ ok: false, field: "options" });
    expect(formToInput({ ...mcq(), marks: "0" })).toMatchObject({ ok: false, field: "marks" });
    expect(formToInput({ ...mcq(), marks: "2.5" })).toMatchObject({ ok: false, field: "marks" });
    expect(formToInput({ ...mcq(), type: "THEORY" })).toMatchObject({ ok: false, field: "answerGuide", message: "Write the expected answer or marking guide." });
  });

  it("a theory question sends no options, whatever the hidden option boxes hold", () => {
    const result = formToInput({ ...mcq(), type: "THEORY", answerGuide: "Define and give two examples." });
    expect(result.ok && result.input.options).toEqual([]);
  });

  it("removing an option keeps the correct mark on the same answer", () => {
    expect(removeOption(mcq(), 0)).toMatchObject({ options: ["Velocity", "Mass", "Time"], correctIndex: 0 });
    expect(removeOption(mcq(), 1).correctIndex).toBe(-1);
    expect(removeOption(mcq(), 3).correctIndex).toBe(1);
  });

  it("round-trips a saved question", () => {
    const saved = {
      topic: "Motion",
      type: "MULTIPLE_CHOICE",
      difficulty: "HARD",
      text: "Q",
      marks: 2,
      answerGuide: null,
      options: [
        { id: "a", orderIndex: 0, text: "x", isCorrect: false },
        { id: "b", orderIndex: 1, text: "y", isCorrect: true },
      ],
    } as unknown as QuestionDto;
    expect(questionToForm(saved)).toMatchObject({ difficulty: "HARD", marks: "2", options: ["x", "y"], correctIndex: 1 });
  });

  it("stops adding options at five (A to E)", () => {
    let form = mcq();
    for (let i = 0; i < 5; i++) form = addOption(form);
    expect(form.options).toHaveLength(5);
  });
});

describe("question bank scope and drafting summary", () => {
  const scope: QuestionScopeDto = {
    all: false,
    levels: [
      { id: "l1", name: "JSS 1" },
      { id: "l2", name: "JSS 2" },
    ],
    subjects: [
      { id: "s1", name: "Physics" },
      { id: "s2", name: "Maths" },
    ],
    pairs: [
      { classLevelId: "l1", classLevelName: "JSS 1", subjectId: "s1", subjectName: "Physics" },
      { classLevelId: "l2", classLevelName: "JSS 2", subjectId: "s2", subjectName: "Maths" },
    ],
  };

  it("a teacher is offered only the subjects they teach at that level", () => {
    expect(subjectChoicesFor(scope, "l1").map((s) => s.id)).toEqual(["s1"]);
    expect(subjectChoicesFor(scope, null)).toEqual([]);
  });

  it("owner/admin are offered every subject", () => {
    expect(subjectChoicesFor({ ...scope, all: true }, "l1")).toHaveLength(2);
  });

  it("says how many drafts arrived, how many were dropped, and where they came from", () => {
    const result = {
      questions: [{}, {}],
      requested: 3,
      dropped: 1,
      grounding: { reason: "no-documents", usedScheme: null },
    } as unknown as GenerateQuestionsResponse;
    expect(generatedSummary(result)).toBe(
      "2 drafts added for review. 1 more was left out because it broke the question rules. No scheme of work has been uploaded for this subject and class, so these follow the national curriculum.",
    );
    expect(generatedSummary({ ...result, questions: [{}] as never, dropped: 0, grounding: { reason: "ok", usedScheme: true } })).toBe(
      "1 draft added for review. Based on your school's scheme of work.",
    );
  });
});
