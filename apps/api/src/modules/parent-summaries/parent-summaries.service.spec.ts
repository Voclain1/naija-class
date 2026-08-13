import type { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AiCallRequest, AiCallResult, AnthropicPort } from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import type { EmailService } from "../../common/email/email.service.js";
import {
  ParentSummariesService,
  previousWeekStart,
  __testables,
  type ParentSummaryJobData,
} from "./parent-summaries.service.js";

// Integration suite against real Postgres, Anthropic and Resend both faked.
//
// The assertions this file exists for are the ones D16 leaves standing. With
// no teacher-approval gate, the ONLY controls on this feature are:
//   (a) School.parentSummaryEnabled, re-checked at generation time and not
//       merely at enqueue time;
//   (b) the quiet-week skip, which is what stops a school paying to tell
//       parents nothing happened;
//   (c) per-week idempotency, which is what stops a re-run charging twice and
//       delivering twice.
// Each gets a test that fails loudly if someone "simplifies" it away, because
// there is no human downstream who would notice.

const SUMMARY = "Settled well into the week's work, with a solid 15 out of 20 in the Mathematics test.";

class FakePort implements AnthropicPort {
  calls: AiCallRequest[] = [];
  async create(req: AiCallRequest): Promise<AiCallResult> {
    this.calls.push(req);
    return {
      text: JSON.stringify({ summary: SUMMARY }),
      inputTokens: 180,
      outputTokens: 55,
      stopReason: "end_turn",
    };
  }
}

class FakeQueue {
  added: Array<{ name: string; data: ParentSummaryJobData; opts?: { jobId?: string } }> = [];
  async add(name: string, data: ParentSummaryJobData, opts?: { jobId?: string }): Promise<unknown> {
    this.added.push({ name, data, opts });
    return { id: opts?.jobId ?? "job" };
  }
}

class FakeEmail {
  sent: Array<{ to: string; subject: string; html: string }> = [];
  async send(params: { to: string; subject: string; html: string }): Promise<void> {
    this.sent.push(params);
  }
}

const configStub = () => ({ get: () => undefined }) as unknown as ConfigService;
const runId = Math.random().toString(36).slice(2, 8);

let schoolId: string;
let scoredStudentId: string;
let quietStudentId: string;
let termId: string;
let yearId: string;
let armId: string;
let mathsId: string;
let componentId: string;

let port: FakePort;
let queue: FakeQueue;
let email: FakeEmail;
let service: ParentSummariesService;

// The week under test: a fixed past Monday, so the suite does not drift with
// the calendar. Everything is written inside it.
const WEEK_START = new Date("2026-08-03T00:00:00.000Z"); // a Monday
const IN_WEEK = new Date("2026-08-05T09:00:00.000Z"); // the Wednesday

function jobFor(studentId: string): ParentSummaryJobData {
  return { schoolId, studentId, weekStart: "2026-08-03" };
}

async function summaryCount(studentId: string): Promise<number> {
  return withTenant(schoolId, (db) =>
    db.parentSummary.count({ where: { studentId, weekStart: WEEK_START } }),
  );
}

describe("ParentSummariesService", () => {
  beforeAll(async () => {
    const school = await basePrisma.school.create({
      data: {
        name: `PS ${runId}`,
        slug: `ps-${runId}`,
        // ACTIVE explicitly: School.status defaults to ONBOARDING, and the
        // sweep only looks at ACTIVE schools. Without this the sweep tests
        // pass vacuously (nothing queued, nothing asserted against).
        status: "ACTIVE",
        aiMonthlyTokenBudget: 5_000_000,
        parentSummaryEnabled: true,
      },
      select: { id: true },
    });
    schoolId = school.id;

    await withTenant(schoolId, async (db) => {
      const level = await db.classLevel.create({
        data: { schoolId, name: "JSS 2", code: `JSS2-${runId}`, stage: "JSS", orderIndex: 2 },
        select: { id: true },
      });
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "JSS 2 A", code: `jss2a-${runId}` },
        select: { id: true },
      });
      armId = arm.id;

      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `Y-${runId}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
        select: { id: true },
      });
      yearId = year.id;
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: yearId,
          name: "Third Term",
          sequence: 3,
          startDate: new Date("2026-04-20"),
          endDate: new Date("2026-08-30"),
        },
        select: { id: true },
      });
      termId = term.id;

      const maths = await db.subject.create({
        data: { schoolId, name: "Mathematics", code: `math-${runId}` },
        select: { id: true },
      });
      mathsId = maths.id;

      const scheme = await db.gradingScheme.create({
        // One scheme per school (@@unique on school_id). This school was
        // created directly rather than through signupOwner, so nothing has
        // seeded one yet.
        data: { schoolId, name: `Default ${runId}` },
        select: { id: true },
      });
      const component = await db.gradingComponent.create({
        data: {
          schoolId,
          schemeId: scheme.id,
          key: "ca1",
          label: "First CA",
          weight: 20,
          orderIndex: 1,
        },
        select: { id: true },
      });
      componentId = component.id;

      const mkStudent = async (first: string, n: number) => {
        const s = await db.student.create({
          data: {
            schoolId,
            firstName: first,
            lastName: `Learner-${runId}`,
            admissionNumber: `ADM-${runId}-${n}`,
            dateOfBirth: new Date("2012-02-03"),
            gender: "FEMALE",
          },
          select: { id: true },
        });
        await db.enrollment.create({
          data: { schoolId, studentId: s.id, termId, academicYearId: yearId, classArmId: armId },
        });
        return s.id;
      };
      scoredStudentId = await mkStudent("Amaka", 1);
      quietStudentId = await mkStudent("Tunde", 2);

      // A guardian with an email, linked to the scored student only.
      const guardian = await db.guardian.create({
        data: {
          schoolId,
          firstName: "Ngozi",
          lastName: `Parent-${runId}`,
          relationship: "MOTHER",
          phone: "08030000000",
          email: `parent-${runId}@t.test`,
        },
        select: { id: true },
      });
      await db.studentGuardian.create({
        data: { schoolId, studentId: scoredStudentId, guardianId: guardian.id, isPrimary: true },
      });

      // The scored student got a mark inside the week. The quiet student got
      // a full week of PRESENT and nothing else — the shape that must NOT
      // produce a note.
      await db.assessmentScore.create({
        data: {
          schoolId,
          studentId: scoredStudentId,
          subjectId: mathsId,
          termId,
          componentId,
          score: 15,
          enteredBy: scoredStudentId, // plain FK, no user needed for this path
          enteredAt: IN_WEEK,
        },
      });
      for (let i = 0; i < 5; i++) {
        const day = new Date(WEEK_START.getTime() + i * 24 * 60 * 60 * 1000);
        await db.attendanceRecord.create({
          data: {
            schoolId,
            studentId: quietStudentId,
            classArmId: armId,
            termId,
            date: day,
            status: "PRESENT",
            markedBy: quietStudentId,
          },
        });
      }
    });
  });

  beforeEach(async () => {
    // Summaries persist across tests in one school, and several tests below
    // assert on absence ("no row was written"). Clearing here keeps each test
    // independent of the order the others ran in.
    await withTenant(schoolId, (db) => db.parentSummary.deleteMany({}));

    port = new FakePort();
    queue = new FakeQueue();
    email = new FakeEmail();
    const ai = new AiGenerationService(configStub(), port);
    service = new ParentSummariesService(
      ai,
      email as unknown as EmailService,
      queue as unknown as Queue,
    );
  });

  // -------------------------------------------------------------------------
  // Pure helpers
  // -------------------------------------------------------------------------
  it("previousWeekStart: returns the Monday of the week BEFORE the one containing `now`", () => {
    // Monday 2026-08-10 → the week just closed is the one starting 08-03.
    expect(previousWeekStart(new Date("2026-08-10T05:30:00Z")).toISOString().slice(0, 10)).toBe(
      "2026-08-03",
    );
    // Mid-week and Sunday must resolve the same way — Sunday is the trap,
    // because getUTCDay() returns 0 for it and a naive `day - 1` walks
    // backwards into the wrong week.
    expect(previousWeekStart(new Date("2026-08-13T23:00:00Z")).toISOString().slice(0, 10)).toBe(
      "2026-08-03",
    );
    expect(previousWeekStart(new Date("2026-08-16T12:00:00Z")).toISOString().slice(0, 10)).toBe(
      "2026-08-03",
    );
  });

  it("isWeekWorthSummarising: silence is a week with no scores, no absence and no lateness", () => {
    const f = __testables.isWeekWorthSummarising;
    expect(f({ scoreCount: 0, daysAbsent: 0, daysLate: 0 })).toBe(false);
    expect(f({ scoreCount: 1, daysAbsent: 0, daysLate: 0 })).toBe(true);
    expect(f({ scoreCount: 0, daysAbsent: 1, daysLate: 0 })).toBe(true);
    expect(f({ scoreCount: 0, daysAbsent: 0, daysLate: 1 })).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------
  it("writes a summary for a week that had a score, and sends no student PII to the model", async () => {
    await service.generateForStudent(jobFor(scoredStudentId));

    expect(port.calls).toHaveLength(1);
    const sent = port.calls[0]!.userContent;
    // The child's identity must not travel. Asserted here as well as in the
    // eval suite because the eval tests the RENDERER and this tests the
    // SERVICE that feeds it — a leak could be introduced in either.
    expect(sent).not.toContain("Amaka");
    expect(sent).toContain("JSS 2");
    expect(sent).toContain("Mathematics");
    expect(sent).toContain("First CA");
    expect(sent).toContain("15 out of 20");

    const row = await withTenant(schoolId, (db) =>
      db.parentSummary.findFirst({
        where: { studentId: scoredStudentId, weekStart: WEEK_START },
        select: { summary: true, promptVersion: true, emailedAt: true },
      }),
    );
    expect(row?.summary).toBe(SUMMARY);
    expect(row?.promptVersion).toBe("1");
    // Emailed, because the guardian has an address and the school has no
    // preference row (which means email defaults on).
    expect(email.sent.map((e) => e.to)).toEqual([`parent-${runId}@t.test`]);
    expect(row?.emailedAt).not.toBeNull();
  });

  it("writes NOTHING for a quiet week — full attendance, no new scores", async () => {
    await service.generateForStudent(jobFor(quietStudentId));

    // The load-bearing half: no call means no spend. A skip that still paid
    // for a generation would defeat the point.
    expect(port.calls).toHaveLength(0);
    expect(await summaryCount(quietStudentId)).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it("is idempotent per week: a second run neither re-generates nor re-sends", async () => {
    await service.generateForStudent(jobFor(scoredStudentId));
    const first = port.calls.length;
    await service.generateForStudent(jobFor(scoredStudentId));

    expect(port.calls.length).toBe(first);
    expect(await summaryCount(scoredStudentId)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // D16 — the opt-in is the only gate, so it is checked at execution time
  // -------------------------------------------------------------------------
  it("refuses to generate when the school switched the feature off after the job was queued", async () => {
    await withTenant(schoolId, (db) =>
      db.school.update({ where: { id: schoolId }, data: { parentSummaryEnabled: false } }),
    );

    try {
      await service.generateForStudent(jobFor(scoredStudentId));

      // No call, no row. The sweep having checked minutes earlier is not
      // sufficient — this is the whole of D16's control surface, and a
      // summary generated after a school said stop is exactly what the
      // opt-in exists to prevent.
      expect(port.calls).toHaveLength(0);
      expect(await summaryCount(scoredStudentId)).toBe(0);
    } finally {
      await withTenant(schoolId, (db) =>
        db.school.update({ where: { id: schoolId }, data: { parentSummaryEnabled: true } }),
      );
    }
  });

  it("refuses to generate when AI is disabled school-wide, independently of the feature flag", async () => {
    await withTenant(schoolId, (db) =>
      db.school.update({ where: { id: schoolId }, data: { aiEnabled: false } }),
    );

    try {
      await service.generateForStudent(jobFor(scoredStudentId));
      expect(port.calls).toHaveLength(0);
      expect(await summaryCount(scoredStudentId)).toBe(0);
    } finally {
      await withTenant(schoolId, (db) =>
        db.school.update({ where: { id: schoolId }, data: { aiEnabled: true } }),
      );
    }
  });

  // -------------------------------------------------------------------------
  // Sweep
  // -------------------------------------------------------------------------
  it("sweep: enqueues one stable job per enrolled student, and skips weeks already written", async () => {
    await service.sweepWeeklySummaries([schoolId], new Date("2026-08-10T05:30:00Z"));

    const ids = queue.added.map((j) => j.data.studentId).sort();
    expect(ids).toEqual([scoredStudentId, quietStudentId].sort());
    // Stable job id — a double-scheduled sweep cannot double-charge.
    expect(queue.added[0]!.opts?.jobId).toContain("2026-08-03");

    // Write one, sweep again: that student drops out.
    await service.generateForStudent(jobFor(scoredStudentId));
    queue.added = [];
    await service.sweepWeeklySummaries([schoolId], new Date("2026-08-10T05:30:00Z"));
    expect(queue.added.map((j) => j.data.studentId)).toEqual([quietStudentId]);
  });

  it("sweep: skips a school that has not opted in", async () => {
    await withTenant(schoolId, (db) =>
      db.school.update({ where: { id: schoolId }, data: { parentSummaryEnabled: false } }),
    );

    try {
      await service.sweepWeeklySummaries([schoolId], new Date("2026-08-10T05:30:00Z"));
      expect(queue.added).toHaveLength(0);
    } finally {
      await withTenant(schoolId, (db) =>
        db.school.update({ where: { id: schoolId }, data: { parentSummaryEnabled: true } }),
      );
    }
  });
});
