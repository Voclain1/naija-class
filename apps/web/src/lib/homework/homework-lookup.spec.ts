import type { HomeworkDto } from "@school-kit/types";
import { describe, expect, it } from "vitest";

import { splitHomeworkForLookup } from "./homework-lookup";

function hw(id: string, dueDate: string, withdrawnAt: string | null = null): HomeworkDto {
  return {
    id,
    classArmId: "arm",
    className: "JSS 1 Blue",
    subjectId: "sub",
    subjectName: "Mathematics",
    title: id,
    instructions: null,
    dueDate,
    postedAt: "2026-10-01T08:00:00.000Z",
    postedByName: "Mrs Okafor",
    withdrawnAt,
    collectsWork: false,
  };
}

describe("splitHomeworkForLookup", () => {
  const today = "2026-10-14";

  it("puts today's and later work first, soonest first", () => {
    const { upcoming } = splitHomeworkForLookup([hw("c", "2026-10-20"), hw("a", "2026-10-14"), hw("b", "2026-10-15")], today);
    expect(upcoming.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the last week's work, latest first, and drops anything older", () => {
    const { recent } = splitHomeworkForLookup([hw("old", "2026-10-06"), hw("x", "2026-10-07"), hw("y", "2026-10-13")], today);
    expect(recent.map((i) => i.id)).toEqual(["y", "x"]);
  });

  it("leaves out withdrawn work, which the class no longer sees", () => {
    const result = splitHomeworkForLookup([hw("gone", "2026-10-15", "2026-10-13T09:00:00.000Z"), hw("gone2", "2026-10-13", "2026-10-12T09:00:00.000Z")], today);
    expect(result).toEqual({ upcoming: [], recent: [] });
  });
});
