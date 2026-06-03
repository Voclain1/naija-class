import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { AggregationService } from "./aggregation.service";

// Phase 2 / Slice 4 cp2 — aggregation integration spec. Real DB, real RLS, real
// role grants. The ranking MATH is unit-tested in aggregation-rules.spec.ts;
// this file proves the DB concerns: the ENROLLED-roster denominator, the
// form-teacher gate (Flag B), the (j) narrow-pass invariant, idempotency, audit,
// the status endpoint, and cross-tenant isolation. Assessment rows are inserted
// directly for precise control over totals + enrollment status.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23495${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

describe("AggregationService (cp2 — positions)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const authService = new AuthService();
  const service = new AggregationService();
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // --- fixtures -----------------------------------------------------------

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await authService.signupOwner(
      {
        schoolName: `Agg ${suffix}`,
        schoolSlug: `agg-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `agg-${suffix}-${runId}@example.test`,
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
      const level = await db.classLevel.findFirstOrThrow({
        where: { schoolId },
        orderBy: { orderIndex: "asc" },
      });
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

  async function score(
    schoolId: string,
    args: { studentId: string; subjectId: string; termId: string; yearId: string; armId: string; totalScore: number },
  ): Promise<string> {
    return withTenant(schoolId, (db) =>
      db.assessment
        .create({
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
          select: { id: true },
        })
        .then((a) => a.id),
    );
  }

  async function readAssessment(schoolId: string, id: string) {
    return withTenant(schoolId, (db) =>
      db.assessment.findUniqueOrThrow({
        where: { id },
        select: { subjectPosition: true, classPosition: true, positionsComputedAt: true },
      }),
    );
  }

  // A school + arm + year/term + one subject + N enrolled & scored students.
  async function scoredArm(suffix: string, totals: number[], opts?: { formTeacherId?: string }) {
    const { schoolId, ownerId } = await makeSchool(suffix);
    const armId = await makeArm(schoolId, suffix, opts?.formTeacherId);
    const subjectId = await makeSubject(schoolId, suffix);
    const { yearId, termId } = await makeYearTerm(schoolId, suffix);
    const students: { studentId: string; assessmentId: string; total: number }[] = [];
    for (let i = 0; i < totals.length; i += 1) {
      const studentId = await enrollStudent(schoolId, { armId, termId, yearId, suffix: `${suffix}-${i}` });
      const assessmentId = await score(schoolId, { studentId, subjectId, termId, yearId, armId, totalScore: totals[i]! });
      students.push({ studentId, assessmentId, total: totals[i]! });
    }
    return { schoolId, ownerId, armId, subjectId, yearId, termId, students };
  }

  // =======================================================================
  // Service correctness
  // =======================================================================

  it("full arm pass writes subjectPosition AND classPosition", async () => {
    const f = await scoredArm("full", [90, 70, 70, 40]);
    const result = await service.aggregate(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    expect(result.mode).toBe("full");
    expect(result.studentCount).toBe(4);
    expect(result.updateCount).toBe(4);

    const ranks = await Promise.all(f.students.map((s) => readAssessment(f.schoolId, s.assessmentId)));
    // 90, 70, 70, 40 → sparse 1, 2, 2, 4
    expect(ranks.map((r) => r.subjectPosition)).toEqual([1, 2, 2, 4]);
    // single subject → classPosition mirrors subjectPosition
    expect(ranks.map((r) => r.classPosition)).toEqual([1, 2, 2, 4]);
    expect(ranks.every((r) => r.positionsComputedAt !== null)).toBe(true);
  });

  it("(j) subject-NARROW pass updates subjectPosition only and never touches classPosition", async () => {
    const f = await scoredArm("narrow", [80, 60]);
    // First a full pass sets classPosition for everyone.
    await service.aggregate(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    const before = await readAssessment(f.schoolId, f.students[0]!.assessmentId);
    expect(before.classPosition).toBe(1);

    // Change a total, then run a NARROW pass (subjectId provided).
    await withTenant(f.schoolId, (db) =>
      db.assessment.update({ where: { id: f.students[1]!.assessmentId }, data: { totalScore: 95 } }),
    );
    const result = await service.aggregate(
      ctx(f.schoolId, f.ownerId),
      { termId: f.termId, classArmId: f.armId, subjectId: f.subjectId },
      reqCtx,
    );
    expect(result.mode).toBe("subject");

    const s0 = await readAssessment(f.schoolId, f.students[0]!.assessmentId);
    const s1 = await readAssessment(f.schoolId, f.students[1]!.assessmentId);
    // subjectPosition flipped (95 > 80) …
    expect(s1.subjectPosition).toBe(1);
    expect(s0.subjectPosition).toBe(2);
    // … but classPosition is UNTOUCHED by the narrow pass (still the full-pass value).
    expect(s0.classPosition).toBe(before.classPosition); // 1
    expect(s1.classPosition).toBe(2);
  });

  it("ENROLLED-only denominator: a withdrawn student is excluded and their position nulled", async () => {
    const { schoolId, ownerId } = await makeSchool("withdrawn");
    const armId = await makeArm(schoolId, "withdrawn");
    const subjectId = await makeSubject(schoolId, "withdrawn");
    const { yearId, termId } = await makeYearTerm(schoolId, "withdrawn");

    const enrolled = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "w-enr" });
    const aEnrolled = await score(schoolId, { studentId: enrolled, subjectId, termId, yearId, armId, totalScore: 70 });
    const withdrawn = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "w-out", status: "WITHDRAWN" });
    const aWithdrawn = await score(schoolId, { studentId: withdrawn, subjectId, termId, yearId, armId, totalScore: 90 });
    // Pre-seed a stale position on the withdrawn row to prove the pass nulls it.
    await withTenant(schoolId, (db) =>
      db.assessment.update({ where: { id: aWithdrawn }, data: { subjectPosition: 1, classPosition: 1 } }),
    );

    const result = await service.aggregate(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    expect(result.studentCount).toBe(1); // only the ENROLLED student counts

    const e = await readAssessment(schoolId, aEnrolled);
    const w = await readAssessment(schoolId, aWithdrawn);
    expect(e.subjectPosition).toBe(1); // the only enrolled student
    expect(w.subjectPosition).toBeNull(); // withdrawn → nulled
    expect(w.classPosition).toBeNull();
  });

  it("idempotent — running twice yields identical positions", async () => {
    const f = await scoredArm("idem", [88, 88, 50]);
    await service.aggregate(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    const first = await Promise.all(f.students.map((s) => readAssessment(f.schoolId, s.assessmentId)));
    await service.aggregate(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    const second = await Promise.all(f.students.map((s) => readAssessment(f.schoolId, s.assessmentId)));
    expect(second.map((r) => r.subjectPosition)).toEqual(first.map((r) => r.subjectPosition));
    expect(second.map((r) => r.subjectPosition)).toEqual([1, 1, 3]);
  });

  it("writes one audit row per pass with the expected metadata", async () => {
    const f = await scoredArm("audit", [60, 40]);
    await service.aggregate(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    const audit = await withTenant(f.schoolId, (db) =>
      db.auditLog.findFirst({ where: { action: "assessment.aggregate" }, orderBy: { createdAt: "desc" }, select: { metadata: true } }),
    );
    const meta = audit?.metadata as { mode?: string; updateCount?: number; studentCount?: number };
    expect(meta?.mode).toBe("full");
    expect(meta?.updateCount).toBe(2);
    expect(meta?.studentCount).toBe(2);
  });

  it("cross-tenant: School A cannot aggregate School B's arm (404)", async () => {
    const a = await makeSchool("xtenant-a");
    const b = await scoredArm("xtenant-b", [70, 50]);
    await expect(
      service.aggregate(ctx(a.schoolId, a.ownerId), { termId: b.termId, classArmId: b.armId }, reqCtx),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // =======================================================================
  // Gate (Flag B)
  // =======================================================================

  it("owner can aggregate any arm", async () => {
    const f = await scoredArm("gate-owner", [50]);
    await expect(
      service.aggregate(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx),
    ).resolves.toMatchObject({ mode: "full" });
  });

  it("admin can aggregate any arm", async () => {
    const f = await scoredArm("gate-admin", [50]);
    const admin = await grantRole(f.schoolId, "gate-admin", "admin");
    await expect(
      service.aggregate(ctx(f.schoolId, admin), { termId: f.termId, classArmId: f.armId }, reqCtx),
    ).resolves.toMatchObject({ mode: "full" });
  });

  it("a teacher who is the FORM teacher of the arm can aggregate", async () => {
    const { schoolId, ownerId } = await makeSchool("gate-form");
    const teacher = await grantRole(schoolId, "gate-form", "teacher");
    const armId = await makeArm(schoolId, "gate-form", teacher); // form teacher
    const subjectId = await makeSubject(schoolId, "gate-form");
    const { yearId, termId } = await makeYearTerm(schoolId, "gate-form");
    const s = await enrollStudent(schoolId, { armId, termId, yearId, suffix: "gf" });
    await score(schoolId, { studentId: s, subjectId, termId, yearId, armId, totalScore: 70 });
    void ownerId;
    await expect(
      service.aggregate(ctx(schoolId, teacher), { termId, classArmId: armId, subjectId }, reqCtx),
    ).resolves.toMatchObject({ mode: "subject" });
  });

  it("a SUBJECT teacher (not form teacher) of the arm → 404", async () => {
    const { schoolId } = await makeSchool("gate-subject");
    const teacher = await grantRole(schoolId, "gate-subject", "teacher");
    const armId = await makeArm(schoolId, "gate-subject"); // no form teacher
    const subjectId = await makeSubject(schoolId, "gate-subject");
    const { yearId, termId } = await makeYearTerm(schoolId, "gate-subject");
    await withTenant(schoolId, (db) =>
      db.teacherAssignment.create({
        data: { schoolId, teacherId: teacher, classArmId: armId, subjectId, academicYearId: yearId, termId: null },
      }),
    );
    await expect(
      service.aggregate(ctx(schoolId, teacher), { termId, classArmId: armId, subjectId }, reqCtx),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a teacher with no relation to the arm → 404", async () => {
    const f = await scoredArm("gate-none", [50]);
    const stranger = await grantRole(f.schoolId, "gate-none", "teacher");
    await expect(
      service.aggregate(ctx(f.schoolId, stranger), { termId: f.termId, classArmId: f.armId }, reqCtx),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // =======================================================================
  // Status endpoint
  // =======================================================================

  it("status: a narrow pass updates perSubject; overall stays null until a full pass", async () => {
    const f = await scoredArm("status", [80, 60]);
    // Narrow pass first.
    await service.aggregate(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId, subjectId: f.subjectId }, reqCtx);
    const afterNarrow = await service.getStatus(ctx(f.schoolId, f.ownerId), f.termId, f.armId);
    expect(afterNarrow.perSubject.find((p) => p.subjectId === f.subjectId)?.lastComputedAt).not.toBeNull();
    expect(afterNarrow.overall).toBeNull(); // no full pass yet → no classPosition

    // Full pass sets overall.
    await service.aggregate(ctx(f.schoolId, f.ownerId), { termId: f.termId, classArmId: f.armId }, reqCtx);
    const afterFull = await service.getStatus(ctx(f.schoolId, f.ownerId), f.termId, f.armId);
    expect(afterFull.overall).not.toBeNull();
  });

  // =======================================================================
  // Edge cases (denominator concerns at the service layer)
  // =======================================================================

  it("empty arm (no enrollments) → 0 updates, no error", async () => {
    const { schoolId, ownerId } = await makeSchool("empty");
    const armId = await makeArm(schoolId, "empty");
    const { termId } = await makeYearTerm(schoolId, "empty");
    const result = await service.aggregate(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    expect(result.studentCount).toBe(0);
    expect(result.updateCount).toBe(0);
  });

  it("all-tied students all share rank 1; a single student is position 1", async () => {
    const tied = await scoredArm("tied", [55, 55, 55]);
    await service.aggregate(ctx(tied.schoolId, tied.ownerId), { termId: tied.termId, classArmId: tied.armId }, reqCtx);
    const ranks = await Promise.all(tied.students.map((s) => readAssessment(tied.schoolId, s.assessmentId)));
    expect(ranks.map((r) => r.subjectPosition)).toEqual([1, 1, 1]);

    const solo = await scoredArm("solo", [42]);
    await service.aggregate(ctx(solo.schoolId, solo.ownerId), { termId: solo.termId, classArmId: solo.armId }, reqCtx);
    expect((await readAssessment(solo.schoolId, solo.students[0]!.assessmentId)).subjectPosition).toBe(1);
  });
});
