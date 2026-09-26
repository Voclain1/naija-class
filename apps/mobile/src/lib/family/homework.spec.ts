import { describe, expect, it } from "vitest";

import { groupHomework } from "./homework";
import type { HomeworkFeedItemDto } from "@school-kit/types";

// Grouping homework by WHEN (docs/modules/the-school-day.md Part B).
//
// A child at a kitchen table is answering "what must I do tonight?", so the
// order is the whole design: overdue first, then today, tomorrow, and the rest
// by date. A subject-first list would make them read all of it to find out.

const TODAY = "2026-09-28";
const TOMORROW = "2026-09-29";

const item = (over: Partial<HomeworkFeedItemDto> & { dueDate: string }): HomeworkFeedItemDto => ({
  id: over.dueDate + (over.title ?? ""),
  classArmId: "arm-1",
  className: "JSS1A",
  subjectId: "sub-1",
  subjectName: "Maths",
  title: "Exercise",
  instructions: null,
  postedAt: "2026-09-27T09:00:00.000Z",
  postedByName: "Tunde Teacher",
  withdrawnAt: null,
  overdue: over.dueDate < TODAY,
  ...over,
});

describe("groupHomework", () => {
  it("puts overdue first, however far in the future the rest is", () => {
    const groups = groupHomework(
      [item({ dueDate: "2026-10-05" }), item({ dueDate: TODAY }), item({ dueDate: "2026-09-25" })],
      TODAY,
      TOMORROW,
    );
    expect(groups[0]?.label).toBe("Overdue");
    expect(groups[0]?.overdue).toBe(true);
  });

  it("collapses every overdue day into ONE group", () => {
    // "Overdue since Tuesday" and "overdue since Thursday" as separate
    // headings tells a child nothing they can act on.
    const groups = groupHomework(
      [item({ dueDate: "2026-09-22" }), item({ dueDate: "2026-09-25" })],
      TODAY,
      TOMORROW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(2);
  });

  it("names today and tomorrow in words, and later days by date", () => {
    const groups = groupHomework(
      [item({ dueDate: TODAY }), item({ dueDate: TOMORROW }), item({ dueDate: "2026-10-02" })],
      TODAY,
      TOMORROW,
    );
    expect(groups.map((g) => g.label).slice(0, 2)).toEqual(["Due today", "Due tomorrow"]);
    expect(groups[2]?.label).toMatch(/Friday/);
  });

  it("keeps two subjects due the same day together", () => {
    const groups = groupHomework(
      [
        item({ dueDate: TOMORROW, subjectName: "Maths", title: "A" }),
        item({ dueDate: TOMORROW, subjectName: "English", title: "B" }),
      ],
      TODAY,
      TOMORROW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((i) => i.subjectName)).toEqual(["Maths", "English"]);
  });

  it("trusts the SERVER's overdue flag, not a date comparison of its own", () => {
    // A handset's clock can be wrong, and an app that accuses a child of being
    // late because a phone is a day fast is worse than one that says nothing.
    const groups = groupHomework([item({ dueDate: "2026-09-25", overdue: false })], TODAY, TOMORROW);
    expect(groups[0]?.items[0]?.overdue).toBe(false);
  });

  it("returns nothing for nothing", () => {
    expect(groupHomework([], TODAY, TOMORROW)).toEqual([]);
  });
});
