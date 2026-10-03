import { describe, expect, it } from "vitest";

import type { ExamPaperDto, QuestionDto } from "@school-kit/types";

import {
  addQuestions,
  addSection,
  editorFromPaper,
  editorMarks,
  editorToInput,
  isEditorDirty,
  moveQuestion,
  removeQuestion,
  removeSection,
} from "./paper-editor";

// Phase 8c / CP5c — the paper editor's local moves, before one PUT saves them.

const q = (id: string, marks = 1) => ({ id, marks }) as QuestionDto;
const paper = {
  title: "First Term Examination",
  durationMinutes: 90,
  instructions: null,
  componentId: "exam",
  versionCount: 2,
  sections: [
    { id: "a", title: "Section A", instructions: "Choose", marks: 2, questions: [q("1"), q("2")] },
    { id: "b", title: "Section B", instructions: null, marks: 10, questions: [q("3", 10)] },
  ],
} as unknown as ExamPaperDto;

describe("paper editor", () => {
  it("round-trips a paper into what the API saves", () => {
    const result = editorToInput(editorFromPaper(paper));
    expect(result).toEqual({
      ok: true,
      input: {
        title: "First Term Examination",
        durationMinutes: 90,
        instructions: null,
        componentId: "exam",
        versionCount: 2,
        sections: [
          { title: "Section A", instructions: "Choose", questionIds: ["1", "2"] },
          { title: "Section B", instructions: null, questionIds: ["3"] },
        ],
      },
    });
  });

  it("adds without repeating a question anywhere on the paper; moves and removes; totals follow", () => {
    let s = editorFromPaper(paper);
    s = addQuestions(s, 0, [q("3"), q("4"), q("4")]);
    expect(s.sections[0]!.questions.map((x) => x.id)).toEqual(["1", "2", "4"]);
    s = moveQuestion(s, 0, 2, -1);
    expect(s.sections[0]!.questions.map((x) => x.id)).toEqual(["1", "4", "2"]);
    expect(moveQuestion(s, 0, 0, -1)).toBe(s); // no-op at the top
    s = removeQuestion(s, 0, 0);
    expect(editorMarks(s)).toEqual({ sections: [2, 10], total: 12 });
    s = addSection(s);
    expect(s.sections[2]!.title).toBe("Section C");
    expect(removeSection(s, 2).sections).toHaveLength(2);
  });

  it("is dirty only when what would be saved changes", () => {
    const saved = editorFromPaper(paper);
    const same = editorFromPaper(paper); // fresh keys, same content
    expect(isEditorDirty(same, saved)).toBe(false);
    expect(isEditorDirty({ ...same, title: "Mock exam" }, saved)).toBe(true);
    expect(isEditorDirty(moveQuestion(same, 0, 0, 1), saved)).toBe(true);
  });

  it("refuses what the API would refuse, in words", () => {
    const s = editorFromPaper(paper);
    expect(editorToInput({ ...s, durationMinutes: "4" })).toMatchObject({ ok: false });
    expect(editorToInput({ ...s, title: " " })).toEqual({ ok: false, message: "Give the paper a title." });
    expect(editorToInput({ ...s, sections: [{ ...s.sections[0]!, title: "" }] })).toEqual({ ok: false, message: "Give section 1 a title." });
  });
});
