import { describe, expect, it } from "vitest";

import { describeWhen, optionLetter } from "./format";

describe("format", () => {
  it("describes when an exam runs", () => {
    const start = new Date(2026, 10, 20, 9, 0);
    const text = describeWhen({ startsAt: start.toISOString(), windowEndsAt: new Date(2026, 10, 20, 9, 30).toISOString(), durationMinutes: 40 });
    expect(text).toMatch(/20 Nov/);
    expect(text).toMatch(/start by/);
    expect(text).toMatch(/· 40 min$/);
  });

  it("letters options in order", () => {
    expect([0, 1, 2, 3].map(optionLetter)).toEqual(["A", "B", "C", "D"]);
  });
});
