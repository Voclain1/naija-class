import { describe, expect, it } from "vitest";

import type { AssessmentFeedRowDto, GradingComponentDto } from "@school-kit/types";

import { buildDefaultValues, inferColumnOutOf, makeGradebookSchema, toSaveRows } from "./gradebook-form";

// Phase 8c / CP5a — entering a gradebook column "out of" any total (D60).

const exam = { id: "exam", weight: 60, label: "Exam" } as GradingComponentDto;
const ca1 = { id: "ca1", weight: 20, label: "CA1" } as GradingComponentDto;

function row(studentId: string, scores: { componentId: string; score: number; rawScore?: number; rawOutOf?: number }[]) {
  return {
    student: { id: studentId },
    scores: scores.map((s) => ({ rawScore: null, rawOutOf: null, ...s })),
  } as unknown as AssessmentFeedRowDto;
}

describe("gradebook 'out of' entry", () => {
  it("a column reopens in the total every saved mark shares — and not when they differ or were typed directly", () => {
    const shared = [row("a", [{ componentId: "exam", score: 37, rawScore: 37, rawOutOf: 60 }]), row("b", [{ componentId: "exam", score: 54, rawScore: 45, rawOutOf: 50 }])];
    expect(inferColumnOutOf([shared[0]!], "exam")).toBe(60);
    expect(inferColumnOutOf(shared, "exam")).toBeUndefined(); // 60 vs 50
    expect(inferColumnOutOf([row("a", [{ componentId: "exam", score: 40 }])], "exam")).toBeUndefined();
    expect(inferColumnOutOf([row("a", [])], "exam")).toBeUndefined();
  });

  it("cells show the mark as typed against this total, and stay empty rather than show a figure in other units", () => {
    const rows = [
      row("a", [{ componentId: "exam", score: 12, rawScore: 37, rawOutOf: 60 }]),
      row("b", [{ componentId: "exam", score: 40 }]), // typed in weight units
    ];
    const values = buildDefaultValues(rows, [exam], { exam: 60 });
    expect(values.rows.map((r) => r.scores.exam)).toEqual(["37", ""]);
    expect(buildDefaultValues(rows, [exam]).rows.map((r) => r.scores.exam)).toEqual(["12", "40"]);
  });

  it("validates against the total in 'out of' mode, the weight otherwise", () => {
    const values = (v: string) => ({ rows: [{ studentId: "a", scores: { ca1: v } }] });
    expect(makeGradebookSchema([ca1]).safeParse(values("45")).success).toBe(false); // > 20
    expect(makeGradebookSchema([ca1], { ca1: 50 }).safeParse(values("45")).success).toBe(true);
    expect(makeGradebookSchema([ca1], { ca1: 50 }).safeParse(values("51")).success).toBe(false);
  });

  it("sends raw marks for 'out of' columns, for the SERVER to scale, and scores for the rest", () => {
    expect(
      toSaveRows(
        [
          { studentId: "a", componentId: "exam", score: 37 },
          { studentId: "a", componentId: "ca1", score: 15 },
        ],
        { exam: 60 },
      ),
    ).toEqual([
      { studentId: "a", componentId: "exam", raw: { mark: 37, outOf: 60 } },
      { studentId: "a", componentId: "ca1", score: 15 },
    ]);
  });
});
