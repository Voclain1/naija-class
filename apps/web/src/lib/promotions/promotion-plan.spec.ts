import { describe, expect, it } from "vitest";

import type {
  PromotionCandidateDto,
  PromotionPreviewDto,
} from "@school-kit/types";

import {
  initialPlan,
  resolveArmGap,
  setAction,
  setActionForArm,
  setClassArm,
  summarise,
  toDecisions,
} from "./promotion-plan";

// What the promotion screen pre-selects, and what it refuses to send. The
// sibling spec for the feature this replaced (carry-over-selection.spec.ts)
// exists for the same reason: the 2026-08-25 incident was a default selection,
// not a broken write.

function candidate(
  overrides: Partial<PromotionCandidateDto> & { studentId: string },
): PromotionCandidateDto {
  return {
    admissionNumber: "ADM/1",
    displayName: "Pupil Test",
    studentStatus: "ACTIVE",
    sourceEnrollmentId: `enr-${overrides.studentId}`,
    sourceClassLevelId: "l1",
    sourceClassLevelName: "Primary 1",
    sourceClassArmId: "1a",
    sourceClassArmName: "Primary 1A",
    sourceArmIndex: 0,
    sourceStatus: "ENROLLED",
    proposedAction: "PROMOTE",
    proposedClassArmId: "2a",
    proposedClassArmName: "Primary 2A",
    destinationClassLevelId: "l2",
    destinationClassLevelName: "Primary 2",
    blockReason: null,
    ...overrides,
  };
}

function preview(candidates: PromotionCandidateDto[]): PromotionPreviewDto {
  return {
    mode: "YEAR_PROMOTION",
    sourceTerm: {
      id: "t1",
      name: "Third Term",
      sequence: 3,
      academicYearId: "y1",
      academicYearName: "2024/2025",
    },
    targetTerm: {
      id: "t2",
      name: "First Term",
      sequence: 1,
      academicYearId: "y2",
      academicYearName: "2025/2026",
    },
    candidates,
    gaps: [],
    counts: {
      promote: 0,
      repeat: 0,
      graduate: 0,
      exclude: 0,
      blocked: 0,
      total: candidates.length,
    },
  };
}

describe("initialPlan", () => {
  it("takes the server's proposal verbatim", () => {
    const rows = [
      candidate({ studentId: "s1" }),
      candidate({
        studentId: "s2",
        proposedAction: "GRADUATE",
        proposedClassArmId: null,
      }),
    ];
    const plan = initialPlan(preview(rows));
    expect(plan.get("s1")).toEqual({ action: "PROMOTE", classArmId: "2a" });
    expect(plan.get("s2")).toEqual({ action: "GRADUATE", classArmId: null });
  });

  it("never invents a destination the server could not resolve", () => {
    // The whole guard rail: a blocked row starts undecided, so an admin has to
    // answer for it rather than a default answering on their behalf.
    const blocked = candidate({
      studentId: "s3",
      proposedAction: "EXCLUDE",
      proposedClassArmId: null,
      blockReason: "NO_DESTINATION_ARM",
    });
    const plan = initialPlan(preview([blocked]));
    expect(plan.get("s3")).toEqual({ action: "EXCLUDE", classArmId: null });
  });
});

describe("setAction", () => {
  const row = candidate({ studentId: "s1" });

  it("points a repeat at the student's own arm", () => {
    const plan = setAction(initialPlan(preview([row])), row, "REPEAT");
    expect(plan.get("s1")).toEqual({ action: "REPEAT", classArmId: "1a" });
  });

  it("clears the arm for graduate and exclude", () => {
    for (const action of ["GRADUATE", "EXCLUDE"] as const) {
      const plan = setAction(initialPlan(preview([row])), row, action);
      expect(plan.get("s1")?.classArmId).toBeNull();
    }
  });

  it("does not mutate the plan it was given", () => {
    const before = initialPlan(preview([row]));
    setAction(before, row, "EXCLUDE");
    expect(before.get("s1")?.action).toBe("PROMOTE");
  });
});

describe("setActionForArm", () => {
  it("only touches rows in the named arm", () => {
    const rows = [
      candidate({ studentId: "s1", sourceClassArmId: "1a" }),
      candidate({ studentId: "s2", sourceClassArmId: "1b" }),
    ];
    const plan = setActionForArm(initialPlan(preview(rows)), rows, "1a", "EXCLUDE");
    expect(plan.get("s1")?.action).toBe("EXCLUDE");
    expect(plan.get("s2")?.action).toBe("PROMOTE");
  });
});

describe("resolveArmGap", () => {
  it("places a whole blocked arm into the chosen destination", () => {
    const rows = [
      candidate({
        studentId: "s1",
        sourceClassArmId: "1b",
        proposedAction: "EXCLUDE",
        proposedClassArmId: null,
        blockReason: "NO_DESTINATION_ARM",
      }),
      candidate({ studentId: "s2", sourceClassArmId: "1a" }),
    ];
    const plan = resolveArmGap(initialPlan(preview(rows)), rows, "1b", "2a");
    expect(plan.get("s1")).toEqual({ action: "PROMOTE", classArmId: "2a" });
    expect(plan.get("s2")?.classArmId).toBe("2a"); // untouched, from its own proposal
  });
});

describe("summarise", () => {
  it("counts each bucket and flags rows still missing a class", () => {
    const rows = [
      candidate({ studentId: "s1" }),
      candidate({ studentId: "s2", proposedAction: "GRADUATE", proposedClassArmId: null }),
      candidate({
        studentId: "s3",
        proposedAction: "EXCLUDE",
        proposedClassArmId: null,
      }),
    ];
    const excludedRow = rows[2]!;
    let plan = initialPlan(preview(rows));
    // An admin promotes the excluded row but has not picked a class yet.
    plan = setAction(plan, excludedRow, "PROMOTE");
    plan = setClassArm(plan, "s3", "");

    const summary = summarise(plan, rows);
    expect(summary).toMatchObject({
      promote: 2,
      graduate: 1,
      repeat: 0,
      exclude: 0,
      actionable: 3,
    });
    expect(summary.unplaced).toBe(1);
  });
});

describe("toDecisions", () => {
  it("drops excluded rows and omits classArmId where the API forbids it", () => {
    const rows = [
      candidate({ studentId: "s1" }),
      candidate({
        studentId: "s2",
        proposedAction: "GRADUATE",
        proposedClassArmId: null,
      }),
      candidate({
        studentId: "s3",
        proposedAction: "EXCLUDE",
        proposedClassArmId: null,
      }),
    ];
    const decisions = toDecisions(initialPlan(preview(rows)), rows);
    expect(decisions).toEqual([
      { studentId: "s1", action: "PROMOTE", classArmId: "2a" },
      { studentId: "s2", action: "GRADUATE" },
    ]);
  });

  it("refuses to build a payload while anything is unplaced", () => {
    const row = candidate({
      studentId: "s1",
      proposedAction: "EXCLUDE",
      proposedClassArmId: null,
      blockReason: "NO_DESTINATION_ARM",
    });
    let plan = initialPlan(preview([row]));
    plan = setAction(plan, row, "PROMOTE"); // proposal had no arm to copy
    expect(toDecisions(plan, [row])).toBeNull();
  });
});
