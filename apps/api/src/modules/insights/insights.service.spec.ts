import type { ConfigService } from "@nestjs/config";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AiCallRequest, AiCallResult, AnthropicPort } from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { InsightsService } from "./insights.service.js";

// Integration suite against real Postgres, Anthropic faked.
//
// The assertions that matter here are all about the boundary between what the
// model does and what SQL does:
//   * the model never sees a student name, even on the at-risk report whose
//     table is entirely student names;
//   * an out-of-enum or unparseable routing decision degrades to "unsupported"
//     rather than crashing or silently answering a different question;
//   * a narration failure loses the prose, never the figures.
// Every number asserted below is one the service computed, which is the whole
// design (see the service header).

const NARRATION = "SS 2 B is the outlier, more than twenty points below the next class.";

class FakePort implements AnthropicPort {
  calls: AiCallRequest[] = [];
  routerOutput = JSON.stringify({ intent: "underperforming-classes", unsupported: false });
  narrationBehaviour: "ok" | "throw" = "ok";

  async create(req: AiCallRequest): Promise<AiCallResult> {
    this.calls.push(req);
    // The router prompt is the one carrying the intent catalogue; narration
    // carries "Figures:". Distinguishing on content keeps the fake honest
    // about which call it is answering.
    const isRouter = req.userContent.includes("Available reports:");
    if (!isRouter && this.narrationBehaviour === "throw") {
      throw new Error("simulated narration failure");
    }
    return {
      text: isRouter ? this.routerOutput : JSON.stringify({ answer: NARRATION }),
      inputTokens: 120,
      outputTokens: 40,
      stopReason: "end_turn",
    };
  }

  routerCall(): AiCallRequest | undefined {
    return this.calls.find((c) => c.userContent.includes("Available reports:"));
  }
  narrationCall(): AiCallRequest | undefined {
    return this.calls.find((c) => c.userContent.includes("Figures:"));
  }
}

const configStub = () => ({ get: () => undefined }) as unknown as ConfigService;
const runId = Math.random().toString(36).slice(2, 8);

let schoolId: string;
let adminId: string;
let termId: string;
let port: FakePort;
let service: InsightsService;

// Two students with deliberately different risk profiles, so the "either
// signal" filter can be asserted rather than assumed.
const WEAK_NAME = `Chidinma${runId}`; // low scores, good attendance
const ABSENT_NAME = `Olumide${runId}`; // fine scores, poor attendance
const FINE_NAME = `Adaeze${runId}`; // neither — must not be flagged

function ctx(): AuthContext {
  return { schoolId, userId: adminId } as AuthContext;
}

describe("InsightsService", () => {
  beforeAll(async () => {
    const school = await basePrisma.school.create({
      data: {
        name: `IN ${runId}`,
        slug: `in-${runId}`,
        status: "ACTIVE",
        aiMonthlyTokenBudget: 5_000_000,
        // aiEnabled explicitly (2026-08-14): School.aiEnabled now defaults
        // FALSE, and every generation in this suite goes through
        // AiGenerationService.reserve(), which throws DISABLED_SCHOOL when it
        // is off. AI being ON is a precondition of what these tests exercise,
        // not an incidental default — same reasoning as the explicit
        // aiMonthlyTokenBudget beside it.
        aiEnabled: true,
      },
      select: { id: true },
    });
    schoolId = school.id;

    const adminRoleId = (
      await basePrisma.role.findFirstOrThrow({
        where: { schoolId: null, key: "admin", isSystem: true },
        select: { id: true },
      })
    ).id;

    await withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: { schoolId, email: `admin-${runId}@t.test`, firstName: "Ada", lastName: "Admin" },
        select: { id: true },
      });
      adminId = user.id;
      await db.userRole.create({ data: { userId: user.id, roleId: adminRoleId } });

      const level = await db.classLevel.create({
        data: { schoolId, name: "SS 2", code: `ss2-${runId}`, stage: "SSS", orderIndex: 8 },
        select: { id: true },
      });
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "B", code: `ss2b-${runId}` },
        select: { id: true },
      });
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `Y-${runId}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
        select: { id: true },
      });
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
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

      const mkStudent = async (first: string, n: number, score: number, presentDays: number) => {
        const s = await db.student.create({
          data: {
            schoolId,
            firstName: first,
            lastName: `Learner-${runId}`,
            admissionNumber: `ADM-${runId}-${n}`,
            dateOfBirth: new Date("2010-01-01"),
            gender: "FEMALE",
          },
          select: { id: true },
        });
        await db.enrollment.create({
          data: { schoolId, studentId: s.id, termId, academicYearId: year.id, classArmId: arm.id },
        });
        await db.assessment.create({
          data: {
            schoolId,
            studentId: s.id,
            subjectId: maths.id,
            termId,
            academicYearId: year.id,
            classArmId: arm.id,
            totalScore: score,
            computedAt: new Date(),
          },
        });
        // 10 register entries per student; presentDays of them PRESENT.
        for (let i = 0; i < 10; i++) {
          await db.attendanceRecord.create({
            data: {
              schoolId,
              studentId: s.id,
              classArmId: arm.id,
              termId,
              date: new Date(Date.UTC(2026, 4, i + 1)),
              status: i < presentDays ? "PRESENT" : "ABSENT",
              markedBy: adminId,
            },
          });
        }
        return s.id;
      };

      await mkStudent(WEAK_NAME, 1, 32, 10); // 32% avg, 100% attendance
      await mkStudent(ABSENT_NAME, 2, 61, 5); // 61% avg, 50% attendance
      await mkStudent(FINE_NAME, 3, 72, 10); // 72% avg, 100% attendance
    });
  });

  beforeEach(() => {
    port = new FakePort();
    service = new InsightsService(new AiGenerationService(configStub(), port));
  });

  // -------------------------------------------------------------------------
  // The PII boundary
  // -------------------------------------------------------------------------
  it("never sends a student name to the model, even on the at-risk report", async () => {
    port.routerOutput = JSON.stringify({ intent: "at-risk-students", unsupported: false });

    const result = await service.ask(ctx(), {
      question: "which students are at risk?",
      termId,
    });

    // The table an admin sees DOES carry names — that is the point of it.
    const names = (result.data?.intent === "at-risk-students" ? result.data.rows : []).map(
      (r) => r.firstName,
    );
    expect(names).toContain(WEAK_NAME);

    // The model saw none of them, on either call.
    for (const call of port.calls) {
      for (const name of [WEAK_NAME, ABSENT_NAME, FINE_NAME]) {
        expect(call.userContent).not.toContain(name);
      }
    }
    // And what it DID see is aggregate.
    expect(port.narrationCall()?.userContent).toContain("students flagged as at risk");
  });

  // -------------------------------------------------------------------------
  // Routing is a closed space
  // -------------------------------------------------------------------------
  it("treats an out-of-enum intent as unsupported rather than answering something else", async () => {
    port.routerOutput = JSON.stringify({ intent: "fee-defaulters", unsupported: false });

    const result = await service.ask(ctx(), { question: "who owes fees?", termId });

    expect(result.unsupported).toBe(true);
    expect(result.data).toBeNull();
    expect(result.answer).toBeNull();
    // No narration call — nothing was computed to narrate.
    expect(port.narrationCall()).toBeUndefined();
  });

  it("treats unparseable router output as unsupported rather than throwing", async () => {
    port.routerOutput = "I think you want the fee report!";

    const result = await service.ask(ctx(), { question: "anything", termId });

    expect(result.unsupported).toBe(true);
    expect(result.data).toBeNull();
  });

  it("honours an explicit unsupported decision without running a report", async () => {
    port.routerOutput = JSON.stringify({ intent: "weakest-subjects", unsupported: true });

    const result = await service.ask(ctx(), { question: "how is Mrs Bello doing?", termId });

    expect(result.unsupported).toBe(true);
    expect(result.data).toBeNull();
    expect(port.narrationCall()).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Figures come from SQL, and survive the AI
  // -------------------------------------------------------------------------
  it("computes class performance from the database, and narrates over it", async () => {
    const result = await service.ask(ctx(), { question: "which classes are struggling?", termId });

    expect(result.unsupported).toBe(false);
    expect(result.intent).toBe("underperforming-classes");
    const rows = result.data?.intent === "underperforming-classes" ? result.data.rows : [];
    expect(rows).toHaveLength(1);
    // (32 + 61 + 72) / 3 = 55 — computed here, never by the model.
    expect(rows[0]?.averageScore).toBe(55);
    // 25 present of 30 register entries.
    expect(rows[0]?.attendanceRate).toBe(83);
    expect(result.answer).toBe(NARRATION);
  });

  it("returns the figures with answer: null when narration fails", async () => {
    port.narrationBehaviour = "throw";

    const result = await service.ask(ctx(), { question: "which classes are struggling?", termId });

    // The report survives the AI being unavailable — the payoff for splitting
    // routing and narration into two calls.
    expect(result.answer).toBeNull();
    expect(result.data?.intent).toBe("underperforming-classes");
    const rows = result.data?.intent === "underperforming-classes" ? result.data.rows : [];
    expect(rows[0]?.averageScore).toBe(55);
  });

  // -------------------------------------------------------------------------
  // The at-risk filter
  // -------------------------------------------------------------------------
  it("flags on EITHER low scores or low attendance, and leaves a healthy student alone", async () => {
    port.routerOutput = JSON.stringify({ intent: "at-risk-students", unsupported: false });

    const result = await service.ask(ctx(), { question: "who is at risk?", termId });
    const rows = result.data?.intent === "at-risk-students" ? result.data.rows : [];
    const flagged = rows.map((r) => r.firstName);

    expect(flagged).toContain(WEAK_NAME); // 32% average, perfect attendance
    expect(flagged).toContain(ABSENT_NAME); // 61% average, 50% attendance
    // Requiring BOTH signals would drop each of the two above — and this one
    // must not appear on either.
    expect(flagged).not.toContain(FINE_NAME);
  });

  it("reports the weakest subject with a below-pass count", async () => {
    port.routerOutput = JSON.stringify({ intent: "weakest-subjects", unsupported: false });

    const result = await service.ask(ctx(), { question: "which subjects are weakest?", termId });
    const rows = result.data?.intent === "weakest-subjects" ? result.data.rows : [];

    expect(rows[0]?.name).toBe("Mathematics");
    expect(rows[0]?.averageScore).toBe(55);
    expect(rows[0]?.scoredStudentCount).toBe(3);
    expect(rows[0]?.belowPassCount).toBe(1); // only the 32%
  });
});
