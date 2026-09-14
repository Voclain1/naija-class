import { describe, expect, it } from "vitest";

import type { BellSlotDto, LessonDto } from "@school-kit/types";

import { buildGrid, maxSpanFrom, otherClassNames } from "./timetable-grid";

const slot = (id: string, kind: BellSlotDto["kind"] = "LESSON"): BellSlotDto => ({
  id, position: 0, label: id, kind, startMinute: 0, endMinute: 1, lessonCount: 0,
});
const SLOTS = [slot("p1"), slot("p2"), slot("brk", "BREAK"), slot("p3"), slot("p4")];
const lesson = (id: string, day: number, bellSlotId: string, subjectId = "maths", teachers = ["t"]): LessonDto => ({
  id, dayOfWeek: day, bellSlotId, subjectId, subjectName: subjectId, teachers: teachers.map((t) => ({ id: t, name: t })),
});

describe("buildGrid (D24 — double periods are merged at display)", () => {
  it("merges consecutive identical lessons into one cell with a row span", () => {
    const g = buildGrid(SLOTS, [1], [lesson("a", 1, "p1"), lesson("b", 1, "p2")]);
    expect(g.map((row) => row[0]!.type)).toEqual(["lesson", "covered", "non-lesson", "empty", "empty"]);
    expect(g[0]![0]).toMatchObject({ rowSpan: 2 });
  });

  it("never merges across a break, nor lessons with a different subject or teacher set", () => {
    const g = buildGrid(SLOTS, [1, 2], [
      lesson("a", 1, "p2"), lesson("b", 1, "p3"), // across the break
      lesson("c", 2, "p1"), lesson("d", 2, "p2", "english"), // different subject
      lesson("e", 2, "p3"), lesson("f", 2, "p4", "maths", ["t", "u"]), // different teachers
    ]);
    expect(g.map((row) => row.map((c) => (c.type === "lesson" ? c.rowSpan : c.type)))).toEqual([
      ["empty", 1],
      [1, 1],
      ["non-lesson", "non-lesson"],
      [1, 1],
      ["empty", 1],
    ]);
  });
});

describe("maxSpanFrom", () => {
  it("counts consecutive lesson slots, stopping at a break or the end of the day", () => {
    expect(maxSpanFrom(SLOTS, "p1")).toBe(2);
    expect(maxSpanFrom(SLOTS, "p3")).toBe(2);
    expect(maxSpanFrom(SLOTS, "p4")).toBe(1);
  });
});

describe("otherClassNames", () => {
  it("names the classes other than the one being edited", () => {
    const clash = {
      teacherId: "t", teacherName: "T", dayOfWeek: 1, bellSlotId: "p1", slotLabel: "P1", termId: "x", termName: "First Term",
      classArms: [{ id: "a", name: "JSS 1A" }, { id: "b", name: "JSS 1B" }],
    };
    expect(otherClassNames(clash, "b")).toEqual(["JSS 1A"]);
  });
});
