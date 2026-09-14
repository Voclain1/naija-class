import { describe, expect, it } from "vitest";

import { publishedDay, publishedGridRows, type PublishedGridDto } from "@school-kit/types";

const grid: PublishedGridDto = {
  slots: [
    { position: 1, label: "P1", kind: "LESSON", startMinute: 480, endMinute: 520 },
    { position: 2, label: "P2", kind: "LESSON", startMinute: 520, endMinute: 560 },
    { position: 3, label: "Break", kind: "BREAK", startMinute: 560, endMinute: 580 },
    { position: 4, label: "P3", kind: "LESSON", startMinute: 580, endMinute: 620 },
  ],
  days: [1, 2],
  lessons: [
    { dayOfWeek: 1, slotPosition: 1, subjectName: "Mathematics", teacherNames: ["Tunde Bello"] },
    { dayOfWeek: 1, slotPosition: 2, subjectName: "Mathematics", teacherNames: ["Tunde Bello"] },
    { dayOfWeek: 2, slotPosition: 2, subjectName: "English", teacherNames: [] },
    { dayOfWeek: 2, slotPosition: 4, subjectName: "English", teacherNames: [] },
  ],
};

describe("publishedGridRows / publishedDay (families' view)", () => {
  it("merges a double period and never across a break", () => {
    const rows = publishedGridRows(grid);
    expect(rows.map((r) => r.cells.map((c) => (c.type === "lesson" ? `${c.lesson.subjectName}x${c.rowSpan}` : c.type)))).toEqual([
      ["Mathematicsx2", "empty"],
      ["covered", "Englishx1"],
      ["break", "break"],
      ["empty", "Englishx1"],
    ]);
  });

  it("a day, in order, with a double period's end time taken from its last period", () => {
    expect(publishedDay(grid, 1).map((x) => `${x.slot.label}-${x.endMinute}-${x.lesson?.subjectName ?? "-"}`)).toEqual([
      "P1-560-Mathematics",
      "Break-580--",
      "P3-620--",
    ]);
    expect(publishedDay(grid, 6)).toEqual([]);
  });
});
