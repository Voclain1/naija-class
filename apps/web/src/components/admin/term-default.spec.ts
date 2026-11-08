import { describe, expect, it } from "vitest";

import { defaultParamToWrite } from "./term-default";

describe("defaultParamToWrite", () => {
  const resolved = { noAcademicYear: false, defaultTermId: "term-1" };

  it("writes nothing while the visit's terms are still being fetched", () => {
    expect(defaultParamToWrite(null, "", false)).toBeNull();
  });

  // The 2026-11-08 bug: returning to /dashboard from another page arrives
  // with no ?termId=. Whatever was resolved must be written again, or the
  // page waits on a term that never comes.
  it("writes the default term when the URL has none", () => {
    expect(defaultParamToWrite(resolved, "", false)).toEqual({ key: "termId", value: "term-1" });
  });

  it("keeps a term already in the URL, including one the person chose", () => {
    expect(defaultParamToWrite(resolved, "term-2", false)).toBeNull();
  });

  it("signals a school with no academic year, once", () => {
    const none = { noAcademicYear: true, defaultTermId: null };
    expect(defaultParamToWrite(none, "", false)).toEqual({ key: "noAcademicYear", value: "1" });
    expect(defaultParamToWrite(none, "", true)).toBeNull();
  });

  it("writes nothing when the year has no terms", () => {
    expect(defaultParamToWrite({ noAcademicYear: false, defaultTermId: null }, "", false)).toBeNull();
  });
});
