import type {
  AttendanceArmRowDto,
  ScoreEntryRowDto,
  TeacherActivityReportDto,
  TeacherActivityRowDto,
} from "@school-kit/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "../api/client";
import { staffTeacherActivity } from "../api/staff-reports";
import { resetServerClock } from "./server-date";
import {
  laggingRegisters,
  laggingScores,
  percent,
  teachersByOutstanding,
} from "./report-summary";

function register(label: string, taken: number, expected: number): AttendanceArmRowDto {
  return {
    groupId: label,
    label,
    classLevelName: "JSS 2",
    enrolledCount: 40,
    registersExpected: expected,
    registersTaken: taken,
    registersOnNonSchoolDays: 0,
    lastRegisterDate: null,
  };
}

function scores(label: string, subjectName: string, entered: number, expected: number): ScoreEntryRowDto {
  return {
    groupId: label,
    label,
    classLevelName: "JSS 2",
    subjectId: subjectName,
    subjectName,
    enrolledCount: 40,
    componentCount: 3,
    slotsExpected: expected,
    slotsEntered: entered,
    studentsWithScores: 0,
    studentsSignedOff: 0,
  };
}

function teacher(name: string, marksLeft: number, registersLeft: number): TeacherActivityRowDto {
  return {
    userId: name,
    name,
    formArms: [],
    formArmRegistersExpected: 10,
    formArmRegistersTaken: 10 - registersLeft,
    registersMarkedByThisPerson: 0,
    assignmentCount: 1,
    assignedSlotsExpected: 100,
    assignedSlotsEntered: 100 - marksLeft,
    assignedSlotsEnteredByThisPerson: 0,
    lastRegisterMarkedAt: null,
    lastScoreEnteredAt: null,
  };
}

describe("percent", () => {
  it("rounds to a whole number", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(40, 40)).toBe(100);
  });

  it("is NULL, not zero, when nothing is expected yet", () => {
    // "0% of 0 registers" reads as failure when it is really "term not started".
    expect(percent(0, 0)).toBeNull();
  });

  it("never exceeds 100", () => {
    expect(percent(12, 10)).toBe(100);
  });
});

describe("what is behind, worst first", () => {
  it("lists only classes whose registers are incomplete, worst first", () => {
    const rows = [register("A", 10, 10), register("B", 2, 10), register("C", 7, 10), register("D", 0, 0)];
    expect(laggingRegisters(rows).map((r) => r.label)).toEqual(["B", "C"]);
  });

  it("lists only subjects with missing marks, worst first", () => {
    const rows = [
      scores("JSS 2A", "Maths", 120, 120),
      scores("JSS 2A", "English", 30, 120),
      scores("JSS 2B", "Maths", 90, 120),
    ];
    expect(laggingScores(rows).map((r) => `${r.label} ${r.subjectName}`)).toEqual([
      "JSS 2A English",
      "JSS 2B Maths",
    ]);
  });

  it("puts the teacher with the most outstanding at the top", () => {
    const rows = [teacher("Ada", 5, 0), teacher("Bayo", 40, 2), teacher("Chi", 0, 0)];
    expect(teachersByOutstanding(rows).map((t) => t.name)).toEqual(["Bayo", "Ada", "Chi"]);
  });
});

describe("teacher activity binding (D35)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const REPORT: TeacherActivityReportDto = { term: null, schoolDays: null, rows: [] };

  beforeEach(() => {
    resetServerClock();
    setTokenProvider(() => "test-token");
    fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(REPORT), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTokenProvider(() => null);
  });

  it("makes exactly ONE request per call — each one is an audited read", async () => {
    await staffTeacherActivity();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/\/reports\/teacher-activity$/);
  });

  it("passes a term when one is given", async () => {
    await staffTeacherActivity("term-2");
    const [url] = fetchMock.mock.calls.at(-1) as unknown as [string];
    expect(new URL(url).searchParams.get("termId")).toBe("term-2");
  });
});
