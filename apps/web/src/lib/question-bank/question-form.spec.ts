import { describe, expect, it } from "vitest";

import type { QuestionDto } from "@school-kit/types";

import { emptyQuestionForm, formToInput, questionToForm, removeOption } from "./question-form";

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
});
