import { describe, expect, it } from "vitest";

import { cbtStatusLabel, describeSittingTime, localMoment } from "./cbt-format";

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
});
