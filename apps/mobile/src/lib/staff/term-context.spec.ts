import { describe, expect, it } from "vitest";
import type { AcademicYearDto, TermDto } from "@school-kit/types";

import { resolveCurrentTerm, termResolutionMessage } from "./term-context";

function year(over: Partial<AcademicYearDto> = {}): AcademicYearDto {
  return {
    id: "y1",
    label: "2025/2026",
    startDate: "2025-09-01",
    endDate: "2026-07-31",
    isCurrent: true,
    createdAt: "2025-09-01",
    updatedAt: "2025-09-01",
    ...over,
  } as AcademicYearDto;
}

function term(over: Partial<TermDto> = {}): TermDto {
  return {
    id: "t1",
    academicYearId: "y1",
    sequence: 1,
    name: "First Term",
    startDate: "2025-09-01",
    endDate: "2025-12-15",
    isCurrent: true,
    createdAt: "2025-09-01",
    updatedAt: "2025-09-01",
    ...over,
  } as TermDto;
}

describe("resolveCurrentTerm", () => {
  it("resolves the current year's current term", () => {
    const res = resolveCurrentTerm([year({ id: "yOld", isCurrent: false }), year()], [term()]);
    expect(res.failure).toBeNull();
    expect(res.term).toEqual({
      yearId: "y1",
      yearLabel: "2025/2026",
      termId: "t1",
      termName: "First Term",
    });
  });

  it("ignores terms belonging to a non-current year's shape", () => {
    // Only one term list is ever fetched (for the current year), so the
    // contract is simply: pick the isCurrent one out of what was given.
    const res = resolveCurrentTerm(
      [year()],
      [term({ id: "t1", isCurrent: false }), term({ id: "t2", name: "Second Term" })],
    );
    expect(res.term?.termId).toBe("t2");
  });

  // Each failure is NAMED rather than collapsed to null. The four cases are
  // genuinely different problems for the bursar looking at the screen: two are
  // a flag an admin can set in a couple of taps, two are missing structure.
  it.each([
    ["NO_ACADEMIC_YEAR", [] as AcademicYearDto[], [term()]],
    ["NO_CURRENT_YEAR", [year({ isCurrent: false })], [term()]],
    ["NO_TERM_IN_YEAR", [year()], [] as TermDto[]],
    ["NO_CURRENT_TERM", [year()], [term({ isCurrent: false })]],
  ])("names the %s failure distinctly", (expected, years, terms) => {
    const res = resolveCurrentTerm(years as AcademicYearDto[], terms as TermDto[]);
    expect(res.term).toBeNull();
    expect(res.failure).toBe(expected);
  });

  it("treats a null term list as NO_TERM_IN_YEAR, so the second request can be skipped", () => {
    // useTermContext passes null when the first response already settled the
    // outcome — this is what makes "don't spend the round-trip" safe.
    expect(resolveCurrentTerm([year()], null).failure).toBe("NO_TERM_IN_YEAR");
  });

  it("every failure has a message that says what to do about it", () => {
    for (const f of [
      "NO_ACADEMIC_YEAR",
      "NO_CURRENT_YEAR",
      "NO_TERM_IN_YEAR",
      "NO_CURRENT_TERM",
    ] as const) {
      const msg = termResolutionMessage(f);
      expect(msg.length).toBeGreaterThan(20);
      // Never a bare "no data" — the web finance dashboard's dead-end empty
      // state (#198/#200) is the failure this is written against.
      expect(msg.toLowerCase()).not.toBe("no data");
    }
    expect(termResolutionMessage("NO_CURRENT_TERM")).toContain("administrator");
  });
});
