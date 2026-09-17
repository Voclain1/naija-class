import type { AssessmentFeedResponse, AssessmentFeedRowDto } from "@school-kit/types";
import { describe, expect, it } from "vitest";

import {
  CANNOT_REMOVE_MESSAGE,
  cellError,
  collectComponentSave,
  columnSignedOffAt,
  componentProgress,
  isColumnFullyScored,
  issuesByStudent,
  signOffBlockReason,
} from "./gradebook-rules";

const CA1 = { id: "ca1", weight: 20 };
const EXAM = { id: "exam", weight: 60 };

function row(
  studentId: string,
  scores: Record<string, number>,
  signedOffAt: string | null = null,
): AssessmentFeedRowDto {
  return {
    student: {
      id: studentId,
      admissionNumber: "ADM-" + studentId,
      firstName: "First",
      middleName: null,
      lastName: studentId,
    },
    assessment:
      Object.keys(scores).length === 0
        ? null
        : ({ subjectSignedOffAt: signedOffAt } as AssessmentFeedRowDto["assessment"]),
    scores: Object.entries(scores).map(([componentId, score]) => ({
      id: studentId + componentId,
      studentId,
      subjectId: "s",
      termId: "t",
      componentId,
      score,
      enteredBy: "u",
      enteredAt: "2026-09-17T00:00:00Z",
      updatedAt: "2026-09-17T00:00:00Z",
    })),
  };
}

function feed(...rows: AssessmentFeedRowDto[]): AssessmentFeedResponse {
  return { data: rows };
}

describe("cellError", () => {
  it("allows an empty cell and the weight boundaries", () => {
    expect(cellError("", 20)).toBeNull();
    expect(cellError("  ", 20)).toBeNull();
    expect(cellError("0", 20)).toBeNull();
    expect(cellError("20", 20)).toBeNull();
  });

  it("refuses above the weight, decimals, negatives and text", () => {
    expect(cellError("21", 20)).toBe("Maximum is 20");
    expect(cellError("12.5", 20)).not.toBeNull();
    expect(cellError("-1", 20)).not.toBeNull();
    expect(cellError("ab", 20)).not.toBeNull();
  });
});

describe("collectComponentSave", () => {
  const rows = [row("b", { ca1: 10 }), row("a", {}), row("c", { ca1: 5 })];

  it("sends only cells that differ from the saved mark, sorted by student", () => {
    const result = collectComponentSave(rows, CA1, { c: "7", a: "12", b: "10" });
    expect(result.rows).toEqual([
      { studentId: "a", componentId: "ca1", score: 12 },
      { studentId: "c", componentId: "ca1", score: 7 },
    ]);
    expect(result.dirtyStudentIds.sort()).toEqual(["a", "c"]);
    expect(result.errors).toEqual({});
  });

  it("ignores students with no draft and a blank draft on an unscored student", () => {
    const result = collectComponentSave(rows, CA1, { a: "" });
    expect(result.rows).toEqual([]);
    expect(result.dirtyStudentIds).toEqual([]);
  });

  it("D21: refuses to clear a saved mark instead of silently keeping it", () => {
    const result = collectComponentSave(rows, CA1, { b: "" });
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual({ b: CANNOT_REMOVE_MESSAGE });
    expect(result.dirtyStudentIds).toEqual(["b"]);
  });

  it("holds back an out-of-range cell as an error, not a row", () => {
    const result = collectComponentSave(rows, CA1, { a: "25", c: "6" });
    expect(result.rows).toEqual([{ studentId: "c", componentId: "ca1", score: 6 }]);
    expect(result.errors).toEqual({ a: "Maximum is 20" });
  });

  it("ignores a draft for a student no longer in the column", () => {
    const result = collectComponentSave(rows, CA1, { gone: "9" });
    expect(result.rows).toEqual([]);
    expect(result.dirtyStudentIds).toEqual([]);
  });
});

describe("issuesByStudent", () => {
  const sent = [{ studentId: "a" }, { studentId: "c" }];

  it("maps the server's rows[i] paths back to the students that were sent", () => {
    const details = {
      issues: [
        { path: ["rows", 1, "score"], message: "Score must be between 0 and 20." },
        { path: ["rows", 9, "score"], message: "out of range index" },
        { path: ["termId"], message: "not a row" },
      ],
    };
    expect(issuesByStudent(details, sent)).toEqual({ c: "Score must be between 0 and 20." });
  });

  it("returns nothing for missing or malformed details", () => {
    expect(issuesByStudent(undefined, sent)).toEqual({});
    expect(issuesByStudent({ issues: "nope" }, sent)).toEqual({});
  });
});

describe("column state", () => {
  const components = [CA1, EXAM];

  it("is fully scored only when every student has every component", () => {
    expect(isColumnFullyScored(feed(row("a", { ca1: 1, exam: 2 })), components)).toBe(true);
    expect(
      isColumnFullyScored(feed(row("a", { ca1: 1, exam: 2 }), row("b", { ca1: 1 })), components),
    ).toBe(false);
    expect(isColumnFullyScored(feed(), components)).toBe(false);
    expect(isColumnFullyScored(feed(row("a", { ca1: 1 })), [])).toBe(false);
  });

  it("counts progress per component", () => {
    expect(componentProgress(feed(row("a", { ca1: 1 }), row("b", {})), "ca1")).toEqual({
      scored: 1,
      total: 2,
    });
  });

  it("is signed off only when every student's summary carries a stamp", () => {
    const stamp = "2026-09-17T10:00:00Z";
    expect(
      columnSignedOffAt(feed(row("a", { ca1: 1 }, stamp), row("b", { ca1: 1 }, stamp))),
    ).toBe(stamp);
    expect(columnSignedOffAt(feed(row("a", { ca1: 1 }, stamp), row("b", { ca1: 1 })))).toBeNull();
    expect(columnSignedOffAt(feed(row("a", { ca1: 1 }, stamp), row("b", {})))).toBeNull();
    expect(columnSignedOffAt(feed())).toBeNull();
  });

  it("explains why sign-off is unavailable, unsaved marks first", () => {
    expect(signOffBlockReason({ hasUnsaved: true, fullyScored: false })).toBe(
      "Save your marks first.",
    );
    expect(signOffBlockReason({ hasUnsaved: false, fullyScored: false })).not.toBeNull();
    expect(signOffBlockReason({ hasUnsaved: false, fullyScored: true })).toBeNull();
  });
});
