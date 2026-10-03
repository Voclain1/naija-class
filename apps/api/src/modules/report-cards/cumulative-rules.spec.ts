import { describe, expect, it } from "vitest";

import { cumulativeAverage, cumulativeSubjects, roundHalfUpDiv } from "@school-kit/types";

// Phase 8c / CP5a — cumulative results (phase-8.md §22.1, D61).
describe("cumulative rules", () => {
  it("averages the terms a student HAS — a missing term is absent, never zero (D61)", () => {
    expect(cumulativeAverage([7000, 8000, 9000])).toEqual({ average: 8000, terms: 3 });
    // Joined in the second term with 70 and 80: 75, over 2 terms.
    expect(cumulativeAverage([null, 7000, 8000])).toEqual({ average: 7500, terms: 2 });
    expect(cumulativeAverage([null, null])).toBeNull();
    expect(cumulativeAverage([])).toBeNull();
  });

  it("rounds the hundredths half up", () => {
    expect(cumulativeAverage([7001, 7002])).toEqual({ average: 7002, terms: 2 }); // 7001.5 → 7002
    expect(cumulativeAverage([6667, 6667, 6666])).toEqual({ average: 6667, terms: 3 }); // 6666.67 → 6667
    expect(roundHalfUpDiv(5, 2)).toBe(3);
    expect(roundHalfUpDiv(4, 3)).toBe(1);
  });

  it("per subject: the average of that subject's term totals, in hundredths, with its term count", () => {
    const subjects = cumulativeSubjects(
      new Map([
        ["maths", [70, 75, 81]], // 75.33…
        ["english", [60]], // one term only
        ["dropped", []], // no totals at all: omitted, not 0
      ]),
    );
    expect(subjects).toEqual([
      { subjectId: "maths", average: 7533, terms: 3 },
      { subjectId: "english", average: 6000, terms: 1 },
    ]);
  });
});
