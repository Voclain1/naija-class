import { describe, expect, it } from "vitest";

import type { CbtPackPayload } from "@school-kit/types";

import {
  addExtraTime,
  choose,
  findCandidate,
  formatClock,
  goTo,
  noteFocusLoss,
  questionsFor,
  remainingMs,
  startAttempt,
  startWindowClosed,
  submit,
  toSnapshot,
} from "./attempt";

const t0 = new Date("2026-11-20T09:00:00.000Z");
const plus = (min: number) => new Date(t0.getTime() + min * 60_000);

describe("attempt", () => {
  it("every answer raises seq; moving between questions does not", () => {
    let a = startAttempt("s1", "st1", "B", t0);
    expect(a).toMatchObject({ key: "s1:st1", seq: 1, answers: {} });
    a = choose(a, "item-1", "opt-2");
    expect(a.seq).toBe(2);
    expect(choose(a, "item-1", "opt-2")).toBe(a); // the same choice again is no change
    a = choose(a, "item-1", "opt-3");
    expect(a).toMatchObject({ seq: 3, answers: { "item-1": "opt-3" } });
    expect(goTo(a, 4)).toMatchObject({ seq: 3, current: 4 });
  });

  it("the clock is wall time from the start, plus any extra time", () => {
    const a = startAttempt("s1", "st1", "A", t0);
    expect(remainingMs(a, 40, plus(10))).toBe(30 * 60_000);
    expect(remainingMs(a, 40, plus(50))).toBe(0);
    expect(remainingMs(addExtraTime(a, 15), 40, plus(50))).toBe(5 * 60_000);
    expect(formatClock(30 * 60_000)).toBe("30:00");
    expect(formatClock(65_500)).toBe("01:06");
    expect(formatClock(62 * 60_000 + 9_000)).toBe("1:02:09");
  });

  it("a submitted attempt no longer changes", () => {
    const done = submit(choose(startAttempt("s1", "st1", "A", t0), "i", "o"), plus(20));
    expect(done.submittedAt).toBe(plus(20).toISOString());
    expect(choose(done, "i", "other")).toBe(done);
    expect(noteFocusLoss(done)).toBe(done);
    expect(submit(done, plus(30))).toBe(done);
  });

  it("counts each time the student leaves the exam", () => {
    const a = noteFocusLoss(noteFocusLoss(startAttempt("s1", "st1", "A", t0)));
    expect(toSnapshot(a)).toMatchObject({ focusLosses: 2, seq: 3, submittedAt: null, extraMinutes: 0 });
  });

  it("no one may begin after the latest start", () => {
    const env = { windowEndsAt: plus(30).toISOString() };
    expect(startWindowClosed(env, plus(29))).toBe(false);
    expect(startWindowClosed(env, plus(31))).toBe(true);
  });

  it("finds the student by admission number however it is typed, and lays out their version", () => {
    const payload = {
      candidates: [{ studentId: "st1", admissionNumber: "JSS2/0042", displayName: "Ada O.", armName: "Gold", version: "B" }],
      versions: {
        B: [
          { title: "Section A", instructions: "Choose one.", questions: [{ itemId: "i1", number: 1, text: "Q", marks: 1, options: [] }] },
          { title: "Section B", instructions: null, questions: [{ itemId: "i2", number: 2, text: "Q2", marks: 1, options: [] }] },
        ],
      },
    } as unknown as CbtPackPayload;
    expect(findCandidate(payload, " jss2/0042 ")?.studentId).toBe("st1");
    expect(findCandidate(payload, "JSS2/0043")).toBeNull();
    expect(findCandidate(payload, "")).toBeNull();
    expect(questionsFor(payload, "B").map((q) => [q.number, q.sectionTitle])).toEqual([
      [1, "Section A"],
      [2, "Section B"],
    ]);
    expect(questionsFor(payload, "A")).toEqual([]);
  });
});
