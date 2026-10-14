import { describe, expect, it } from "vitest";
import type { CbtCandidateRowDto, CbtInvigilatorSheetDto } from "@school-kit/types";

import {
  cbtExamUrl,
  cbtFlagLabel,
  cbtNotReadyReason,
  cbtProgressLabel,
  cbtStatusLabel,
  cbtVersionsLabel,
  changedTheoryRows,
  describeSittingTime,
  invigilatorSheetHtml,
  localMoment,
  normaliseTime,
  parseTheoryMark,
  readScheduleTimes,
} from "./cbt-format";

// The first seven tests are the website's cbt-format.spec.ts, unchanged, so
// the phone keeps the same rules.
describe("cbt-format (shared with the website)", () => {
  it("labels statuses in words", () => {
    expect(cbtStatusLabel("DRAFT")).toBe("Draft");
    expect(cbtStatusLabel("PUBLISHED")).toBe("Published");
    expect(cbtStatusLabel("CLOSED")).toBe("Closed");
  });

  it("turns a date and time into a moment, or null when incomplete", () => {
    const d = localMoment("2026-11-20", "09:30")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
    expect(localMoment("", "09:30")).toBeNull();
    expect(localMoment("2026-11-20", "9")).toBeNull();
  });

  it("describes when a sitting runs, with the latest start and the length", () => {
    const start = localMoment("2026-11-20", "09:00")!;
    const latest = localMoment("2026-11-20", "09:30")!;
    const text = describeSittingTime({ startsAt: start.toISOString(), windowEndsAt: latest.toISOString(), durationMinutes: 40 });
    expect(text).toMatch(/20 Nov 2026/);
    expect(text).toMatch(/start by/);
    expect(text).toMatch(/40 min$/);
  });

  it("says how far a student has got, and when they moved computers", () => {
    const at = "2026-11-20T09:10:00.000Z";
    expect(cbtProgressLabel(null, 40)).toBe("Not started");
    expect(cbtProgressLabel({ machines: 1, answeredCount: 12, submitted: false, lastReceivedAt: at }, 40)).toBe("Sitting — 12 of 40 answered");
    expect(cbtProgressLabel({ machines: 2, answeredCount: 38, submitted: true, lastReceivedAt: at }, 40)).toBe(
      "Submitted — 38 of 40 answered (2 computers)",
    );
  });

  it("labels flags in words", () => {
    expect(cbtFlagLabel("LEFT_WINDOW", 1)).toBe("Left the exam window once");
    expect(cbtFlagLabel("LEFT_WINDOW", 3)).toBe("Left the exam window 3 times");
    expect(cbtFlagLabel("NOT_SUBMITTED", 0)).toBe("Did not finish");
  });

  it("says why a row cannot go to the gradebook yet", () => {
    const base = { attempts: [], needsChoice: false, total: null, objectiveScore: null };
    expect(cbtNotReadyReason(base)).toBe("No answers received");
    expect(cbtNotReadyReason({ ...base, attempts: [{}, {}] as never, needsChoice: true })).toBe("Choose which computer counts");
    expect(cbtNotReadyReason({ ...base, attempts: [{}] as never, objectiveScore: 4 })).toBe("Theory mark needed");
    expect(cbtNotReadyReason({ ...base, attempts: [{}] as never, objectiveScore: 4, total: 9 })).toBeNull();
  });

  it("reads a typed theory mark", () => {
    expect(parseTheoryMark("", 10)).toBeNull();
    expect(parseTheoryMark(" 7 ", 10)).toBe(7);
    expect(parseTheoryMark("11", 10)).toBe("invalid");
    expect(parseTheoryMark("3.5", 10)).toBe("invalid");
  });
});

describe("cbt-format (phone)", () => {
  it("prints the production exam address with the school's slug", () => {
    expect(cbtExamUrl("greenfield")).toBe("https://cbt.schoolkit.ng/greenfield");
  });

  it("reads a typed time with or without the colon", () => {
    expect(normaliseTime("09:00")).toBe("09:00");
    expect(normaliseTime("9:05")).toBe("09:05");
    expect(normaliseTime("0930")).toBe("09:30");
    expect(normaliseTime("930")).toBe("09:30");
    expect(normaliseTime(" 14:15 ")).toBe("14:15");
    expect(normaliseTime("24:00")).toBeNull();
    expect(normaliseTime("09:60")).toBeNull();
    expect(normaliseTime("9")).toBeNull();
    expect(normaliseTime("")).toBeNull();
  });

  it("checks the schedule form and says the first problem in words", () => {
    const ok = readScheduleTimes({ date: "2026-11-20", startTime: "9:00", latestStart: "0930", duration: "40" });
    expect(ok.problem).toBeNull();
    expect(ok.durationMinutes).toBe(40);
    expect(ok.windowEndsAt!.getTime() - ok.startsAt!.getTime()).toBe(30 * 60_000);

    expect(readScheduleTimes({ date: null, startTime: "09:00", latestStart: "09:30", duration: "40" }).problem).toMatch(/day, month and year/);
    expect(readScheduleTimes({ date: "2026-11-20", startTime: "9", latestStart: "09:30", duration: "40" }).problem).toMatch(/start time/);
    expect(readScheduleTimes({ date: "2026-11-20", startTime: "09:30", latestStart: "09:30", duration: "40" }).problem).toBe(
      "The latest start must be after the start.",
    );
    expect(readScheduleTimes({ date: "2026-11-20", startTime: "09:00", latestStart: "09:30", duration: "4" }).problem).toMatch(/5 to 600/);
    expect(readScheduleTimes({ date: "2026-11-20", startTime: "09:00", latestStart: "09:30", duration: "601" }).durationMinutes).toBeNull();
  });

  it("names the versions", () => {
    expect(cbtVersionsLabel(1)).toBe("Version A");
    expect(cbtVersionsLabel(4)).toBe("Versions A–D");
  });

  it("finds only the theory marks the teacher actually changed", () => {
    const rows = [
      { studentId: "a", theoryMark: 5 },
      { studentId: "b", theoryMark: null },
      { studentId: "c", theoryMark: 7 },
    ];
    expect(changedTheoryRows(rows, {})).toEqual([]);
    expect(changedTheoryRows(rows, { a: " 5 ", b: "", c: "8" }).map((r) => r.studentId)).toEqual(["c"]);
    expect(changedTheoryRows(rows, { a: "", b: "3" }).map((r) => r.studentId)).toEqual(["a", "b"]);
  });

  it("builds a printable invigilator sheet with the codes, the address and an escaped register", () => {
    const sheet: CbtInvigilatorSheetDto = {
      sittingId: "s1",
      schoolName: "Greenfield <College>",
      schoolSlug: "greenfield",
      title: "JSS2 Maths",
      subjectName: "Mathematics",
      classLevelName: "JSS 2",
      armNames: ["Gold", "Blue"],
      startsAt: "2026-11-20T08:00:00.000Z",
      windowEndsAt: "2026-11-20T08:30:00.000Z",
      durationMinutes: 40,
      candidateCount: 1,
      accessCode: "K7P2QX",
      unlockCode: "ABCD-EFGH-JKLM",
    };
    const candidates: CbtCandidateRowDto[] = [
      { studentId: "st1", admissionNumber: "GF/001", firstName: "Ada", lastName: "O'Neil", armName: "Gold", version: "B", progress: null },
    ];
    const html = invigilatorSheetHtml(sheet, candidates);
    expect(html).toContain("K7P2QX");
    expect(html).toContain("ABCD-EFGH-JKLM");
    expect(html).toContain("https://cbt.schoolkit.ng/greenfield");
    expect(html).toContain("Greenfield &lt;College&gt;");
    expect(html).toContain("O&#39;Neil, Ada");
    expect(html).toContain("Register (1)");
    expect(html).toContain("they have 40 minutes");
    expect(html).not.toMatch(/border-left|border-right/);
  });
});
