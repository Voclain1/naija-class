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
  parseOutOf,
  savedCellText,
  savedNote,
  sharedSavedOutOf,
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
      rawScore: null,
      rawOutOf: null,
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
    expect(signOffBlockReason({ hasUnsavedMarks: true, fullyScored: false })).toBe(
      "Save your marks first.",
    );
    expect(signOffBlockReason({ hasUnsavedMarks: false, fullyScored: false })).not.toBeNull();
    expect(signOffBlockReason({ hasUnsavedMarks: false, fullyScored: true })).toBeNull();
  });

  it("blocks sign-off on an unaccepted comment draft, which sign-off would freeze", () => {
    expect(
      signOffBlockReason({ hasUnsavedMarks: false, hasUnsavedComments: true, fullyScored: true }),
    ).toBe("Accept or clear your comment drafts first.");
  });
});

// Marks "out of" any total (phase-8.md D60), in the app since 2026-10-13.
function rawRow(studentId: string, componentId: string, score: number, raw: [number, number] | null): AssessmentFeedRowDto {
  const r = row(studentId, { [componentId]: score });
  return {
    ...r,
    scores: r.scores.map((s) => ({ ...s, rawScore: raw ? raw[0] : null, rawOutOf: raw ? raw[1] : null })),
  };
}

describe("marks out of any total", () => {
  it("parses the total: blank is weight units, 1..1000 is a total, anything else says why", () => {
    expect(parseOutOf("")).toEqual({ outOf: null, error: null });
    expect(parseOutOf("100")).toEqual({ outOf: 100, error: null });
    expect(parseOutOf("0").error).toMatch(/1 to 1000/);
    expect(parseOutOf("1001").error).toMatch(/1 to 1000/);
    expect(parseOutOf("7.5").error).not.toBeNull();
  });

  it("checks each cell against the total, not the weight", () => {
    const set = collectComponentSave([row("a", {})], EXAM, { a: "75" }, 100);
    expect(set.errors).toEqual({});
    expect(set.rows).toEqual([{ studentId: "a", componentId: "exam", raw: { mark: 75, outOf: 100 } }]);
    expect(collectComponentSave([row("a", {})], EXAM, { a: "101" }, 100).errors.a).toBe("Maximum is 100");
  });

  it("sends raw marks for the server to scale; never a client-scaled score", () => {
    const set = collectComponentSave([row("a", {}), row("b", {})], EXAM, { a: "37", b: "100" }, 100);
    expect(set.rows.every((r) => "raw" in r && !("score" in r))).toBe(true);
  });

  it("a raw mark typed again in its own total is not a change", () => {
    const rows = [rawRow("a", "exam", 45, [75, 100])];
    expect(collectComponentSave(rows, EXAM, { a: "75" }, 100).rows).toEqual([]);
    expect(collectComponentSave(rows, EXAM, { a: "76" }, 100).rows).toHaveLength(1);
  });

  it("reopens a column in the total its saved marks share, and not when they differ", () => {
    expect(sharedSavedOutOf([rawRow("a", "exam", 45, [75, 100]), rawRow("b", "exam", 30, [50, 100])], "exam")).toBe(100);
    expect(sharedSavedOutOf([rawRow("a", "exam", 45, [75, 100]), rawRow("b", "exam", 30, [25, 50])], "exam")).toBeNull();
    expect(sharedSavedOutOf([rawRow("a", "exam", 45, [75, 100]), row("b", { exam: 30 })], "exam")).toBeNull();
    expect(sharedSavedOutOf([row("a", {})], "exam")).toBeNull();
  });

  it("shows the saved raw mark in its own total, and the saved score otherwise", () => {
    const r = rawRow("a", "exam", 45, [75, 100]);
    expect(savedCellText(r, "exam", 100)).toBe("75");
    expect(savedCellText(r, "exam", 50)).toBe("");
    expect(savedCellText(r, "exam", null)).toBe("45");
    expect(savedNote(r, EXAM)).toBe("Saved 45/60 (typed 75/100)");
    expect(savedNote(row("b", { exam: 30 }), EXAM)).toBe("Saved 30/60");
  });
});
