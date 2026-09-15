import { describe, expect, it } from "vitest";

import { queryKeys } from "./keys";
import { mayPersistQuery } from "./persist-policy";

// Phase 8 / CP1 — the calendar is one of the things the offline cache exists
// for: a family checking resumption day with no data bundle. It carries no
// personal data, so it SHOULD persist. Asserted on the real keys the screens
// use, the same way staff-keys.spec.ts pins the opposite property for staff.
describe("calendar query keys", () => {
  it("guardian and student calendar keys are persistable", () => {
    expect(mayPersistQuery(queryKeys.guardianCalendar("2026-09-01", "2027-02-28"))).toBe(true);
    expect(mayPersistQuery(queryKeys.myCalendar("2026-09-01", "2027-02-28"))).toBe(true);
  });

  it("Phase 8 / CP4: the published class timetable keys are persistable (families' offline copy)", () => {
    expect(mayPersistQuery(queryKeys.studentTimetable("s1"))).toBe(true);
    expect(mayPersistQuery(queryKeys.myTimetable)).toBe(true);
    expect(queryKeys.studentTimetable("s1")).not.toEqual(queryKeys.studentTimetable("s2"));
  });

  it("the window is part of the key, so one window's cache is never shown for another", () => {
    expect(queryKeys.guardianCalendar("2026-09-01", "2027-02-28")).not.toEqual(
      queryKeys.guardianCalendar("2026-10-01", "2027-03-30"),
    );
  });
});
