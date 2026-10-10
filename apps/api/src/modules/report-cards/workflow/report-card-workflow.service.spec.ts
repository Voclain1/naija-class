import type { Queue } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@school-kit/types";

import type { StorageService } from "../../../common/storage";
import { AssessmentService } from "../../assessment/assessment.service";
import { AggregationService } from "../../assessment/aggregation.service";
import { AuthService } from "../../auth/auth.service";
import { ReportCardService } from "../report-card.service";
import { ReportCardWorkflowService } from "./report-card-workflow.service";

// Phase 2 / Slice 6 cp1 — approval-workflow integration spec. Real DB + RLS.
// Drives the real score-entry + sign-off path so the SUBJECT_REVIEWED cascade
// fires for real, then walks form-review → approve. Also proves the
// released-card immutability gate, the non-DRAFT rebuild guard, out-of-order
// 409s, the form-teacher gate, and cross-tenant denial.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23495${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

const stubStorage = { put: async () => "stub", signUrl: async () => "file:///stub" } as unknown as StorageService;
const stubQueue = { add: async () => undefined } as unknown as Queue;

describe("ReportCardWorkflowService (cp1 — state machine + gates)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const assessment = new AssessmentService();
  const reportCards = new ReportCardService(new AggregationService(), stubStorage, stubQueue);
  const workflow = new ReportCardWorkflowService(reportCards);
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  // ---- fixtures ----------------------------------------------------------

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `WF ${suffix}`,
        schoolSlug: `wf-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `wf-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds.add(signed.school.id);
    await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
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

  async function components(schoolId: string): Promise<{ ca1: string; ca2: string; exam: string }> {
    const rows = await withTenant(schoolId, (db) =>
      db.gradingComponent.findMany({ where: { schoolId }, select: { id: true, key: true } }),
    );
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
      // A later term in the same year, so the term above is a FIRST term, not the
      // final one — the final term needs a promotion status to approve (CP6a, D53).
      await db.term.create({ data: { schoolId, academicYearId: year.id, sequence: 2, name: "Second Term", startDate: new Date("2026-01-05"), endDate: new Date("2026-04-10") } });
      return { yearId: year.id, termId: term.id };
    });
  }

  async function enroll(schoolId: string, args: { armId: string; termId: string; yearId: string; suffix: string }): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const student = await db.student.create({
        data: { schoolId, admissionNumber: `ADM-${args.suffix}-${runId}`, firstName: "Stu", lastName: `P-${args.suffix}`, dateOfBirth: new Date("2013-05-10"), gender: "FEMALE" },
        select: { id: true },
      });
      await db.enrollment.create({
        data: { schoolId, studentId: student.id, termId: args.termId, academicYearId: args.yearId, classArmId: args.armId, status: "ENROLLED" },
      });
      return student.id;
    });
  }

  // Enter a full column (all components) for every student — creates the
  // Assessment rows (+ scores) the real gradebook would. Sign-off + the cascade
  // happen separately (signColumn), AFTER build, so the cascade lands on cards
  // that exist (the real order: enter → build → sign off).
  async function enterColumn(
    schoolId: string,
    ownerId: string,
    args: { termId: string; subjectId: string; studentIds: string[]; comp: { ca1: string; ca2: string; exam: string } },
  ): Promise<void> {
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

  function statuses(schoolId: string, termId: string, classArmId: string) {
    return withTenant(schoolId, (db) =>
      db.reportCard.findMany({ where: { termId, classArmId }, select: { status: true } }).then((cs) => cs.map((c) => c.status)),
    );
  }
  function auditCount(schoolId: string, action: string, entityId: string) {
    return withTenant(schoolId, (db) => db.auditLog.count({ where: { action, entityId } }));
  }

  // A built arm with two subjects scored + signed off (→ SUBJECT_REVIEWED), and
  // a form teacher set. Returns the ids needed to drive the workflow.
  async function seedReviewedArm(suffix: string) {
    const { schoolId, ownerId } = await makeSchool(suffix);
    const teacherId = await grantTeacher(schoolId, suffix);
    const armId = await makeArm(schoolId, suffix, teacherId); // teacher is the FORM teacher
    const comp = await components(schoolId);
    const s1 = await makeSubject(schoolId, `${suffix}1`);
    const s2 = await makeSubject(schoolId, `${suffix}2`);
    const { yearId, termId } = await makeYearTerm(schoolId, suffix);
    const a = await enroll(schoolId, { armId, termId, yearId, suffix: `${suffix}a` });
    const b = await enroll(schoolId, { armId, termId, yearId, suffix: `${suffix}b` });
    // enter scores → build (DRAFT cards) → sign off (cascade → SUBJECT_REVIEWED).
    await enterColumn(schoolId, ownerId, { termId, subjectId: s1, studentIds: [a, b], comp });
    await enterColumn(schoolId, ownerId, { termId, subjectId: s2, studentIds: [a, b], comp });
    await reportCards.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    await signColumn(schoolId, ownerId, { termId, classArmId: armId, subjectId: s1 });
    await signColumn(schoolId, ownerId, { termId, classArmId: armId, subjectId: s2 });
    return { schoolId, ownerId, teacherId, armId, termId, yearId, subjectIds: [s1, s2], studentIds: [a, b], comp };
  }

  // ---- tests -------------------------------------------------------------

  it("eager cascade: arm reaches SUBJECT_REVIEWED only after the LAST subject is signed off", async () => {
    const { schoolId, ownerId } = await makeSchool("cascade");
    const armId = await makeArm(schoolId, "cascade");
    const comp = await components(schoolId);
    const s1 = await makeSubject(schoolId, "c1");
    const s2 = await makeSubject(schoolId, "c2");
    const { yearId, termId } = await makeYearTerm(schoolId, "cascade");
    const a = await enroll(schoolId, { armId, termId, yearId, suffix: "ca" });
    await enterColumn(schoolId, ownerId, { termId, subjectId: s1, studentIds: [a], comp });
    await enterColumn(schoolId, ownerId, { termId, subjectId: s2, studentIds: [a], comp });
    await reportCards.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    expect(await statuses(schoolId, termId, armId)).toEqual(["DRAFT"]);

    await signColumn(schoolId, ownerId, { termId, classArmId: armId, subjectId: s1 });
    expect(await statuses(schoolId, termId, armId)).toEqual(["DRAFT"]); // subject 2 still unsigned

    await signColumn(schoolId, ownerId, { termId, classArmId: armId, subjectId: s2 });
    expect(await statuses(schoolId, termId, armId)).toEqual(["SUBJECT_REVIEWED"]);
  }, 60_000);

  // The opposite order (2026-10-10): every subject signed off, THEN cards
  // built. The cascade had already run with no cards to move, so the cards
  // were built DRAFT and the board asked for sign-offs that were done.
  it("build after the last sign-off: cards are built SUBJECT_REVIEWED", async () => {
    const { schoolId, ownerId } = await makeSchool("signfirst");
    const armId = await makeArm(schoolId, "signfirst");
    const comp = await components(schoolId);
    const s1 = await makeSubject(schoolId, "sf1");
    const s2 = await makeSubject(schoolId, "sf2");
    const { yearId, termId } = await makeYearTerm(schoolId, "signfirst");
    const a = await enroll(schoolId, { armId, termId, yearId, suffix: "sfa" });
    const b = await enroll(schoolId, { armId, termId, yearId, suffix: "sfb" });
    await enterColumn(schoolId, ownerId, { termId, subjectId: s1, studentIds: [a, b], comp });
    await enterColumn(schoolId, ownerId, { termId, subjectId: s2, studentIds: [a, b], comp });
    await signColumn(schoolId, ownerId, { termId, classArmId: armId, subjectId: s1 });
    await signColumn(schoolId, ownerId, { termId, classArmId: armId, subjectId: s2 });

    await reportCards.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    expect(await statuses(schoolId, termId, armId)).toEqual(["SUBJECT_REVIEWED", "SUBJECT_REVIEWED"]);
    const fr = await workflow.formReview(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    expect(fr.status).toBe("FORM_REVIEWED");
  }, 60_000);

  it("build with a subject still unsigned: cards stay DRAFT", async () => {
    const { schoolId, ownerId } = await makeSchool("halfsigned");
    const armId = await makeArm(schoolId, "halfsigned");
    const comp = await components(schoolId);
    const s1 = await makeSubject(schoolId, "hs1");
    const s2 = await makeSubject(schoolId, "hs2");
    const { yearId, termId } = await makeYearTerm(schoolId, "halfsigned");
    const a = await enroll(schoolId, { armId, termId, yearId, suffix: "hsa" });
    await enterColumn(schoolId, ownerId, { termId, subjectId: s1, studentIds: [a], comp });
    await enterColumn(schoolId, ownerId, { termId, subjectId: s2, studentIds: [a], comp });
    await signColumn(schoolId, ownerId, { termId, classArmId: armId, subjectId: s1 });

    await reportCards.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    expect(await statuses(schoolId, termId, armId)).toEqual(["DRAFT"]);
  }, 60_000);

  it("full walk: SUBJECT_REVIEWED → form-review → FORM_REVIEWED → approve → PRINCIPAL_APPROVED (+ audit rows)", async () => {
    const f = await seedReviewedArm("walk");
    expect(new Set(await statuses(f.schoolId, f.termId, f.armId))).toEqual(new Set(["SUBJECT_REVIEWED"]));

    const fr = await workflow.formReview(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    expect(fr).toEqual({ status: "FORM_REVIEWED", cardCount: 2 });
    expect(new Set(await statuses(f.schoolId, f.termId, f.armId))).toEqual(new Set(["FORM_REVIEWED"]));

    const ap = await workflow.approve(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    expect(ap).toEqual({ status: "PRINCIPAL_APPROVED", cardCount: 2 });
    expect(new Set(await statuses(f.schoolId, f.termId, f.armId))).toEqual(new Set(["PRINCIPAL_APPROVED"]));

    expect(await auditCount(f.schoolId, "report-card.form-review", f.armId)).toBe(1);
    expect(await auditCount(f.schoolId, "report-card.principal-approve", f.armId)).toBe(1);
  }, 60_000);

  it("the arm's FORM teacher may form-review; a stranger teacher gets 404; owner may too", async () => {
    const f = await seedReviewedArm("ft");
    const stranger = await grantTeacher(f.schoolId, "ft-stranger");
    await expect(
      workflow.formReview(ctx(f.schoolId, stranger), { termId: f.termId, classArmId: f.armId }, reqCtx),
    ).rejects.toBeInstanceOf(NotFoundError);
    // The real form teacher succeeds.
    const fr = await workflow.formReview(ctx(f.schoolId, f.teacherId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    expect(fr.status).toBe("FORM_REVIEWED");
  }, 60_000);

  it("approve is owner/admin only — a teacher (even the form teacher) is forbidden", async () => {
    const f = await seedReviewedArm("appr");
    await workflow.formReview(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    await expect(
      workflow.approve(ctx(f.schoolId, f.teacherId), { termId: f.termId, classArmId: f.armId }, reqCtx),
    ).rejects.toBeInstanceOf(ForbiddenError);
  }, 60_000);

  it("out-of-order transitions 409: approve on SUBJECT_REVIEWED; form-review on FORM_REVIEWED", async () => {
    const f = await seedReviewedArm("order");
    await expect(
      workflow.approve(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx),
    ).rejects.toBeInstanceOf(ConflictError); // still SUBJECT_REVIEWED

    await workflow.formReview(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    await expect(
      workflow.formReview(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx),
    ).rejects.toBeInstanceOf(ConflictError); // already FORM_REVIEWED
  }, 60_000);

  it("no auto-revert: un-signing a subject leaves cards SUBJECT_REVIEWED, but form-review then 409s", async () => {
    const f = await seedReviewedArm("revert");
    // Un-sign one subject directly (simulating a subject teacher un-signing off).
    await withTenant(f.schoolId, (db) =>
      db.assessment.updateMany({
        where: { termId: f.termId, classArmId: f.armId, subjectId: f.subjectIds[0] },
        data: { subjectSignedOffAt: null, subjectSignedOffBy: null },
      }),
    );
    // No auto-revert — cards are still SUBJECT_REVIEWED.
    expect(new Set(await statuses(f.schoolId, f.termId, f.armId))).toEqual(new Set(["SUBJECT_REVIEWED"]));
    // But form-review re-verifies and rejects.
    await expect(
      workflow.formReview(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx),
    ).rejects.toMatchObject({ code: "SUBJECTS_NOT_SIGNED_OFF" });
  }, 60_000);

  it("released-card immutability (RELEASED-only): score/signoff/rebuild all 409", async () => {
    const f = await seedReviewedArm("immut");
    // Force the arm to RELEASED (slice-6 release lands in cp2; set directly here).
    await withTenant(f.schoolId, (db) =>
      db.reportCard.updateMany({ where: { termId: f.termId, classArmId: f.armId }, data: { status: "RELEASED" } }),
    );
    const studentId = f.studentIds[0];

    await expect(
      assessment.createScore(ctx(f.schoolId, f.ownerId), { studentId, subjectId: f.subjectIds[0], termId: f.termId, componentId: f.comp.ca1, score: 10 }, reqCtx),
    ).rejects.toMatchObject({ code: "REPORT_CARD_RELEASED" });

    await expect(
      assessment.bulkUpsertScores(ctx(f.schoolId, f.ownerId), { termId: f.termId, subjectId: f.subjectIds[0], rows: [{ studentId, componentId: f.comp.ca1, score: 10 }] }, reqCtx),
    ).rejects.toMatchObject({ code: "REPORT_CARD_RELEASED" });

    await expect(
      assessment.signOffColumn(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId, subjectId: f.subjectIds[0] }, reqCtx),
    ).rejects.toMatchObject({ code: "REPORT_CARD_RELEASED" });

    // Rebuild of a non-DRAFT (here RELEASED) arm → ARM_NOT_DRAFT.
    await expect(
      reportCards.build(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx),
    ).rejects.toMatchObject({ code: "ARM_NOT_DRAFT" });
  }, 60_000);

  it("non-DRAFT rebuild guard: build on a SUBJECT_REVIEWED arm → 409 (ARM_NOT_DRAFT)", async () => {
    const f = await seedReviewedArm("rebuild");
    await expect(
      reportCards.build(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx),
    ).rejects.toMatchObject({ code: "ARM_NOT_DRAFT" });
  }, 60_000);

  it("cross-tenant denial: school B cannot form-review or approve school A's arm", async () => {
    const a = await seedReviewedArm("tenant-a");
    const b = await makeSchool("tenant-b");
    await expect(
      workflow.formReview(ctx(b.schoolId, b.ownerId), { termId: a.termId, classArmId: a.armId }, reqCtx),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      workflow.approve(ctx(b.schoolId, b.ownerId), { termId: a.termId, classArmId: a.armId }, reqCtx),
    ).rejects.toBeInstanceOf(NotFoundError);
  }, 60_000);

  it("form-review on an arm with no cards built → 409 (NO_REPORT_CARDS)", async () => {
    const { schoolId, ownerId } = await makeSchool("empty");
    const armId = await makeArm(schoolId, "empty");
    const { termId } = await makeYearTerm(schoolId, "empty");
    await expect(
      workflow.formReview(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx),
    ).rejects.toMatchObject({ code: "NO_REPORT_CARDS" });
  }, 60_000);
  // ---- Phase 8 / CP6a — promotion status (§20.3, D52/D53) -----------------

  // The seeded year has a first and a second term. Removing the (empty) second
  // term makes the first the FINAL term — "final" is derived from the year's
  // terms, never stored, so this is exactly what a school would see.
  async function seedFinalTermArm(suffix: string) {
    const f = await seedReviewedArm(suffix);
    await withTenant(f.schoolId, (db) => db.term.deleteMany({ where: { academicYearId: f.yearId, sequence: { gt: 1 } } }));
    await workflow.formReview(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    const cards = await withTenant(f.schoolId, (db) =>
      db.reportCard.findMany({ where: { termId: f.termId, classArmId: f.armId }, select: { id: true }, orderBy: { id: "asc" } }),
    );
    return { ...f, cardIds: cards.map((c) => c.id) };
  }

  it("final term: approve refuses until EVERY card has a promotion status, naming how many are missing", async () => {
    const f = await seedFinalTermArm("promo-gate");
    const arm = { termId: f.termId, classArmId: f.armId };
    const owner = ctx(f.schoolId, f.ownerId);

    await expect(workflow.approve(owner, arm, reqCtx)).rejects.toMatchObject({
      code: "PROMOTION_STATUS_MISSING",
      details: { missing: 2 },
    });

    const set = await workflow.setPromotionStatus(owner, f.cardIds[0]!, { promotionStatus: "PROMOTED" }, reqCtx);
    expect(set.promotionStatus).toBe("PROMOTED");
    await expect(workflow.approve(owner, arm, reqCtx)).rejects.toMatchObject({
      code: "PROMOTION_STATUS_MISSING",
      details: { missing: 1 },
    });

    await workflow.setPromotionStatus(owner, f.cardIds[1]!, { promotionStatus: "REPEAT" }, reqCtx);
    expect(await workflow.approve(owner, arm, reqCtx)).toEqual({ status: "PRINCIPAL_APPROVED", cardCount: 2 });

    // Every set is audited, with what it changed from and to.
    const audits = await withTenant(f.schoolId, (db) =>
      db.auditLog.findMany({ where: { action: "report-card.promotion-status" }, select: { entityId: true, metadata: true } }),
    );
    expect(audits).toHaveLength(2);
    expect(audits.find((a) => a.entityId === f.cardIds[0])?.metadata).toMatchObject({ from: null, to: "PROMOTED" });
  }, 60_000);

  it("a cleared status counts as missing again", async () => {
    const f = await seedFinalTermArm("promo-clear");
    const owner = ctx(f.schoolId, f.ownerId);
    for (const id of f.cardIds) await workflow.setPromotionStatus(owner, id, { promotionStatus: "PROMOTED" }, reqCtx);
    await workflow.setPromotionStatus(owner, f.cardIds[0]!, { promotionStatus: null }, reqCtx);
    await expect(workflow.approve(owner, { termId: f.termId, classArmId: f.armId }, reqCtx)).rejects.toMatchObject({
      code: "PROMOTION_STATUS_MISSING",
      details: { missing: 1 },
    });
  }, 60_000);

  it("setting it is refused outside its place: not the final term, not FORM_REVIEWED, not a teacher, not another school", async () => {
    // Not the final term: the ordinary fixture's first term has a second after it.
    const first = await seedReviewedArm("promo-first");
    const firstOwner = ctx(first.schoolId, first.ownerId);
    await workflow.formReview(firstOwner, { termId: first.termId, classArmId: first.armId }, reqCtx);
    const firstCard = await withTenant(first.schoolId, (db) =>
      db.reportCard.findFirstOrThrow({ where: { termId: first.termId }, select: { id: true } }),
    );
    await expect(
      workflow.setPromotionStatus(firstOwner, firstCard.id, { promotionStatus: "PROMOTED" }, reqCtx),
    ).rejects.toMatchObject({ code: "PROMOTION_NOT_FINAL_TERM" });

    // Final term, but approved already — past the principal's step.
    const f = await seedFinalTermArm("promo-place");
    const owner = ctx(f.schoolId, f.ownerId);
    for (const id of f.cardIds) await workflow.setPromotionStatus(owner, id, { promotionStatus: "PROMOTED" }, reqCtx);
    await workflow.approve(owner, { termId: f.termId, classArmId: f.armId }, reqCtx);
    await expect(
      workflow.setPromotionStatus(owner, f.cardIds[0]!, { promotionStatus: "REPEAT" }, reqCtx),
    ).rejects.toMatchObject({ code: "PROMOTION_STATUS_NOT_EDITABLE" });

    // The form teacher may review the arm, but the decision is the principal's.
    await expect(
      workflow.setPromotionStatus(ctx(f.schoolId, f.teacherId), f.cardIds[0]!, { promotionStatus: "REPEAT" }, reqCtx),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Another school's owner cannot even find the card.
    const other = await makeSchool("promo-other");
    await expect(
      workflow.setPromotionStatus(ctx(other.schoolId, other.ownerId), f.cardIds[0]!, { promotionStatus: "REPEAT" }, reqCtx),
    ).rejects.toBeInstanceOf(NotFoundError);
  }, 90_000);

  it("a reopen keeps the decision — it is about the student, not the marks", async () => {
    const f = await seedFinalTermArm("promo-reopen");
    const owner = ctx(f.schoolId, f.ownerId);
    await workflow.setPromotionStatus(owner, f.cardIds[0]!, { promotionStatus: "PROMOTED_ON_TRIAL" }, reqCtx);
    await workflow.setPromotionStatus(owner, f.cardIds[1]!, { promotionStatus: "GRADUATED" }, reqCtx);
    await workflow.approve(owner, { termId: f.termId, classArmId: f.armId }, reqCtx);
    await workflow.reopen(owner, { termId: f.termId, classArmId: f.armId, reason: "Wrong exam score" }, reqCtx);

    const after = await withTenant(f.schoolId, (db) =>
      db.reportCard.findMany({ where: { id: { in: f.cardIds } }, select: { status: true, promotionStatus: true }, orderBy: { id: "asc" } }),
    );
    expect(after).toEqual([
      { status: "DRAFT", promotionStatus: "PROMOTED_ON_TRIAL" },
      { status: "DRAFT", promotionStatus: "GRADUATED" },
    ]);
  }, 60_000);
});
