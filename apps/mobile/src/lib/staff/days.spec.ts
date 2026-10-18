import { describe, expect, it } from "vitest";

import { groupByDay, shiftDay } from "./days";

describe("shiftDay (CP11.2)", () => {
  it("steps across months and years", () => {
    expect(shiftDay("2026-10-18", -1)).toBe("2026-10-17");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("groupByDay (CP11.2)", () => {
  it("groups newest day first and keeps each day's order", () => {
    const rows = [
      { id: "a", d: "2026-10-16" },
      { id: "b", d: "2026-10-18" },
      { id: "c", d: "2026-10-16" },
    ];
    expect(groupByDay(rows, (r) => r.d)).toEqual([
      { day: "2026-10-18", items: [rows[1]] },
      { day: "2026-10-16", items: [rows[0], rows[2]] },
    ]);
  });
});
