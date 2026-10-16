import { describe, expect, it } from "vitest";

import { findSimilarPairs, promptShingles, words } from "./similarity";

// Phase 9 / CP4.4 — the similarity check's rules (docs/modules/phase-9.md §11
// CP4-D9): identical answers, answers sharing only the quoted question, short
// answers skipped, and the shared passages marked.

const filler = (seed: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");

const ESSAY =
  "Photosynthesis is the process by which green plants use sunlight to turn water and carbon dioxide into glucose. " +
  "It happens mostly in the leaves, inside small parts of the cell called chloroplasts, which hold the green pigment chlorophyll. " +
  "The plant releases oxygen as a by-product, which is why forests are often called the lungs of the earth by many people.";

describe("findSimilarPairs", () => {
  it("lists identical answers, with all of each answer marked as shared", () => {
    const result = findSimilarPairs(
      [
        { studentId: "a", text: ESSAY },
        { studentId: "b", text: ESSAY },
        { studentId: "c", text: filler("own", 60) },
      ],
      new Set(),
    );
    expect(result.compared).toBe(3);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({ overlapPercent: 100, a: { studentId: "a" }, b: { studentId: "b" } });
    expect(result.pairs[0]!.a.segments.filter((s) => s.shared).map((s) => s.text).join("")).toContain("Photosynthesis is the process");
    // Every character of the answer comes back, in order.
    expect(result.pairs[0]!.a.segments.map((s) => s.text).join("")).toBe(ESSAY);
  });

  it("does not count wording both answers quote from the question", () => {
    const question = filler("q", 50);
    const a = `${question} ${filler("alpha", 20)}`;
    const b = `${question} ${filler("beta", 20)}`;
    expect(findSimilarPairs([{ studentId: "a", text: a }, { studentId: "b", text: b }], new Set()).pairs).toHaveLength(1);
    expect(findSimilarPairs([{ studentId: "a", text: a }, { studentId: "b", text: b }], promptShingles([question])).pairs).toHaveLength(0);
  });

  it("finds an answer copied whole into a longer one", () => {
    const longer = `${filler("extra", 200)} ${ESSAY}`;
    const result = findSimilarPairs([{ studentId: "a", text: ESSAY }, { studentId: "b", text: longer }], new Set());
    expect(result.pairs[0]?.overlapPercent).toBe(100);
    const marked = result.pairs[0]!.b.segments;
    expect(marked[0]).toMatchObject({ shared: false });
    expect(marked.find((s) => s.shared)?.text.startsWith("Photosynthesis")).toBe(true);
  });

  it("skips answers under 50 words, and lists nothing below half", () => {
    const short = filler("s", 49);
    const result = findSimilarPairs([{ studentId: "a", text: short }, { studentId: "b", text: short }], new Set());
    expect(result).toEqual({ compared: 0, skippedShort: 2, pairs: [] });
    const half = filler("shared", 30);
    const a = `${half} ${filler("a", 70)}`;
    const b = `${half} ${filler("b", 70)}`;
    expect(findSimilarPairs([{ studentId: "a", text: a }, { studentId: "b", text: b }], new Set()).pairs).toHaveLength(0);
  });

  it("ignores case and punctuation when reading words", () => {
    expect(words("Plants, MAKE sugar!  It's true.").map((w) => w.key)).toEqual(["plants", "make", "sugar", "it's", "true"]);
  });
});
