import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { REPORT_CARDS_JOB_RENDER, REPORT_CARDS_QUEUE } from "../../../common/queue";
import { AggregationService } from "../../assessment/aggregation.service";
import { AuthService } from "../../auth/auth.service";
import { ReportCardService } from "../report-card.service";

// ===========================================================================
// BULLMQ WIRING SMOKE (slice 5 cp2) — the one seam unit/integration specs
// CANNOT cover: a render job enqueued onto the REAL Redis queue, consumed by
// the @Processor running inside a SEPARATELY-BOOTED API process, end-to-end.
//
// This is the "tests pass / runtime fails" guard (banked Phase-1 lesson):
// BullMQ wiring + the Nest worker explorer only fail against a real Redis +
// a real Nest boot. Run with the API server up (nest start) on the same
// REDIS_URL:
//
//   1. terminal A:  pnpm --filter @school-kit/api exec dotenv -e ../../.env -- nest start
//   2. terminal B:  RUN_SMOKE=1 pnpm --filter @school-kit/api exec dotenv -e ../../.env \
//                     -- vitest run src/modules/report-cards/render/wiring-smoke.spec.ts
//
// Guarded behind RUN_SMOKE=1 so the default suite skips it (it depends on an
// external running process).
// ===========================================================================

const RUN_SMOKE = process.env.RUN_SMOKE === "1";

function redisConnection() {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname && parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "smoke" };

describe.runIf(RUN_SMOKE)("report-card render — BullMQ wiring smoke", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const reportCards = new ReportCardService(new AggregationService(), { put: async () => "" } as never, {
    add: async () => undefined,
  } as never);
  let schoolId: string;
  let queue: Queue;

  beforeAll(() => {
    queue = new Queue(REPORT_CARDS_QUEUE, { connection: redisConnection() });
  });

  afterAll(async () => {
    await queue?.close();
    if (schoolId) await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  it("enqueued render job is consumed by the running API worker → pdfStatus GENERATED", async () => {
    // Seed a single built card via the real services + DB.
    const signed = await auth.signupOwner(
      {
        schoolName: "Smoke School",
        schoolSlug: `smoke-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `smoke-${runId}@example.test`,
        ownerPhone: `+23499${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolId = signed.school.id;
    const ownerId = signed.user.id;
    await basePrisma.school.update({ where: { id: schoolId }, data: { status: "ACTIVE", onboardingStep: 5 } });

    const { armId, termId, cardId } = await withTenant(schoolId, async (db) => {
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "Smoke A", code: `smk-${runId}` },
        select: { id: true },
      });
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      });
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
          isCurrent: true,
        },
        select: { id: true },
      });
      const subject = await db.subject.create({
        data: { schoolId, name: "Maths", code: `mth-${runId}` },
        select: { id: true },
      });
      const student = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-${runId}`,
          firstName: "Ada",
          lastName: "Okafor",
          dateOfBirth: new Date("2013-05-10"),
          gender: "FEMALE",
        },
        select: { id: true },
      });
      await db.enrollment.create({
        data: { schoolId, studentId: student.id, termId: term.id, academicYearId: year.id, classArmId: arm.id, status: "ENROLLED" },
      });
      await db.assessment.create({
        data: {
          schoolId,
          studentId: student.id,
          subjectId: subject.id,
          termId: term.id,
          academicYearId: year.id,
          classArmId: arm.id,
          totalScore: 72,
          computedAt: new Date(),
        },
      });
      return { armId: arm.id, termId: term.id, studentId: student.id };
    }).then(async (ids) => {
      await reportCards.build({ sessionId: "s", userId: ownerId, schoolId }, { termId: ids.termId, classArmId: ids.armId }, reqCtx);
      const card = await withTenant(schoolId, (db) =>
        db.reportCard.findFirstOrThrow({ where: { termId: ids.termId, classArmId: ids.armId }, select: { id: true } }),
      );
      return { ...ids, cardId: card.id };
    });

    // Enqueue exactly as ReportCardService.enqueueArmRender does — onto the
    // REAL queue the API worker is listening on.
    await queue.add(
      REPORT_CARDS_JOB_RENDER,
      { schoolId, userId: ownerId, reportCardId: cardId },
      { jobId: `render-${cardId}` },
    );

    // Poll the DB until the API worker flips the card to GENERATED.
    const deadline = Date.now() + 45_000;
    let status = "PENDING";
    let artifactUrl: string | null = null;
    while (Date.now() < deadline) {
      const card = await withTenant(schoolId, (db) =>
        db.reportCard.findUniqueOrThrow({ where: { id: cardId }, select: { pdfStatus: true, artifactUrl: true } }),
      );
      status = card.pdfStatus;
      artifactUrl = card.artifactUrl;
      if (status === "GENERATED" || status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(status).toBe("GENERATED");
    expect(artifactUrl).toBe(`schools/${schoolId}/report-cards/${termId}/${(await firstStudent(schoolId, armId, termId))}.pdf`);
  }, 60_000);
});

async function firstStudent(schoolId: string, classArmId: string, termId: string): Promise<string> {
  const card = await withTenant(schoolId, (db) =>
    db.reportCard.findFirstOrThrow({ where: { classArmId, termId }, select: { studentId: true } }),
  );
  return card.studentId;
}
