import { describe, expect, it } from "vitest";

import { attemptFlags, countingAttempt, minutesTaken, objectiveScore, resultTotal, type MarkingKey } from "./cbt-marking.js";

// The marking rules (docs/modules/cbt.md D4–D6, D8), pure.

const at = (min: number) => new Date(Date.UTC(2026, 10, 20, 9, 0) + min * 60_000);
const sitting = { windowEndsAt: at(30), durationMinutes: 40, closedAt: null };
const attempt = (o: Partial<Parameters<typeof attemptFlags>[0]> = {}) => ({
  startedAt: at(5),
  submittedAt: at(40),
  lastReceivedAt: at(40),
  extraMinutes: 0,
  focusLosses: 0,
  ...o,
});

describe("cbt marking", () => {
  it("scores the marks of correctly answered questions only", () => {
    const key: MarkingKey = new Map([
      ["i1", { correctOptionId: "a", marks: 2 }],
      ["i2", { correctOptionId: "b", marks: 3 }],
      ["i3", { correctOptionId: "c", marks: 1 }],
    ]);
    expect(objectiveScore(key, {})).toBe(0);
    expect(objectiveScore(key, { i1: "a", i2: "b", i3: "c" })).toBe(6);
    expect(objectiveScore(key, { i1: "a", i2: "x" })).toBe(2);
    // An item that is not on the key (theory, or tampered) scores nothing.
    expect(objectiveScore(key, { other: "a" })).toBe(0);
  });

  it("flags rather than rejects: late start, over time, not finished, after the close, left the window", () => {
    expect(attemptFlags(attempt(), sitting)).toEqual([]);
    expect(attemptFlags(attempt({ startedAt: at(33), submittedAt: at(60) }), sitting)).toEqual(["LATE_START"]);
    // Two minutes' grace either side of a machine clock.
    expect(attemptFlags(attempt({ startedAt: at(31), submittedAt: at(60) }), sitting)).toEqual([]);
    expect(attemptFlags(attempt({ submittedAt: at(48) }), sitting)).toEqual(["OVER_TIME"]);
    expect(attemptFlags(attempt({ submittedAt: at(48), extraMinutes: 10 }), sitting)).toEqual([]);
    expect(attemptFlags(attempt({ submittedAt: null }), sitting)).toEqual(["NOT_SUBMITTED"]);
    expect(attemptFlags(attempt({ lastReceivedAt: at(90) }), { ...sitting, closedAt: at(60) })).toEqual(["AFTER_CLOSE"]);
    expect(attemptFlags(attempt({ focusLosses: 3 }), sitting)).toEqual(["LEFT_WINDOW"]);
  });

  it("measures time taken to the finish, or to the last answers for an unfinished attempt", () => {
    expect(minutesTaken(attempt())).toBe(35);
    expect(minutesTaken(attempt({ submittedAt: null, lastReceivedAt: at(25) }))).toBe(20);
  });

  it("the chosen attempt counts, else the only one; two unchosen need the teacher", () => {
    expect(countingAttempt([])).toEqual({ attempt: null, needsChoice: false });
    expect(countingAttempt([{ id: "a", chosen: false }])).toEqual({ attempt: { id: "a", chosen: false }, needsChoice: false });
    expect(countingAttempt([{ id: "a", chosen: false }, { id: "b", chosen: false }])).toEqual({ attempt: null, needsChoice: true });
    expect(countingAttempt([{ id: "a", chosen: false }, { id: "b", chosen: true }]).attempt?.id).toBe("b");
  });

  it("a total is ready only with a counting attempt and, where the paper has theory, its mark", () => {
    expect(resultTotal(null, 7, 10)).toBeNull();
    expect(resultTotal(5, null, 10)).toBeNull();
    expect(resultTotal(5, 7, 10)).toBe(12);
    expect(resultTotal(5, null, 0)).toBe(5);
  });
});
