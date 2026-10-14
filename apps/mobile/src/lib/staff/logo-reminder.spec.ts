import { describe, expect, it } from "vitest";

import { FRESH_RECORD, REMIND_AFTER_SESSIONS, countSitting, dismiss, parseRecord, shouldRemind } from "./logo-reminder";

describe("logo reminder", () => {
  it("shows until it is closed", () => {
    expect(shouldRemind(countSitting(FRESH_RECORD))).toBe(true);
  });

  it("stays closed for the next few sittings, then comes back", () => {
    let record = dismiss(countSitting(FRESH_RECORD));
    expect(shouldRemind(record)).toBe(false);
    for (let i = 1; i < REMIND_AFTER_SESSIONS; i += 1) {
      record = countSitting(record);
      expect(shouldRemind(record)).toBe(false);
    }
    expect(shouldRemind(countSitting(record))).toBe(true);
  });

  it("reads anything unreadable as a fresh record", () => {
    expect(parseRecord(null)).toEqual(FRESH_RECORD);
    expect(parseRecord("not json")).toEqual(FRESH_RECORD);
    expect(parseRecord('{"sessions":"4"}')).toEqual(FRESH_RECORD);
    expect(parseRecord('{"sessions":4,"dismissedAtSession":2}')).toEqual({ sessions: 4, dismissedAtSession: 2 });
  });
});
