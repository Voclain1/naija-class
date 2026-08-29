import { describe, expect, it } from "vitest";

import type { SetupStateDto, SetupStepDto, SetupStepKey, SetupStepTier } from "@school-kit/types";

import {
  checklistProgress,
  doneSummary,
  shouldShowChecklist,
} from "./checklist-presentation";

// Presentation rules only. What "done" means is settled by
// SetupStateService and covered by its own integration suite against a real
// database; nothing here re-derives it. These tests exist for the decisions
// the client actually makes: how much to show, what to count, and how a
// finished row reads to a Nigerian school owner.

function step(
  key: SetupStepKey,
  tier: SetupStepTier,
  done: boolean,
  count = done ? 1 : 0,
): SetupStepDto {
  return {
    key,
    tier,
    done,
    count,
    title: key,
    why: "because",
    href: `/${key}`,
    actionLabel: "Go",
  };
}

function state(overrides: Partial<SetupStateDto>): SetupStateDto {
  return {
    status: "setup",
    hasRealActivity: false,
    steps: [],
    alreadyDone: [],
    requiredRemaining: 0,
    recommendedRemaining: 0,
    nextStepKey: null,
    ...overrides,
  };
}

describe("shouldShowChecklist", () => {
  it("shows while required work is outstanding", () => {
    expect(shouldShowChecklist(state({ status: "setup" }))).toBe(true);
  });

  it("shows while only recommended work is outstanding and the school has not started", () => {
    expect(shouldShowChecklist(state({ status: "finishing" }))).toBe(true);
  });

  // The anti-clutter rule. An established school stops seeing setup UI even
  // with steps outstanding — that is the API's judgement and the client does
  // not second-guess it.
  it("hides for an established school even with steps still outstanding", () => {
    expect(
      shouldShowChecklist(
        state({ status: "established", recommendedRemaining: 3, hasRealActivity: true }),
      ),
    ).toBe(false);
  });

  // A failed load, or a viewer the API refuses (bursar, teacher), leaves the
  // state null. Guidance that cannot load should be silent rather than
  // rendering a broken shell.
  it("hides when there is no state at all", () => {
    expect(shouldShowChecklist(null)).toBe(false);
  });
});

describe("checklistProgress", () => {
  it("counts required and recommended steps only", () => {
    const steps = [
      step("academic-calendar", "required", true),
      step("students", "required", true),
      step("enrollments", "required", false),
      step("fee-catalog", "recommended", false),
      // Both optional steps are outstanding and must not drag the number down.
      step("class-subjects", "optional", false),
      step("guardians", "optional", false),
    ];
    expect(checklistProgress(steps)).toEqual({ done: 2, total: 4, percent: 50 });
  });

  it("reports 100% once every required and recommended step is done, optional or not", () => {
    const steps = [
      step("academic-calendar", "required", true),
      step("students", "required", true),
      step("enrollments", "required", true),
      step("fee-catalog", "recommended", true),
      step("staff", "recommended", true),
      step("form-teachers", "recommended", true),
      step("teacher-assignments", "recommended", true),
      step("class-subjects", "optional", false),
      step("guardians", "optional", false),
    ];
    expect(checklistProgress(steps).percent).toBe(100);
  });

  it("does not divide by zero on an empty list", () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });
});

describe("doneSummary", () => {
  // The point of reporting the count is that a wrong answer becomes visible.
  // "Done" alone would hide a disagreement between the owner and the system.
  it("reports the count the tick was derived from", () => {
    expect(doneSummary(step("students", "required", true, 42))).toBe(
      "42 students on your roster.",
    );
    expect(doneSummary(step("enrollments", "required", true, 40))).toBe(
      "40 students are in a class this term.",
    );
  });

  it("reads correctly for a single one of anything", () => {
    expect(doneSummary(step("students", "required", true, 1))).toBe("1 student on your roster.");
    expect(doneSummary(step("enrollments", "required", true, 1))).toBe(
      "1 student is in a class this term.",
    );
    expect(doneSummary(step("form-teachers", "recommended", true, 1))).toBe(
      "1 class has a form teacher.",
    );
    expect(doneSummary(step("guardians", "optional", true, 1))).toBe(
      "1 parent or guardian on file.",
    );
  });

  // Product wording, held to the same bar as the rest of this slice: a
  // proprietor reading these lines should meet nothing they have to have
  // learned from School Kit first.
  it("uses plain school language everywhere — no records, entities, or 'configured'", () => {
    const everyKey: SetupStepKey[] = [
      "academic-calendar",
      "students",
      "enrollments",
      "fee-catalog",
      "staff",
      "form-teachers",
      "teacher-assignments",
      "class-subjects",
      "guardians",
    ];
    for (const key of everyKey) {
      const text = doneSummary(step(key, "required", true, 3));
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\b(record|entity|entities|configur|resource|ID|UUID)\b/i);
    }
  });
});
