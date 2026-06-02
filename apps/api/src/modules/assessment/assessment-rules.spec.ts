import { describe, expect, it } from "vitest";

import { DEFAULT_GRADE_BOUNDARIES } from "@school-kit/db";
import {
  findScoreError,
  resolveLetterGrade,
  sumComponentScores,
} from "@school-kit/types";

// Pure unit tests for the assessment compute/validate core — NO DB. These lock
// the materialization invariants that slice 4's position aggregation reads
// against: if `totalScore` is computed wrong here, every downstream rank is
// wrong. Written FIRST (slice 2 cp1, before any endpoint/service exists).
//
// Letter-grade cases run against the REAL default WAEC scale (the same constant
// the signup seed + migration backfill use), so the band-edge expectations are
// the production scale, not a fixture.

describe("sumComponentScores — exact Σ, no averaging/rounding/extrapolation", () => {
  it("sums the default CA1/CA2/Exam split to 100", () => {
    expect(sumComponentScores([20, 20, 60])).toBe(100);
  });

  it("sums a four-component 15/15/10/60 split to 100", () => {
    expect(sumComponentScores([15, 15, 10, 60])).toBe(100);
  });

  it("returns the EXACT arithmetic sum (no rounding)", () => {
    expect(sumComponentScores([13, 17, 49])).toBe(79);
  });

  it("PARTIAL entry sums only what was entered — NOT extrapolated to a full basis", () => {
    // Only CA1 (out of 20) entered as 18; Exam not yet entered. Total is 18,
    // NOT 18-scaled-to-100. This is the invariant most likely to be gotten
    // wrong; slice 4 ranks on it.
    expect(sumComponentScores([18])).toBe(18);
  });

  it("empty set totals 0 (a student with no marks yet)", () => {
    expect(sumComponentScores([])).toBe(0);
  });
});

describe("resolveLetterGrade — band-edge resolution against the WAEC scale", () => {
  const bands = DEFAULT_GRADE_BOUNDARIES;

  it.each([
    [100, "A1"],
    [75, "A1"], // lower edge of A1 (75–100)
    [74, "B2"], // upper edge of B2 (70–74)
    [70, "B2"],
    [69, "B3"],
    [50, "C6"],
    [44, "E8"], // upper edge of E8 (40–44)
    [40, "E8"], // lower edge of E8
    [39, "F9"], // upper edge of F9 (0–39)
    [0, "F9"],
  ])("total %i resolves to %s", (total, letter) => {
    expect(resolveLetterGrade(total, bands)).toBe(letter);
  });

  it("a partial-entry total of 18 resolves to F9 (reflects partial, not a pass)", () => {
    expect(resolveLetterGrade(sumComponentScores([18]), bands)).toBe("F9");
  });

  it("returns null when no band contains the total (pathological gap)", () => {
    const gapped = [
      { letter: "A", minScore: 50, maxScore: 100 },
      { letter: "F", minScore: 0, maxScore: 40 },
    ];
    expect(resolveLetterGrade(45, gapped)).toBeNull();
  });
});

describe("findScoreError — strict 0..weight against the live component weight", () => {
  it("accepts 0, the weight ceiling, and a mid value", () => {
    expect(findScoreError(0, 60)).toBeNull();
    expect(findScoreError(60, 60)).toBeNull();
    expect(findScoreError(37, 60)).toBeNull();
  });

  it("rejects a score above the component weight", () => {
    expect(findScoreError(61, 60)).toMatch(/exceed/i);
    // 75 into a 60-mark Exam — the spec's acceptance-bar example.
    expect(findScoreError(75, 60)).toMatch(/60/);
  });

  it("rejects a negative score", () => {
    expect(findScoreError(-1, 60)).toMatch(/negative/i);
  });

  it("rejects a non-integer score", () => {
    expect(findScoreError(30.5, 60)).toMatch(/whole number/i);
  });
});
