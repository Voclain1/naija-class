import { describe, expect, it } from "vitest";

import {
  computeClassAverages,
  computeClassPositions,
  computeSubjectPositions,
  rankSparse,
} from "@school-kit/types";

// Phase 2 / Slice 4 cp1 — the ranking SPEC, written test-first. Positions land
// on the materialized PDFs schools physically distribute, so this is the most
// correctness-critical code in Phase 2. Each enumerated case (a)–(l) is the
// agreed behaviour; the suite below IS the specification. Pure math only — no
// DB. The slice-4 service (cp2) is a thin shell over these functions.

function subj(rows: [string, number][]): { studentId: string; totalScore: number }[] {
  return rows.map(([studentId, totalScore]) => ({ studentId, totalScore }));
}

describe("Slice 4 — the 12 enumerated ranking cases", () => {
  it("(a) ties rank SPARSE — joint scores share a rank, the next distinct value skips", () => {
    // 90, 80, 80, 70 → 1, 2, 2, 4
    const p = computeSubjectPositions(subj([["a", 90], ["b", 80], ["c", 80], ["d", 70]]));
    expect([p.get("a"), p.get("b"), p.get("c"), p.get("d")]).toEqual([1, 2, 2, 4]);
    // Two joint-first → next is THIRD (not second).
    const top = computeSubjectPositions(subj([["x", 90], ["y", 90], ["z", 80]]));
    expect([top.get("x"), top.get("y"), top.get("z")]).toEqual([1, 1, 3]);
    // Three-way tie at the top → 1, 1, 1, 4.
    const three = computeSubjectPositions(subj([["a", 50], ["b", 50], ["c", 50], ["d", 40]]));
    expect([three.get("a"), three.get("b"), three.get("c"), three.get("d")]).toEqual([1, 1, 1, 4]);
  });

  it("(b) unscored students are absent from the input → absent from the result (no position)", () => {
    // c was never scored (no Assessment row exists), so it's not passed in.
    const p = computeSubjectPositions(subj([["a", 70], ["b", 60]]));
    expect(p.get("a")).toBe(1);
    expect(p.get("b")).toBe(2);
    expect(p.has("c")).toBe(false);
  });

  it("(c) a partial total is ranked at face value (early-term, CA1-only)", () => {
    // Adaeze has only CA1 entered (18); Bode has the full 60.
    const p = computeSubjectPositions(subj([["adaeze", 18], ["bode", 60]]));
    expect(p.get("bode")).toBe(1);
    expect(p.get("adaeze")).toBe(2);
    // Alone early in term, the only scored student is position 1.
    expect(computeSubjectPositions(subj([["adaeze", 18]])).get("adaeze")).toBe(1);
  });

  it("(d) one arm only — Enrollment is unique per (school, student, term) → one arm per term", () => {
    // The service passes exactly ONE arm's rows (a student has one enrollment
    // per term → one arm); there is no cross-arm/transfer ambiguity to resolve
    // in the ranking math.
    const p = computeSubjectPositions(subj([["a", 80], ["b", 70]]));
    expect([...p.keys()].sort()).toEqual(["a", "b"]);
    expect(p.get("a")).toBe(1);
  });

  it("(e) a withdrawn student is filtered from the denominator → absent from the result", () => {
    // The service builds `rows` from the ENROLLED roster only; a WITHDRAWN
    // student (even with an Assessment row) is excluded before ranking.
    const p = computeSubjectPositions(subj([["a", 90], ["b", 70]]));
    expect(p.has("withdrawn")).toBe(false);
    expect([p.get("a"), p.get("b")]).toEqual([1, 2]);
  });

  it("(f) class average is over AVAILABLE subjects — a subset can inflate (known limitation)", () => {
    // Ada has one strong subject; Bode has three averaging lower.
    const averages = computeClassAverages(
      new Map([
        ["ada", [90]],
        ["bode", [90, 60, 60]],
      ]),
    );
    expect(averages.get("ada")).toBe(9000); // 90.00
    expect(averages.get("bode")).toBe(7000); // 70.00
    const positions = computeClassPositions(averages);
    // Ada outranks Bode on the strength of one subject — the documented inflation.
    expect(positions.get("ada")).toBe(1);
    expect(positions.get("bode")).toBe(2);
  });

  it("(g) single-student arm → position 1", () => {
    expect(computeSubjectPositions(subj([["solo", 42]])).get("solo")).toBe(1);
    expect(computeClassPositions(new Map([["solo", 4200]])).get("solo")).toBe(1);
  });

  it("(h) empty arm → empty result, no error", () => {
    expect(computeSubjectPositions([]).size).toBe(0);
    expect(computeClassPositions(new Map()).size).toBe(0);
    expect(computeClassAverages(new Map()).size).toBe(0);
  });

  it("(i) all students tied → all rank 1", () => {
    const p = computeSubjectPositions(subj([["a", 50], ["b", 50], ["c", 50]]));
    expect([p.get("a"), p.get("b"), p.get("c")]).toEqual([1, 1, 1]);
  });

  it("(j) subject and class positions are INDEPENDENT (a narrow pass never derives overall)", () => {
    // Tomi tops Maths (90) but is weak overall; Zara is 2nd in Maths (80) yet
    // strongest across subjects. subjectPosition ≠ classPosition by construction,
    // so a subject-narrowed pass recomputing subjectPositions can never disturb
    // classPositions — compute scopes must be narrower than write scopes.
    const subjectPos = computeSubjectPositions(subj([["tomi", 90], ["zara", 80]]));
    expect(subjectPos.get("tomi")).toBe(1);
    expect(subjectPos.get("zara")).toBe(2);

    const classPos = computeClassPositions(
      computeClassAverages(
        new Map([
          ["tomi", [90, 30, 30]], // avg 50
          ["zara", [80, 85, 90]], // avg 85
        ]),
      ),
    );
    expect(classPos.get("zara")).toBe(1);
    expect(classPos.get("tomi")).toBe(2);
  });

  it("(k) idempotent — re-running yields identical positions", () => {
    const rows = subj([["a", 90], ["b", 80], ["c", 80]]);
    const first = computeSubjectPositions(rows);
    const second = computeSubjectPositions(rows);
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it("(l) output is independent of input order (stable secondary sort by studentId)", () => {
    const ordered = computeSubjectPositions(subj([["a", 80], ["b", 90], ["c", 80]]));
    const shuffled = computeSubjectPositions(subj([["c", 80], ["a", 80], ["b", 90]]));
    expect([shuffled.get("b"), shuffled.get("a"), shuffled.get("c")]).toEqual([1, 2, 2]);
    for (const id of ["a", "b", "c"]) {
      expect(ordered.get(id)).toBe(shuffled.get(id));
    }
  });
});

describe("computeClassAverages — Int hundredths (kobo rule)", () => {
  it("averages each student's available totals and rounds to hundredths", () => {
    const avg = computeClassAverages(
      new Map([
        ["even", [80, 60]], // 70.00 → 7000
        ["whole", [90]], // 90.00 → 9000
        ["half", [80, 75]], // 77.50 → 7750
        ["repeating", [10, 11, 11]], // 32/3 = 10.6667 → 1067
      ]),
    );
    expect(avg.get("even")).toBe(7000);
    expect(avg.get("whole")).toBe(9000);
    expect(avg.get("half")).toBe(7750);
    expect(avg.get("repeating")).toBe(1067);
  });

  it("excludes a student with no subject totals (no average → no class position)", () => {
    const avg = computeClassAverages(new Map([["none", []], ["one", [50]]]));
    expect(avg.has("none")).toBe(false);
    expect(avg.get("one")).toBe(5000);
  });
});

describe("rankSparse — the shared core", () => {
  it("ranks descending; empty input → empty result", () => {
    expect(rankSparse([]).size).toBe(0);
    const r = rankSparse([
      { id: "a", value: 1 },
      { id: "b", value: 3 },
      { id: "c", value: 2 },
    ]);
    expect([r.get("b"), r.get("c"), r.get("a")]).toEqual([1, 2, 3]);
  });
});
