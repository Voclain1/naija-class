import { describe, expect, it } from "vitest";

import type { TimetableClashDto } from "@school-kit/types";

import { clashNoticeText } from "./clash-notice";

const clash = (day: number, term: string): TimetableClashDto => ({
  teacherId: "t", teacherName: "Tunde Bello", dayOfWeek: day, bellSlotId: "s", slotLabel: "P1", termId: term, termName: term,
  classArms: [{ id: "a", name: "JSS 1A" }, { id: "b", name: "JSS 1B" }],
});

describe("clashNoticeText (D43)", () => {
  it("names each clash in words", () => {
    expect(clashNoticeText([clash(1, "Third Term")], "Adding Third Term")).toEqual({
      title: "Adding Third Term put 1 timetable clash into force",
      lines: ["Tunde Bello — JSS 1A and JSS 1B, Monday P1 (Third Term)"],
    });
  });

  it("lists at most four and says how many more", () => {
    const t = clashNoticeText([1, 2, 3, 4, 5, 1].map((d) => clash(d, "First Term")), "Re-activating JSS 1B");
    expect(t.title).toBe("Re-activating JSS 1B put 6 timetable clashes into force");
    expect(t.lines).toHaveLength(5);
    expect(t.lines[4]).toBe("…and 2 more");
  });
});
