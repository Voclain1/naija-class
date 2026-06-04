import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError } from "@school-kit/types";

import { AggregationService } from "../assessment/aggregation.service";
import { AuthService } from "../auth/auth.service";
import { ReportCardService } from "./report-card.service";

// Phase 2 / Slice 5 cp1 — report-card BUILD + read integration spec. Real DB,
// real RLS. Build runs the slice-4 aggregation in-tx then snapshots the rollup
// onto DRAFT cards; this proves the rollup math, the in-tx position freshness,
// the gate (build owner/admin-only; reads owner/admin OR form teacher),
// idempotency, the per-subject breakdown, and cross-tenant isolation. No PDF
// (cp2). Assessment rows are inserted directly for control.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23496${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

describe("ReportCardService (cp1 — build + reads)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const authService = new AuthService();
  const service = new ReportCardService(new AggregationService());
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await authService.signupOwner(
      {
        schoolName: `RC ${suffix}`,
        schoolSlug: `rc-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `rc-${suffix}-${runId}@example.test`,
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

  async function grantRole(schoolId: string, suffix: string, key: "teacher" | "admin"): Promise<string> {
    const role = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key, isSystem: true },
      select: { id: true },
    });
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: { schoolId, email: `${key}-${suffix}-${runId}@example.test`, firstName: "T", lastName: key },
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
    args: { armId: string; termId: string; yearId: string; suffix: string; status?: "ENROLLED" | "WITHDRAWN" },
  ): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const student = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-${args.suffix}-${runId}`,
          firstName: "Stu",
          lastName: `Pupil-${args.suffix}`,
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
          status: args.status ?? "ENROLLED",
        },
      });
      return student.id;
    });
  }

  async function scoreAssessment(
    schoolId: string,
    args: { studentId: string; subjectId: string; termId: string; yearId: string; armId: string; totalScore: number },
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
          totalScore: args.totalScore,
          computedAt: new Date(),
        },
      }),
    );
  }

  async function getCard(schoolId: string, studentId: string, termId: string) {
    return withTenant(schoolId, (db) =>
      db.reportCard.findUniqueOrThrow({
        where: { schoolId_studentId_termId: { schoolId, studentId, termId } },
        select: {
          status: true,
          pdfStatus: true,
          overallTotal: true,
          overallAverage: true,
          overallPosition: true,
          subjectsCount: true,
        },
      }),
    );
  }

  // =======================================================================
  // Build + rollup
  // =======================================================================

  it("build materializes one DRAFT card per enrolled student with the rollup snapshot", async () => {
    const { schoolId, ownerId } = await makeSchool("build");
    const armId = await makeArm(schoolId, "build");
    const subj1 = await makeSubject(schoolId, "build-1");
    const subj2 = await makeSubject(schoolId, "build-2");
    const { yearId, termId } = await makeYearTerm(schoolId, "build");

    const a = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "a" });
    const b = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "b" });
    const c = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "c" });
    for (const [student, s1, s2] of [
      [a, 80, 60], // total 140, avg 70.00, → 2nd
      [b, 90, 70], // total 160, avg 80.00, → 1st
      [c, 50, 40], // total 90,  avg 45.00, → 3rd
    ] as const) {
      await scoreAssessment(schoolId, { studentId: student, subjectId: subj1, termId, yearId, armId, totalScore: s1 });
      await scoreAssessment(schoolId, { studentId: student, subjectId: subj2, termId, yearId, armId, totalScore: s2 });
    }

    const result = await service.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    expect(result).toEqual({ cardCount: 3, studentCount: 3 });

    const cardA = await getCard(schoolId, a, termId);
    expect(cardA).toMatchObject({
      status: "DRAFT",
      pdfStatus: "PENDING",
      overallTotal: 140,
      overallAverage: 7000, // 70.00% in hundredths
      overallPosition: 2, // B (avg 80) ranks 1st, A 2nd
      subjectsCount: 2,
    });
    const cardB = await getCard(schoolId, b, termId);
    expect(cardB.overallPosition).toBe(1);
    expect(cardB.overallAverage).toBe(8000);
    const cardC = await getCard(schoolId, c, termId);
    expect(cardC.overallPosition).toBe(3);
  });

  it("build runs aggregation in-tx — positions are fresh from the moment of build", async () => {
    const { schoolId, ownerId } = await makeSchool("fresh");
    const armId = await makeArm(schoolId, "fresh");
    const subj = await makeSubject(schoolId, "fresh");
    const { yearId, termId } = await makeYearTerm(schoolId, "fresh");
    const a = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "fa" });
    const b = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "fb" });
    await scoreAssessment(schoolId, { studentId: a, subjectId: subj, termId, yearId, armId, totalScore: 40 });
    await scoreAssessment(schoolId, { studentId: b, subjectId: subj, termId, yearId, armId, totalScore: 90 });

    // No prior aggregate call — build must compute positions itself.
    await service.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    expect((await getCard(schoolId, b, termId)).overallPosition).toBe(1);
    expect((await getCard(schoolId, a, termId)).overallPosition).toBe(2);
    // And the underlying Assessment carries the fresh classPosition.
    const assessment = await withTenant(schoolId, (db) =>
      db.assessment.findFirstOrThrow({ where: { studentId: b, termId }, select: { classPosition: true } }),
    );
    expect(assessment.classPosition).toBe(1);
  });

  it("a card for an unscored enrolled student has a null rollup (subjectsCount 0)", async () => {
    const { schoolId, ownerId } = await makeSchool("unscored");
    const armId = await makeArm(schoolId, "unscored");
    const { yearId, termId } = await makeYearTerm(schoolId, "unscored");
    const student = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "us" });
    const result = await service.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    expect(result.cardCount).toBe(1);
    expect(await getCard(schoolId, student, termId)).toMatchObject({
      overallTotal: null,
      overallAverage: null,
      overallPosition: null,
      subjectsCount: 0,
      status: "DRAFT",
    });
  });

  it("re-build is idempotent — refreshes the rollup, no duplicate cards", async () => {
    const { schoolId, ownerId } = await makeSchool("rebuild");
    const armId = await makeArm(schoolId, "rebuild");
    const subj = await makeSubject(schoolId, "rebuild");
    const { yearId, termId } = await makeYearTerm(schoolId, "rebuild");
    const student = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "rb" });
    await scoreAssessment(schoolId, { studentId: student, subjectId: subj, termId, yearId, armId, totalScore: 50 });

    await service.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    // Bump the score, then re-build — the rollup should refresh.
    await withTenant(schoolId, (db) =>
      db.assessment.updateMany({ where: { studentId: student, termId }, data: { totalScore: 88 } }),
    );
    const second = await service.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    expect(second.cardCount).toBe(1);

    const count = await withTenant(schoolId, (db) => db.reportCard.count({ where: { studentId: student, termId } }));
    expect(count).toBe(1); // upsert, not duplicate
    expect((await getCard(schoolId, student, termId)).overallTotal).toBe(88);
  });

  it("writes one audit row per build with the card count", async () => {
    const { schoolId, ownerId } = await makeSchool("audit");
    const armId = await makeArm(schoolId, "audit");
    const { yearId, termId } = await makeYearTerm(schoolId, "audit");
    await enrollStudent(schoolId, { armId, termId, yearId, suffix: "au1" });
    await enrollStudent(schoolId, { armId, termId, yearId, suffix: "au2" });
    await service.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    const audit = await withTenant(schoolId, (db) =>
      db.auditLog.findFirst({ where: { action: "report-card.build" }, orderBy: { createdAt: "desc" }, select: { metadata: true } }),
    );
    const meta = audit?.metadata as { cardCount?: number; mode?: string };
    expect(meta?.mode).toBe("build-with-aggregate");
    expect(meta?.cardCount).toBe(2);
  });

  // =======================================================================
  // Gate
  // =======================================================================

  it("build is owner/admin-only — a teacher (even form teacher) is forbidden", async () => {
    const { schoolId } = await makeSchool("gate-build");
    const teacher = await grantRole(schoolId, "gate-build", "teacher");
    const armId = await makeArm(schoolId, "gate-build", teacher); // form teacher
    const { termId } = await makeYearTerm(schoolId, "gate-build");
    await expect(
      service.build(ctx(schoolId, teacher), { termId, classArmId: armId }, reqCtx),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("admin can build", async () => {
    const { schoolId } = await makeSchool("gate-admin");
    const admin = await grantRole(schoolId, "gate-admin", "admin");
    const armId = await makeArm(schoolId, "gate-admin");
    const { termId } = await makeYearTerm(schoolId, "gate-admin");
    await expect(
      service.build(ctx(schoolId, admin), { termId, classArmId: armId }, reqCtx),
    ).resolves.toMatchObject({ cardCount: 0 });
  });

  it("board read: form teacher of the arm can read; a stranger teacher → 404", async () => {
    const { schoolId, ownerId } = await makeSchool("read-gate");
    const formTeacher = await grantRole(schoolId, "read-form", "teacher");
    const stranger = await grantRole(schoolId, "read-stranger", "teacher");
    const armId = await makeArm(schoolId, "read-gate", formTeacher);
    const { yearId, termId } = await makeYearTerm(schoolId, "read-gate");
    await enrollStudent(schoolId, { armId, termId, yearId, suffix: "rg" });
    await service.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);

    await expect(service.getBoard(ctx(schoolId, formTeacher), { termId, classArmId: armId })).resolves.toMatchObject({
      data: expect.any(Array),
    });
    await expect(
      service.getBoard(ctx(schoolId, stranger), { termId, classArmId: armId }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // =======================================================================
  // getById breakdown + cross-tenant
  // =======================================================================

  it("getById returns the card + per-subject breakdown with component scores", async () => {
    const { schoolId, ownerId } = await makeSchool("detail");
    const armId = await makeArm(schoolId, "detail");
    const subj = await makeSubject(schoolId, "detail");
    const { yearId, termId } = await makeYearTerm(schoolId, "detail");
    const student = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "dt" });

    // Score with real component rows (CA1 15 + CA2 15 + Exam 50 = 80).
    const components = await withTenant(schoolId, (db) =>
      db.gradingComponent.findMany({ select: { id: true, key: true } }),
    );
    const byKey = Object.fromEntries(components.map((c) => [c.key, c.id]));
    await withTenant(schoolId, async (db) => {
      for (const [key, score] of [["ca1", 15], ["ca2", 15], ["exam", 50]] as const) {
        await db.assessmentScore.create({
          data: { schoolId, studentId: student, subjectId: subj, termId, componentId: byKey[key]!, score, enteredBy: ownerId },
        });
      }
    });
    await scoreAssessment(schoolId, { studentId: student, subjectId: subj, termId, yearId, armId, totalScore: 80 });

    await service.build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    const card = await withTenant(schoolId, (db) =>
      db.reportCard.findFirstOrThrow({ where: { studentId: student, termId }, select: { id: true } }),
    );
    const detail = await service.getById(ctx(schoolId, ownerId), card.id);

    expect(detail.student.id).toBe(student);
    expect(detail.subjects).toHaveLength(1);
    expect(detail.subjects[0]!.totalScore).toBe(80);
    expect(detail.subjects[0]!.components).toHaveLength(3);
    expect(detail.subjects[0]!.components.map((c) => c.score)).toEqual([15, 15, 50]);
  });

  it("cross-tenant: School A cannot read School B's report card (404)", async () => {
    const a = await makeSchool("xtenant-a");
    const b = await makeSchool("xtenant-b");
    const armB = await makeArm(b.schoolId, "xtenant-b");
    const { yearId, termId } = await makeYearTerm(b.schoolId, "xtenant-b");
    const student = await enrollStudent(b.schoolId, { armId: armB, termId, yearId, suffix: "xb" });
    await service.build(ctx(b.schoolId, b.ownerId), { termId, classArmId: armB }, reqCtx);
    const card = await withTenant(b.schoolId, (db) =>
      db.reportCard.findFirstOrThrow({ where: { studentId: student, termId }, select: { id: true } }),
    );
    await expect(service.getById(ctx(a.schoolId, a.ownerId), card.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
