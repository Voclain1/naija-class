import { describe, expect, it } from "vitest";

import { cbtFlagLabel, cbtNotReadyReason, cbtProgressLabel, cbtStatusLabel, describeSittingTime, localMoment, parseTheoryMark } from "./cbt-format";

describe("cbt-format", () => {
  it("labels statuses in words", () => {
    expect(cbtStatusLabel("DRAFT")).toBe("Draft");
    expect(cbtStatusLabel("PUBLISHED")).toBe("Published");
    expect(cbtStatusLabel("CLOSED")).toBe("Closed");
  });

  it("turns a date and time into a moment, or null when incomplete", () => {
    const d = localMoment("2026-11-20", "09:30")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
    expect(localMoment("", "09:30")).toBeNull();
    expect(localMoment("2026-11-20", "9")).toBeNull();
  });

  it("describes when a sitting runs, with the latest start and the length", () => {
    const start = localMoment("2026-11-20", "09:00")!;
    const latest = localMoment("2026-11-20", "09:30")!;
    const text = describeSittingTime({ startsAt: start.toISOString(), windowEndsAt: latest.toISOString(), durationMinutes: 40 });
    expect(text).toMatch(/20 Nov 2026/);
    expect(text).toMatch(/start by/);
    expect(text).toMatch(/40 min$/);
  });

  it("says how far a student has got, and when they moved computers", () => {
    const at = "2026-11-20T09:10:00.000Z";
    expect(cbtProgressLabel(null, 40)).toBe("Not started");
    expect(cbtProgressLabel({ machines: 1, answeredCount: 12, submitted: false, lastReceivedAt: at }, 40)).toBe("Sitting — 12 of 40 answered");
    expect(cbtProgressLabel({ machines: 2, answeredCount: 38, submitted: true, lastReceivedAt: at }, 40)).toBe(
      "Submitted — 38 of 40 answered (2 computers)",
    );
  });

  it("labels flags in words", () => {
    expect(cbtFlagLabel("LEFT_WINDOW", 1)).toBe("Left the exam window once");
    expect(cbtFlagLabel("LEFT_WINDOW", 3)).toBe("Left the exam window 3 times");
    expect(cbtFlagLabel("NOT_SUBMITTED", 0)).toBe("Did not finish");
  });

  it("says why a row cannot go to the gradebook yet", () => {
    const base = { attempts: [], needsChoice: false, total: null, objectiveScore: null };
    expect(cbtNotReadyReason(base)).toBe("No answers received");
    expect(cbtNotReadyReason({ ...base, attempts: [{}, {}] as never, needsChoice: true })).toBe("Choose which computer counts");
    expect(cbtNotReadyReason({ ...base, attempts: [{}] as never, objectiveScore: 4 })).toBe("Theory mark needed");
    expect(cbtNotReadyReason({ ...base, attempts: [{}] as never, objectiveScore: 4, total: 9 })).toBeNull();
  });

  it("reads a typed theory mark", () => {
    expect(parseTheoryMark("", 10)).toBeNull();
    expect(parseTheoryMark(" 7 ", 10)).toBe(7);
    expect(parseTheoryMark("11", 10)).toBe("invalid");
    expect(parseTheoryMark("3.5", 10)).toBe("invalid");
  });
});
