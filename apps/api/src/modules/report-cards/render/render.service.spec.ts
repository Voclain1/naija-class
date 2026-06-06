import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError } from "@school-kit/types";

import { REPORT_CARDS_QUEUE } from "../../../common/queue";
import { FilesystemStorageDriver } from "../../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../../common/storage/storage.service";
import { AggregationService } from "../../assessment/aggregation.service";
import { AuthService } from "../../auth/auth.service";
import { ReportCardService } from "../report-card.service";
import { BrowserPool } from "./browser-pool";
import { RenderService } from "./render.service";

// Redis connection for the one test that uses a REAL BullMQ queue (the
// jobId-dedup regression). Mirrors QueueModule's URL parsing.
function redisConnection() {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const p = new URL(url);
  return {
    host: p.hostname,
    port: p.port ? Number(p.port) : 6379,
    username: p.username || undefined,
    password: p.password || undefined,
    db: p.pathname && p.pathname.length > 1 ? Number(p.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

// Phase 2 / Slice 5 cp2 — render integration spec. Real DB + real RLS + real
// Chromium + a filesystem StorageService rooted in a temp dir. Proves:
//   - the render lifecycle (PENDING → GENERATING → GENERATED), artifact pointer,
//     audit row, and that a real PDF lands in storage (%PDF magic bytes);
//   - special/XSS characters in tenant data render without crashing;
//   - cross-tenant isolation (getRenderData under the wrong tenant sees nothing);
//   - the getPdfUrl gate (404 until GENERATED) and signed-URL issuance;
//   - enqueueArmRender gate + PENDING marking + enqueue count;
//   - the failure path (a render error leaves the card NOT GENERATED);
//   - idempotency (re-render overwrites the same deterministic path).
//
// Chromium is launched ONCE (pooled) for the whole file.

let counter = 0;
function randomPhone(): string {
  counter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23497${(counter % 100).toString().padStart(2, "0")}${random}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

const stubQueue = { add: async () => undefined } as unknown as import("bullmq").Queue;

describe("RenderService (cp2 — PDF render)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const authService = new AuthService();
  const schoolIdsToCleanup = new Set<string>();

  let storageRoot: string;
  let storage: StorageService;
  let pool: BrowserPool;
  let reportCards: ReportCardService;
  let render: RenderService;

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "rc-render-"));
    storage = new StorageService(new FilesystemStorageDriver(storageRoot));
    pool = new BrowserPool();
    reportCards = new ReportCardService(new AggregationService(), storage, stubQueue);
    render = new RenderService(reportCards, storage, pool);
  });

  afterAll(async () => {
    await pool.onModuleDestroy();
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
  });

  // ---- fixtures ----------------------------------------------------------

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await authService.signupOwner(
      {
        schoolName: `RC ${suffix}`,
        schoolSlug: `rcr-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `rcr-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIdsToCleanup.add(signed.school.id);
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
    return { schoolId: signed.school.id, ownerId: signed.user.id };
  }

  async function grantTeacher(schoolId: string, suffix: string): Promise<string> {
    const role = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key: "teacher", isSystem: true },
      select: { id: true },
    });
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: { schoolId, email: `t-${suffix}-${runId}@example.test`, firstName: "T", lastName: "Teach" },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
      return u.id;
    });
  }

  async function makeArm(schoolId: string, suffix: string, classTeacherId?: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({
        data: {
          schoolId,
          classLevelId: level.id,
          name: `Arm ${suffix}`,
          code: `arm-${suffix}-${runId}`,
          classTeacherId: classTeacherId ?? null,
        },
        select: { id: true },
      });
      return arm.id;
    });
  }

  async function makeSubject(schoolId: string, suffix: string): Promise<string> {
    return withTenant(schoolId, (db) =>
      db.subject
        .create({ data: { schoolId, name: `Subj ${suffix}`, code: `subj-${suffix}-${runId}` }, select: { id: true } })
        .then((s) => s.id),
    );
  }

  async function makeYearTerm(schoolId: string, suffix: string): Promise<{ yearId: string; termId: string }> {
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${suffix}-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
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
      return { yearId: year.id, termId: term.id };
    });
  }

  async function enrollStudent(
    schoolId: string,
    args: { armId: string; termId: string; yearId: string; suffix: string; firstName?: string; lastName?: string },
  ): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const student = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-${args.suffix}-${runId}`,
          firstName: args.firstName ?? "Stu",
          lastName: args.lastName ?? `Pupil-${args.suffix}`,
          dateOfBirth: new Date("2013-05-10"),
          gender: "FEMALE",
        },
        select: { id: true },
      });
      await db.enrollment.create({
        data: {
          schoolId,
          studentId: student.id,
          termId: args.termId,
          academicYearId: args.yearId,
          classArmId: args.armId,
          status: "ENROLLED",
        },
      });
      return student.id;
    });
  }

  async function score(
    schoolId: string,
    args: { studentId: string; subjectId: string; termId: string; yearId: string; armId: string; total: number },
  ): Promise<void> {
    await withTenant(schoolId, (db) =>
      db.assessment.create({
        data: {
          schoolId,
          studentId: args.studentId,
          subjectId: args.subjectId,
          termId: args.termId,
          academicYearId: args.yearId,
          classArmId: args.armId,
          totalScore: args.total,
          computedAt: new Date(),
        },
      }),
    );
  }

  // Build one card for one student in a fresh arm; returns the ids needed to render.
  async function seedOneCard(suffix: string, opts: { firstName?: string; lastName?: string; classTeacherId?: string } = {}) {
    const { schoolId, ownerId } = await makeSchool(suffix);
    const teacherId = opts.classTeacherId ? await grantTeacher(schoolId, suffix) : undefined;
    const armId = await makeArm(schoolId, suffix, teacherId);
    const subjectId = await makeSubject(schoolId, suffix);
    const { yearId, termId } = await makeYearTerm(schoolId, suffix);
    const studentId = await enrollStudent(schoolId, { armId, termId, yearId, suffix, ...opts });
    await score(schoolId, { studentId, subjectId, termId, yearId, armId, total: 78 });
    await reportCards.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    const card = await withTenant(schoolId, (db) =>
      db.reportCard.findUniqueOrThrow({
        where: { schoolId_studentId_termId: { schoolId, studentId, termId } },
        select: { id: true },
      }),
    );
    return { schoolId, ownerId, teacherId, armId, termId, studentId, cardId: card.id };
  }

  async function cardState(schoolId: string, cardId: string) {
    return withTenant(schoolId, (db) =>
      db.reportCard.findUniqueOrThrow({
        where: { id: cardId },
        select: { pdfStatus: true, artifactUrl: true, generatedAt: true },
      }),
    );
  }

  // ---- tests -------------------------------------------------------------

  it("renders a card to a real PDF and marks it GENERATED with an artifact pointer", async () => {
    const f = await seedOneCard("happy");
    await render.renderCard({ schoolId: f.schoolId, userId: f.ownerId, reportCardId: f.cardId, attempt: 1 });

    const after = await cardState(f.schoolId, f.cardId);
    expect(after.pdfStatus).toBe("GENERATED");
    expect(after.artifactUrl).toBe(`schools/${f.schoolId}/report-cards/${f.termId}/${f.studentId}.pdf`);
    expect(after.generatedAt).not.toBeNull();

    const bytes = await readFile(join(storageRoot, after.artifactUrl!));
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  }, 60_000);

  it("writes an audit row per render attempt", async () => {
    const f = await seedOneCard("audit");
    await render.renderCard({ schoolId: f.schoolId, userId: f.ownerId, reportCardId: f.cardId, attempt: 2 });
    const audit = await withTenant(f.schoolId, (db) =>
      db.auditLog.findFirstOrThrow({
        where: { action: "report-card.render", entityId: f.cardId },
        select: { metadata: true, userId: true },
      }),
    );
    expect(audit.userId).toBe(f.ownerId);
    expect(audit.metadata).toMatchObject({ reportCardId: f.cardId, pdfStatus: "GENERATED", attempt: 2 });
  }, 60_000);

  it("renders tenant data containing XSS/special characters without crashing", async () => {
    const f = await seedOneCard("xss", { firstName: "<script>alert('x')</script>", lastName: "O'Brien & <b>Co</b>" });
    await render.renderCard({ schoolId: f.schoolId, userId: f.ownerId, reportCardId: f.cardId, attempt: 1 });
    expect((await cardState(f.schoolId, f.cardId)).pdfStatus).toBe("GENERATED");
  }, 60_000);

  it("is idempotent — re-render overwrites the same deterministic path, stays GENERATED", async () => {
    const f = await seedOneCard("idem");
    for (const attempt of [1, 2]) {
      await render.renderCard({ schoolId: f.schoolId, userId: f.ownerId, reportCardId: f.cardId, attempt });
    }
    const after = await cardState(f.schoolId, f.cardId);
    expect(after.pdfStatus).toBe("GENERATED");
    expect(after.artifactUrl).toBe(`schools/${f.schoolId}/report-cards/${f.termId}/${f.studentId}.pdf`);
  }, 90_000);

  it("getRenderData under the WRONG tenant sees nothing (RLS isolation)", async () => {
    const a = await seedOneCard("iso-a");
    const b = await seedOneCard("iso-b");
    // School B's tenant context cannot resolve School A's card.
    const leaked = await withTenant(b.schoolId, (db) => reportCards.getRenderData(db, a.cardId));
    expect(leaked).toBeNull();
  }, 60_000);

  it("a render failure leaves the card NOT GENERATED (FAILED is the worker's job on exhaustion)", async () => {
    const f = await seedOneCard("fail");
    const boomPool = {
      withPage: async () => {
        throw new Error("boom: simulated renderer crash");
      },
    } as unknown as BrowserPool;
    const failing = new RenderService(reportCards, storage, boomPool);

    await expect(
      failing.renderCard({ schoolId: f.schoolId, userId: f.ownerId, reportCardId: f.cardId, attempt: 1 }),
    ).rejects.toThrow(/boom/);

    // Phase 1 committed GENERATING; the Chromium phase threw before GENERATED.
    // The point: it is NOT GENERATED. FAILED is written by the processor's
    // onFailed listener once BullMQ exhausts retries.
    expect((await cardState(f.schoolId, f.cardId)).pdfStatus).toBe("GENERATING");
  }, 60_000);

  it("RECOVERS on retry: attempt 1 fails mid-render (GENERATING leftover), attempt 2 → GENERATED", async () => {
    // The load-bearing operational property of the short-tx pattern: because
    // renderCard owns DISCONTINUOUS transactions, a mid-render failure leaves
    // pdfStatus = GENERATING (committed by phase-1 tx). A naive `status ===
    // PENDING` guard would then permanently fail every retry. renderCard has NO
    // such guard — phase 1 re-sets GENERATING idempotently regardless of the
    // starting status — so the BullMQ retry recovers a transient Chromium hiccup
    // without manual intervention.
    const f = await seedOneCard("retry");
    const boomPool = {
      withPage: async () => {
        throw new Error("boom: transient Chromium hiccup");
      },
    } as unknown as BrowserPool;
    const failing = new RenderService(reportCards, storage, boomPool);

    // Attempt 1 fails during the no-tx render step → leftover GENERATING.
    await expect(
      failing.renderCard({ schoolId: f.schoolId, userId: f.ownerId, reportCardId: f.cardId, attempt: 1 }),
    ).rejects.toThrow(/boom/);
    expect((await cardState(f.schoolId, f.cardId)).pdfStatus).toBe("GENERATING");

    // Attempt 2 with the real browser pool — must recover FROM the GENERATING
    // leftover (not require PENDING) and complete.
    await render.renderCard({ schoolId: f.schoolId, userId: f.ownerId, reportCardId: f.cardId, attempt: 2 });
    const after = await cardState(f.schoolId, f.cardId);
    expect(after.pdfStatus).toBe("GENERATED");
    expect(after.artifactUrl).toBe(`schools/${f.schoolId}/report-cards/${f.termId}/${f.studentId}.pdf`);
  }, 60_000);

  // ---- enqueue + signed URL (no Chromium) --------------------------------

  it("enqueueArmRender marks every card PENDING and reports the count (owner only)", async () => {
    const { schoolId, ownerId } = await makeSchool("enq");
    const armId = await makeArm(schoolId, "enq");
    const subjectId = await makeSubject(schoolId, "enq");
    const { yearId, termId } = await makeYearTerm(schoolId, "enq");
    const s1 = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "e1" });
    const s2 = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "e2" });
    for (const s of [s1, s2]) await score(schoolId, { studentId: s, subjectId, termId, yearId, armId, total: 60 });
    await reportCards.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);

    const result = await reportCards.enqueueArmRender(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    expect(result).toEqual({ enqueuedCount: 2 });

    const statuses = await withTenant(schoolId, (db) =>
      db.reportCard.findMany({ where: { termId, classArmId: armId }, select: { pdfStatus: true } }),
    );
    expect(statuses.every((c) => c.pdfStatus === "PENDING")).toBe(true);
  }, 60_000);

  it("enqueueArmRender with reportCardId narrows to a SINGLE card (cp3 Regenerate)", async () => {
    const { schoolId, ownerId } = await makeSchool("enq1");
    const armId = await makeArm(schoolId, "enq1");
    const subjectId = await makeSubject(schoolId, "enq1");
    const { yearId, termId } = await makeYearTerm(schoolId, "enq1");
    const s1 = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "o1" });
    const s2 = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "o2" });
    for (const s of [s1, s2]) await score(schoolId, { studentId: s, subjectId, termId, yearId, armId, total: 55 });
    await reportCards.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);

    const target = await withTenant(schoolId, (db) =>
      db.reportCard.findFirstOrThrow({ where: { termId, classArmId: armId, studentId: s1 }, select: { id: true } }),
    );

    const result = await reportCards.enqueueArmRender(
      ctx(schoolId, ownerId),
      { termId, classArmId: armId, reportCardId: target.id },
      reqCtx,
    );
    expect(result).toEqual({ enqueuedCount: 1 });

    // ONLY the target card flipped to PENDING from DRAFT-build's PENDING... both
    // are PENDING after build, so prove the enqueue touched only one by checking
    // the OTHER card was never updated (its updatedAt is unchanged). Simpler:
    // assert exactly one render-batch audit row names this reportCardId.
    const audit = await withTenant(schoolId, (db) =>
      db.auditLog.findFirstOrThrow({
        where: { action: "report-card.render-batch", entityId: armId },
        select: { metadata: true },
      }),
    );
    expect(audit.metadata).toMatchObject({ reportCardId: target.id, enqueuedCount: 1 });

    // A reportCardId from a DIFFERENT arm matches nothing (cross-arm guard).
    const otherArmId = await makeArm(schoolId, "enq1-other");
    const cross = await reportCards.enqueueArmRender(
      ctx(schoolId, ownerId),
      { termId, classArmId: otherArmId, reportCardId: target.id },
      reqCtx,
    );
    expect(cross).toEqual({ enqueuedCount: 0 });
  }, 60_000);

  it("enqueueArmRender is owner/admin only — a teacher is forbidden", async () => {
    const f = await seedOneCard("enq-teacher", { classTeacherId: "x", firstName: "Z" });
    await expect(
      reportCards.enqueueArmRender(ctx(f.schoolId, f.teacherId!), { termId: f.termId, classArmId: f.armId }, reqCtx),
    ).rejects.toBeInstanceOf(ForbiddenError);
  }, 60_000);

  it("getPdfUrl 404s until GENERATED, then issues a signed URL", async () => {
    const f = await seedOneCard("pdfurl");
    // Card is PENDING after build → not ready.
    await expect(reportCards.getPdfUrl(ctx(f.schoolId, f.ownerId), f.cardId)).rejects.toBeInstanceOf(NotFoundError);

    await render.renderCard({ schoolId: f.schoolId, userId: f.ownerId, reportCardId: f.cardId, attempt: 1 });
    const url = await reportCards.getPdfUrl(ctx(f.schoolId, f.ownerId), f.cardId);
    expect(url.signedUrl).toContain(`report-cards/${f.termId}/${f.studentId}.pdf`);
    expect(url.expiresAt).toBeInstanceOf(Date);
  }, 60_000);

  // ---- jobId-dedup regression (the cp3 PENDING-forever bug) ---------------

  it("re-render is NOT deduped — two enqueues of the same card create two distinct jobs", async () => {
    // THE regression test for the cp3 blocker. enqueueArmRender used a stable
    // `render-${cardId}` jobId; combined with completed-job retention, BullMQ
    // silently dropped every re-enqueue (Regenerate / Render-all) as a duplicate
    // → cards stuck at PENDING. The fix drops the jobId so each request is a
    // fresh job.
    //
    // We use a REAL BullMQ queue (the stub used elsewhere can't exhibit dedup)
    // wrapped to capture the job id each add() returns. With a stable jobId a
    // duplicate add returns the SAME existing job id → the captured set collapses
    // to 1; the fix yields 2 distinct ids. Then we render both jobs through the
    // real renderCard (the worker's body) to prove the second actually re-runs.
    //
    // Throwaway queue NAME (not REPORT_CARDS_QUEUE): a real worker — e.g. a
    // `dev:api` on the same Redis — would otherwise consume these jobs and add
    // its own renders, making the audit-count assertion flaky. We simulate the
    // worker ourselves, so isolation is all we need from the queue.
    const queueName = `${REPORT_CARDS_QUEUE}-test-${runId}`;
    const realQueue = new Queue(queueName, { connection: redisConnection() });
    await realQueue.obliterate({ force: true });

    const adds: { reportCardId: string; jobId: string; passedJobId: unknown }[] = [];
    const captureQueue = {
      add: async (name: string, data: { reportCardId: string }, opts?: { jobId?: string }) => {
        const job = await realQueue.add(name, data, opts);
        adds.push({ reportCardId: data.reportCardId, jobId: String(job.id), passedJobId: opts?.jobId });
        return job;
      },
    } as unknown as Queue;
    const svc = new ReportCardService(new AggregationService(), storage, captureQueue);

    try {
      const f = await seedOneCard("redo");

      // Render-all, then a Regenerate on the SAME card — back to back, no flush.
      for (let i = 0; i < 2; i++) {
        await svc.enqueueArmRender(
          ctx(f.schoolId, f.ownerId),
          { termId: f.termId, classArmId: f.armId, reportCardId: f.cardId },
          reqCtx,
        );
      }

      // Both enqueues hit add() and produced DISTINCT job ids (no dedup), and
      // neither passed a stable jobId (the root cause).
      expect(adds.length).toBe(2);
      expect(new Set(adds.map((a) => a.jobId)).size).toBe(2);
      expect(adds.every((a) => a.passedJobId === undefined)).toBe(true);

      // Drain both jobs through the real renderCard (worker body) → the card
      // re-renders. Two render audit rows prove two real renders, not one deduped.
      for (const a of adds) {
        await render.renderCard({ schoolId: f.schoolId, userId: f.ownerId, reportCardId: a.reportCardId, attempt: 1 });
      }

      const after = await cardState(f.schoolId, f.cardId);
      expect(after.pdfStatus).toBe("GENERATED");
      expect(after.artifactUrl).toBe(`schools/${f.schoolId}/report-cards/${f.termId}/${f.studentId}.pdf`);

      const renderAudits = await withTenant(f.schoolId, (db) =>
        db.auditLog.count({ where: { action: "report-card.render", entityId: f.cardId } }),
      );
      expect(renderAudits).toBe(2);
    } finally {
      await realQueue.obliterate({ force: true }).catch(() => undefined);
      await realQueue.close();
    }
  }, 60_000);
});
