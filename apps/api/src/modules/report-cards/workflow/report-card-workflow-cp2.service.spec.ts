import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  reportCardArmReopenSchema,
} from "@school-kit/types";

import { REPORT_CARDS_QUEUE } from "../../../common/queue";
import { FilesystemStorageDriver } from "../../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../../common/storage/storage.service";
import { AssessmentService } from "../../assessment/assessment.service";
import { AggregationService } from "../../assessment/aggregation.service";
import { AuthService } from "../../auth/auth.service";
import { BrowserPool } from "../render/browser-pool";
import { RenderService } from "../render/render.service";
import { ReportCardService } from "../report-card.service";
import { ReportCardWorkflowService } from "./report-card-workflow.service";

// Phase 2 / Slice 6 cp2 — release + reopen + comment editing. Real DB + RLS, a
// REAL (isolated-name) BullMQ queue so release's in-tx enqueue is exercised, and
// a real Chromium + filesystem storage for the re-release render walk.

let c = 0;
function phone(): string {
  c += 1;
  return `+23494${(c % 100).toString().padStart(2, "0")}${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
}
const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}
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

describe("ReportCardWorkflowService (cp2 — release / reopen / comments)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const assessment = new AssessmentService();
  const schoolIds = new Set<string>();

  let storageRoot: string;
  let storage: StorageService;
  let pool: BrowserPool;
  let queue: Queue;
  let reportCards: ReportCardService;
  let workflow: ReportCardWorkflowService;
  let render: RenderService;

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "wf-cp2-"));
    storage = new StorageService(new FilesystemStorageDriver(storageRoot));
    pool = new BrowserPool();
    // Isolated queue NAME so a stray dev:api worker (on REPORT_CARDS_QUEUE) can't
    // steal release's jobs; we drive the render ourselves.
    queue = new Queue(`${REPORT_CARDS_QUEUE}-cp2-${runId}`, { connection: redisConnection() });
    await queue.obliterate({ force: true });
    reportCards = new ReportCardService(new AggregationService(), storage, queue);
    workflow = new ReportCardWorkflowService(reportCards);
    render = new RenderService(reportCards, storage, pool);
  });

  afterAll(async () => {
    await pool.onModuleDestroy();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
  });

  // ---- fixtures ----------------------------------------------------------

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `WF2 ${suffix}`,
        schoolSlug: `wf2-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `wf2-${suffix}-${runId}@example.test`,
        ownerPhone: phone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds.add(signed.school.id);
    await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
    return { schoolId: signed.school.id, ownerId: signed.user.id };
  }

  async function grantRole(schoolId: string, suffix: string, key: "teacher" | "admin"): Promise<string> {
    const role = await basePrisma.role.findFirstOrThrow({ where: { schoolId: null, key, isSystem: true }, select: { id: true } });
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: { schoolId, email: `${key}-${suffix}-${runId}@example.test`, firstName: "U", lastName: key },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
      return u.id;
    });
  }

  async function components(schoolId: string): Promise<{ ca1: string; ca2: string; exam: string }> {
    const rows = await withTenant(schoolId, (db) => db.gradingComponent.findMany({ where: { schoolId }, select: { id: true, key: true } }));
    const by = new Map(rows.map((r) => [r.key, r.id]));
    return { ca1: by.get("ca1")!, ca2: by.get("ca2")!, exam: by.get("exam")! };
  }

  async function makeArm(schoolId: string, suffix: string, classTeacherId?: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: `Arm ${suffix}`, code: `arm-${suffix}-${runId}`, classTeacherId: classTeacherId ?? null },
        select: { id: true },
      });
      return arm.id;
    });
  }

  async function makeSubject(schoolId: string, suffix: string): Promise<string> {
    return withTenant(schoolId, (db) =>
      db.subject.create({ data: { schoolId, name: `Subj ${suffix}`, code: `subj-${suffix}-${runId}` }, select: { id: true } }).then((s) => s.id),
    );
  }

  async function makeYearTerm(schoolId: string, suffix: string): Promise<{ yearId: string; termId: string }> {
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${suffix}-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15"), isCurrent: true },
        select: { id: true },
      });
      return { yearId: year.id, termId: term.id };
    });
  }

  async function enroll(schoolId: string, args: { armId: string; termId: string; yearId: string; suffix: string }): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const student = await db.student.create({
        data: { schoolId, admissionNumber: `ADM-${args.suffix}-${runId}`, firstName: "Stu", lastName: `P-${args.suffix}`, dateOfBirth: new Date("2013-05-10"), gender: "FEMALE" },
        select: { id: true },
      });
      await db.enrollment.create({ data: { schoolId, studentId: student.id, termId: args.termId, academicYearId: args.yearId, classArmId: args.armId, status: "ENROLLED" } });
      return student.id;
    });
  }

  async function enterColumn(schoolId: string, ownerId: string, args: { termId: string; subjectId: string; studentIds: string[]; comp: { ca1: string; ca2: string; exam: string } }): Promise<void> {
    const rows = args.studentIds.flatMap((studentId) => [
      { studentId, componentId: args.comp.ca1, score: 15 },
      { studentId, componentId: args.comp.ca2, score: 15 },
      { studentId, componentId: args.comp.exam, score: 50 },
    ]);
    await assessment.bulkUpsertScores(ctx(schoolId, ownerId), { termId: args.termId, subjectId: args.subjectId, rows }, reqCtx);
  }
  async function signColumn(schoolId: string, ownerId: string, args: { termId: string; classArmId: string; subjectId: string }): Promise<void> {
    await assessment.signOffColumn(ctx(schoolId, ownerId), args, reqCtx);
  }

  function cardStates(schoolId: string, termId: string, classArmId: string) {
    return withTenant(schoolId, (db) =>
      db.reportCard.findMany({
        where: { termId, classArmId },
        select: { id: true, status: true, pdfStatus: true, generatedAt: true, artifactUrl: true, formReviewedAt: true, principalApprovedAt: true, releasedAt: true, principalNote: true, formTeacherComment: true },
        orderBy: { studentId: "asc" },
      }),
    );
  }
  function auditCount(schoolId: string, action: string, entityId: string) {
    return withTenant(schoolId, (db) => db.auditLog.count({ where: { action, entityId } }));
  }

  // Built arm with 2 subjects scored + signed off → SUBJECT_REVIEWED; teacher is
  // the FORM teacher. (enter scores → build → sign off, so the cascade lands.)
  async function seedReviewedArm(suffix: string) {
    const { schoolId, ownerId } = await makeSchool(suffix);
    const teacherId = await grantRole(schoolId, suffix, "teacher");
    const armId = await makeArm(schoolId, suffix, teacherId);
    const comp = await components(schoolId);
    const s1 = await makeSubject(schoolId, `${suffix}1`);
    const s2 = await makeSubject(schoolId, `${suffix}2`);
    const { yearId, termId } = await makeYearTerm(schoolId, suffix);
    const a = await enroll(schoolId, { armId, termId, yearId, suffix: `${suffix}a` });
    const b = await enroll(schoolId, { armId, termId, yearId, suffix: `${suffix}b` });
    await enterColumn(schoolId, ownerId, { termId, subjectId: s1, studentIds: [a, b], comp });
    await enterColumn(schoolId, ownerId, { termId, subjectId: s2, studentIds: [a, b], comp });
    await reportCards.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    await signColumn(schoolId, ownerId, { termId, classArmId: armId, subjectId: s1 });
    await signColumn(schoolId, ownerId, { termId, classArmId: armId, subjectId: s2 });
    return { schoolId, ownerId, teacherId, armId, termId, yearId, subjectIds: [s1, s2], studentIds: [a, b], comp };
  }

  // Walk to PRINCIPAL_APPROVED.
  async function seedApprovedArm(suffix: string) {
    const f = await seedReviewedArm(suffix);
    await workflow.formReview(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    await workflow.approve(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    return f;
  }

  // ---- release -----------------------------------------------------------

  it("release: PRINCIPAL_APPROVED → RELEASED + pdfStatus PENDING + jobs enqueued + audit", async () => {
    const f = await seedApprovedArm("rel");
    const res = await workflow.release(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    expect(res).toEqual({ status: "RELEASED", cardCount: 2 });

    const cards = await cardStates(f.schoolId, f.termId, f.armId);
    expect(cards.every((c) => c.status === "RELEASED")).toBe(true);
    expect(cards.every((c) => c.pdfStatus === "PENDING")).toBe(true);
    expect(cards.every((c) => c.releasedAt !== null)).toBe(true);

    // Two distinct render jobs landed on the queue (no stable jobId).
    const jobs = await queue.getJobs(["wait", "waiting", "delayed", "prioritized"]);
    const forArm = jobs.filter((j) => cards.some((c) => c.id === j.data?.reportCardId));
    expect(forArm.length).toBe(2);
    expect(new Set(forArm.map((j) => String(j.id))).size).toBe(2);

    const audit = await withTenant(f.schoolId, (db) =>
      db.auditLog.findFirstOrThrow({ where: { action: "report-card.release", entityId: f.armId }, select: { metadata: true } }),
    );
    expect(audit.metadata).toMatchObject({ fromStatus: "PRINCIPAL_APPROVED", toStatus: "RELEASED", cardCount: 2, enqueuedCount: 2 });
    await queue.obliterate({ force: true });
  }, 90_000);

  it("release out-of-order: release on a FORM_REVIEWED arm → 409", async () => {
    const f = await seedReviewedArm("rel-oo");
    await workflow.formReview(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    await expect(workflow.release(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx)).rejects.toBeInstanceOf(ConflictError);
  }, 90_000);

  it("release is owner/admin only — a teacher is forbidden", async () => {
    const f = await seedApprovedArm("rel-gate");
    await expect(workflow.release(ctx(f.schoolId, f.teacherId), { termId: f.termId, classArmId: f.armId }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
  }, 90_000);

  it("release cross-tenant: school B cannot release school A's arm", async () => {
    const a = await seedApprovedArm("rel-ta");
    const b = await makeSchool("rel-tb");
    await expect(workflow.release(ctx(b.schoolId, b.ownerId), { termId: a.termId, classArmId: a.armId }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
  }, 90_000);

  // ---- reopen ------------------------------------------------------------

  it("reopen: RELEASED → DRAFT, workflow timestamps cleared, PDF artifact preserved, audit", async () => {
    const f = await seedApprovedArm("reo");
    await workflow.release(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    // Simulate a completed render so there's a PDF artifact to preserve.
    await withTenant(f.schoolId, (db) =>
      db.reportCard.updateMany({
        where: { termId: f.termId, classArmId: f.armId },
        data: { pdfStatus: "GENERATED", artifactUrl: "schools/x/report-cards/y/z.pdf", generatedAt: new Date() },
      }),
    );
    const before = await cardStates(f.schoolId, f.termId, f.armId);

    const res = await workflow.reopen(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId, reason: "Maths CA2 was wrong" }, reqCtx);
    expect(res).toEqual({ status: "DRAFT", cardCount: 2 });

    const after = await cardStates(f.schoolId, f.termId, f.armId);
    expect(after.every((c) => c.status === "DRAFT")).toBe(true);
    expect(after.every((c) => c.formReviewedAt === null && c.principalApprovedAt === null && c.releasedAt === null)).toBe(true);
    // PDF state preserved.
    expect(after.every((c) => c.pdfStatus === "GENERATED" && c.artifactUrl !== null && c.generatedAt !== null)).toBe(true);
    expect(after.map((c) => c.artifactUrl)).toEqual(before.map((c) => c.artifactUrl));

    const audit = await withTenant(f.schoolId, (db) =>
      db.auditLog.findFirstOrThrow({ where: { action: "report-card.reopen", entityId: f.armId }, select: { metadata: true } }),
    );
    expect(audit.metadata).toMatchObject({ toStatus: "DRAFT", reason: "Maths CA2 was wrong", cardCount: 2 });
    expect((audit.metadata as { fromStatuses: string[] }).fromStatuses).toContain("RELEASED");
  }, 90_000);

  it("reopen works from PRINCIPAL_APPROVED and FORM_REVIEWED too (target is DRAFT regardless)", async () => {
    const f1 = await seedApprovedArm("reo-pa");
    await workflow.reopen(ctx(f1.schoolId, f1.ownerId), { termId: f1.termId, classArmId: f1.armId, reason: "redo" }, reqCtx);
    expect((await cardStates(f1.schoolId, f1.termId, f1.armId)).every((c) => c.status === "DRAFT")).toBe(true);

    const f2 = await seedReviewedArm("reo-fr");
    await workflow.formReview(ctx(f2.schoolId, f2.ownerId), { termId: f2.termId, classArmId: f2.armId }, reqCtx);
    await workflow.reopen(ctx(f2.schoolId, f2.ownerId), { termId: f2.termId, classArmId: f2.armId, reason: "redo" }, reqCtx);
    expect((await cardStates(f2.schoolId, f2.termId, f2.armId)).every((c) => c.status === "DRAFT")).toBe(true);
  }, 90_000);

  it("reopen race guard: any card GENERATING → 409 ARM_RENDER_IN_FLIGHT", async () => {
    const f = await seedApprovedArm("reo-race");
    await workflow.release(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    await withTenant(f.schoolId, (db) =>
      db.reportCard.updateMany({ where: { termId: f.termId, classArmId: f.armId }, data: { pdfStatus: "GENERATING" } }),
    );
    await expect(
      workflow.reopen(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId, reason: "x" }, reqCtx),
    ).rejects.toMatchObject({ code: "ARM_RENDER_IN_FLIGHT" });
  }, 90_000);

  it("reopen is OWNER ONLY — admin is forbidden (admin excluded per spec); teacher too", async () => {
    const f = await seedApprovedArm("reo-gate");
    await workflow.release(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    const adminId = await grantRole(f.schoolId, "reo-gate-admin", "admin");
    await expect(workflow.reopen(ctx(f.schoolId, adminId), { termId: f.termId, classArmId: f.armId, reason: "x" }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(workflow.reopen(ctx(f.schoolId, f.teacherId), { termId: f.termId, classArmId: f.armId, reason: "x" }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
  }, 90_000);

  it("reopen reason is required (schema): empty/missing reason rejected", () => {
    expect(() => reportCardArmReopenSchema.parse({ termId: "t", classArmId: "a", reason: "" })).toThrow();
    expect(() => reportCardArmReopenSchema.parse({ termId: "t", classArmId: "a" })).toThrow();
    expect(reportCardArmReopenSchema.parse({ termId: "t", classArmId: "a", reason: "ok" })).toMatchObject({ reason: "ok" });
  });

  it("reopen cross-tenant: school B cannot reopen school A's arm", async () => {
    const a = await seedApprovedArm("reo-ta");
    await workflow.release(ctx(a.schoolId, a.ownerId), { termId: a.termId, classArmId: a.armId }, reqCtx);
    const b = await makeSchool("reo-tb");
    await expect(workflow.reopen(ctx(b.schoolId, b.ownerId), { termId: a.termId, classArmId: a.armId, reason: "x" }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
  }, 90_000);

  // ---- comments ----------------------------------------------------------

  it("formTeacherComment: editable in DRAFT and SUBJECT_REVIEWED; 409 once FORM_REVIEWED", async () => {
    // DRAFT (fresh build, not signed off yet)
    const { schoolId, ownerId } = await makeSchool("fc-draft");
    const armId = await makeArm(schoolId, "fc-draft");
    const comp = await components(schoolId);
    const subj = await makeSubject(schoolId, "fc1");
    const { yearId, termId } = await makeYearTerm(schoolId, "fc-draft");
    const stu = await enroll(schoolId, { armId, termId, yearId, suffix: "fcA" });
    await enterColumn(schoolId, ownerId, { termId, subjectId: subj, studentIds: [stu], comp });
    await reportCards.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    const card = (await cardStates(schoolId, termId, armId))[0];
    expect(card.status).toBe("DRAFT");

    const updated = await workflow.editFormTeacherComment(ctx(schoolId, ownerId), card.id, { formTeacherComment: "Strong term" }, reqCtx);
    expect(updated.formTeacherComment).toBe("Strong term");
    expect(await auditCount(schoolId, "report-card.comment", card.id)).toBe(1);

    // SUBJECT_REVIEWED
    const f = await seedReviewedArm("fc-sr");
    const cardSr = (await cardStates(f.schoolId, f.termId, f.armId))[0];
    expect(cardSr.status).toBe("SUBJECT_REVIEWED");
    await workflow.editFormTeacherComment(ctx(f.schoolId, f.ownerId), cardSr.id, { formTeacherComment: "ok" }, reqCtx);

    // FORM_REVIEWED → 409
    await workflow.formReview(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    await expect(
      workflow.editFormTeacherComment(ctx(f.schoolId, f.ownerId), cardSr.id, { formTeacherComment: "late" }, reqCtx),
    ).rejects.toMatchObject({ code: "COMMENT_NOT_EDITABLE" });
  }, 90_000);

  it("formTeacherComment on a RELEASED card → 409", async () => {
    const f = await seedApprovedArm("fc-rel");
    await workflow.release(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    const card = (await cardStates(f.schoolId, f.termId, f.armId))[0];
    await expect(
      workflow.editFormTeacherComment(ctx(f.schoolId, f.ownerId), card.id, { formTeacherComment: "no" }, reqCtx),
    ).rejects.toBeInstanceOf(ConflictError);
    await queue.obliterate({ force: true });
  }, 90_000);

  it("principalNote fan-out: FORM_REVIEWED arm → same note on every card; audit", async () => {
    const f = await seedReviewedArm("pn");
    await workflow.formReview(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    const res = await workflow.editPrincipalNote(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId, principalNote: "Well done, JSS2." }, reqCtx);
    expect(res).toEqual({ cardCount: 2 });
    const cards = await cardStates(f.schoolId, f.termId, f.armId);
    expect(cards.every((c) => c.principalNote === "Well done, JSS2.")).toBe(true);
    expect(await auditCount(f.schoolId, "report-card.comment", f.armId)).toBe(1);
  }, 90_000);

  it("principalNote outside FORM_REVIEWED → 409; a form teacher is forbidden", async () => {
    const f = await seedReviewedArm("pn-gate"); // SUBJECT_REVIEWED, not FORM_REVIEWED
    await expect(
      workflow.editPrincipalNote(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId, principalNote: "early" }, reqCtx),
    ).rejects.toMatchObject({ code: "COMMENT_NOT_EDITABLE" });
    await workflow.formReview(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    await expect(
      workflow.editPrincipalNote(ctx(f.schoolId, f.teacherId), { termId: f.termId, classArmId: f.armId, principalNote: "teacher" }, reqCtx),
    ).rejects.toBeInstanceOf(ForbiddenError);
  }, 90_000);

  it("a stranger teacher cannot edit another arm's formTeacherComment → 404", async () => {
    const f = await seedReviewedArm("fc-stranger");
    const stranger = await grantRole(f.schoolId, "fc-stranger-t", "teacher");
    const card = (await cardStates(f.schoolId, f.termId, f.armId))[0];
    await expect(
      workflow.editFormTeacherComment(ctx(f.schoolId, stranger), card.id, { formTeacherComment: "x" }, reqCtx),
    ).rejects.toBeInstanceOf(NotFoundError);
  }, 90_000);

  // ---- re-release after reopen ------------------------------------------

  it("re-release after reopen: walk back to RELEASED, render advances generatedAt, same R2 path", async () => {
    const f = await seedApprovedArm("rerelease");
    await workflow.release(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);

    // Simulate the worker by rendering the arm's cards directly (the queue-
    // enqueue itself is verified by the release happy-path test; rendering the
    // cards directly keeps this test independent of the shared queue's state).
    const renderArm = async () => {
      const cards = await cardStates(f.schoolId, f.termId, f.armId);
      for (const c of cards) {
        await render.renderCard({ schoolId: f.schoolId, userId: f.ownerId, reportCardId: c.id, attempt: 1 });
      }
      await queue.obliterate({ force: true });
      return cards.length;
    };
    expect(await renderArm()).toBe(2);
    const first = await cardStates(f.schoolId, f.termId, f.armId);
    expect(first.every((c) => c.pdfStatus === "GENERATED" && c.generatedAt !== null)).toBe(true);

    // Reopen → DRAFT (PDF preserved), then walk back and re-release.
    await workflow.reopen(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId, reason: "fix a score" }, reqCtx);
    await signColumn(f.schoolId, f.ownerId, { termId: f.termId, classArmId: f.armId, subjectId: f.subjectIds[0] });
    await signColumn(f.schoolId, f.ownerId, { termId: f.termId, classArmId: f.armId, subjectId: f.subjectIds[1] });
    await workflow.formReview(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    await workflow.approve(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    await workflow.release(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    expect(await renderArm()).toBe(2);

    const second = await cardStates(f.schoolId, f.termId, f.armId);
    expect(second.every((c) => c.pdfStatus === "GENERATED")).toBe(true);
    // Same deterministic path; generatedAt advanced.
    expect(second.map((c) => c.artifactUrl)).toEqual(first.map((c) => c.artifactUrl));
    for (let i = 0; i < second.length; i++) {
      expect(new Date(second[i].generatedAt!).getTime()).toBeGreaterThanOrEqual(new Date(first[i].generatedAt!).getTime());
    }
  }, 180_000);
});
