import { afterAll, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { AssessmentService } from "./assessment.service";

// Phase 2 / Slice 2 cp2 — score-entry integration spec. Real DB, real RLS, real
// role grants, real same-tx materialization. Each scenario provisions its own
// fresh school via the signup path (which seeds the CA1/CA2/Exam scheme + WAEC
// boundaries), so cases are independent. Fixture builders mirror
// teacher-scope.service.spec.ts.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23491${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };

function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess-placeholder", userId, schoolId };
}

describe("AssessmentService (cp2 — score entry + materialization)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const authService = new AuthService();
  const service = new AssessmentService();
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // --- fixture builders ---------------------------------------------------

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await authService.signupOwner(
      {
        schoolName: `Assess Spec ${suffix}`,
        schoolSlug: `assess-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `assess-${suffix}-${runId}@example.test`,
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

  async function grantSystemRole(
    schoolId: string,
    suffix: string,
    roleKey: "teacher" | "admin",
  ): Promise<string> {
    const role = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key: roleKey, isSystem: true },
      select: { id: true },
    });
    return withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: {
          schoolId,
          email: `${roleKey}-${suffix}-${runId}@example.test`,
          firstName: roleKey === "teacher" ? "Tunde" : "Ada",
          lastName: `${roleKey}-${suffix}`,
        },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      return user.id;
    });
  }

  async function makeArm(schoolId: string, suffix: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const level = await db.classLevel.findFirstOrThrow({
        where: { schoolId },
        orderBy: { orderIndex: "asc" },
      });
      const arm = await db.classArm.create({
        data: {
          schoolId,
          classLevelId: level.id,
          name: `${level.name} ${suffix}`,
          code: `${level.code}-${suffix}-${runId}`,
        },
        select: { id: true },
      });
      return arm.id;
    });
  }

  async function makeSubject(schoolId: string, suffix: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const s = await db.subject.create({
        data: { schoolId, name: `Subj ${suffix}`, code: `subj-${suffix}-${runId}` },
        select: { id: true },
      });
      return s.id;
    });
  }

  async function makeYearTerm(
    schoolId: string,
    suffix: string,
  ): Promise<{ yearId: string; termId: string }> {
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `Y-${suffix}-${runId}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
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

  async function assign(
    schoolId: string,
    args: { teacherId: string; classArmId: string; subjectId: string; academicYearId: string },
  ): Promise<void> {
    await withTenant(schoolId, (db) =>
      db.teacherAssignment.create({
        data: {
          schoolId,
          teacherId: args.teacherId,
          classArmId: args.classArmId,
          subjectId: args.subjectId,
          academicYearId: args.academicYearId,
          termId: null,
        },
      }),
    );
  }

  async function enroll(
    schoolId: string,
    args: { classArmId: string; termId: string; academicYearId: string; suffix: string },
  ): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const student = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-${args.suffix}-${runId}`,
          firstName: "Stu",
          lastName: `Pupil-${args.suffix}`,
          dateOfBirth: new Date("2014-03-15"),
          gender: "FEMALE",
        },
        select: { id: true },
      });
      await db.enrollment.create({
        data: {
          schoolId,
          studentId: student.id,
          termId: args.termId,
          academicYearId: args.academicYearId,
          classArmId: args.classArmId,
          status: "ENROLLED",
        },
      });
      return student.id;
    });
  }

  async function studentNoEnroll(schoolId: string, suffix: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const student = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `NOENR-${suffix}-${runId}`,
          firstName: "Un",
          lastName: `Enrolled-${suffix}`,
          dateOfBirth: new Date("2014-03-15"),
          gender: "MALE",
        },
        select: { id: true },
      });
      return student.id;
    });
  }

  function getComponent(schoolId: string, key: string): Promise<{ id: string; weight: number }> {
    return withTenant(schoolId, (db) =>
      db.gradingComponent.findFirstOrThrow({ where: { key }, select: { id: true, weight: true } }),
    );
  }

  // A fully wired teacher + arm + subject + year/term + enrolled student.
  async function fullFixture(suffix: string) {
    const { schoolId, ownerId } = await makeSchool(suffix);
    const teacherId = await grantSystemRole(schoolId, suffix, "teacher");
    const armId = await makeArm(schoolId, suffix);
    const subjectId = await makeSubject(schoolId, suffix);
    const { yearId, termId } = await makeYearTerm(schoolId, suffix);
    await assign(schoolId, { teacherId, classArmId: armId, subjectId, academicYearId: yearId });
    const studentId = await enroll(schoolId, { classArmId: armId, termId, academicYearId: yearId, suffix });
    const ca1 = await getComponent(schoolId, "ca1");
    const ca2 = await getComponent(schoolId, "ca2");
    const exam = await getComponent(schoolId, "exam");
    return { schoolId, ownerId, teacherId, armId, subjectId, yearId, termId, studentId, ca1, ca2, exam };
  }

  // Score all three default components for a student via the bulk path, so the
  // column is complete and eligible for sign-off.
  function fullColumn(
    f: { studentId: string; ca1: { id: string }; ca2: { id: string }; exam: { id: string } },
    studentId = f.studentId,
  ) {
    return [
      { studentId, componentId: f.ca1.id, score: 15 },
      { studentId, componentId: f.ca2.id, score: 15 },
      { studentId, componentId: f.exam.id, score: 50 },
    ];
  }

  // =======================================================================
  // Happy path + materialization
  // =======================================================================

  it("teacher enters CA1 for an assigned student → summary materializes (total + grade)", async () => {
    const f = await fullFixture("happy");
    const result = await service.createScore(
      ctx(f.schoolId, f.teacherId),
      { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: f.ca1.id, score: 18 },
      reqCtx,
    );

    expect(result.assessment.totalScore).toBe(18);
    expect(result.assessment.letterGrade).toBe("F9"); // 18 → F9 (partial, not extrapolated)
    expect(result.assessment.classArmId).toBe(f.armId);
    expect(result.scores).toHaveLength(1);
    expect(result.scores[0].score).toBe(18);
  });

  it("entering CA1 then Exam accumulates the total across components", async () => {
    const f = await fullFixture("accum");
    await service.createScore(
      ctx(f.schoolId, f.teacherId),
      { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: f.ca1.id, score: 18 },
      reqCtx,
    );
    const result = await service.createScore(
      ctx(f.schoolId, f.teacherId),
      { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: f.exam.id, score: 50 },
      reqCtx,
    );
    expect(result.assessment.totalScore).toBe(68); // 18 + 50
    expect(result.assessment.letterGrade).toBe("B3"); // 65–69
    expect(result.scores).toHaveLength(2);
  });

  it("re-entering the same component upserts (no duplicate) and re-materializes", async () => {
    const f = await fullFixture("reenter");
    await service.createScore(
      ctx(f.schoolId, f.teacherId),
      { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: f.ca1.id, score: 10 },
      reqCtx,
    );
    const result = await service.createScore(
      ctx(f.schoolId, f.teacherId),
      { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: f.ca1.id, score: 20 },
      reqCtx,
    );
    expect(result.scores).toHaveLength(1); // upserted, not duplicated
    expect(result.assessment.totalScore).toBe(20);
  });

  it("PATCH updates a score and re-materializes the summary", async () => {
    const f = await fullFixture("patch");
    const created = await service.createScore(
      ctx(f.schoolId, f.teacherId),
      { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: f.ca1.id, score: 10 },
      reqCtx,
    );
    const updated = await service.updateScore(
      ctx(f.schoolId, f.teacherId),
      created.scores[0].id,
      { score: 19 },
      reqCtx,
    );
    expect(updated.assessment.totalScore).toBe(19);
    expect(updated.scores[0].score).toBe(19);
  });

  // =======================================================================
  // Strict validation
  // =======================================================================

  it("rejects a score above the component weight (75 into a 60-mark Exam)", async () => {
    const f = await fullFixture("strict");
    await expect(
      service.createScore(
        ctx(f.schoolId, f.teacherId),
        { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: f.exam.id, score: 75 },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // =======================================================================
  // Teacher scope + enrollment gates
  // =======================================================================

  it("teacher scoring an UNASSIGNED subject in their arm → 404 (not in scope)", async () => {
    const f = await fullFixture("scope");
    const otherSubject = await makeSubject(f.schoolId, "scope-other");
    await expect(
      service.createScore(
        ctx(f.schoolId, f.teacherId),
        { studentId: f.studentId, subjectId: otherSubject, termId: f.termId, componentId: f.ca1.id, score: 10 },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("scoring a student with no enrollment this term → ValidationError", async () => {
    const f = await fullFixture("noenr");
    const unenrolled = await studentNoEnroll(f.schoolId, "noenr");
    // Use the OWNER (unscoped) so the enrollment gate is what fails, not scope.
    await expect(
      service.createScore(
        ctx(f.schoolId, f.ownerId),
        { studentId: unenrolled, subjectId: f.subjectId, termId: f.termId, componentId: f.ca1.id, score: 10 },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a componentId from another school as an unknown component", async () => {
    const f = await fullFixture("xcomp");
    const other = await makeSchool("xcomp-other");
    const otherComponent = await getComponent(other.schoolId, "ca1");
    await expect(
      service.createScore(
        ctx(f.schoolId, f.ownerId),
        { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: otherComponent.id, score: 10 },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("admin/owner is UNSCOPED — can score a student in any arm with no assignment", async () => {
    const f = await fullFixture("admin");
    // The owner holds no teacher assignment; an unscoped write still succeeds.
    const result = await service.createScore(
      ctx(f.schoolId, f.ownerId),
      { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: f.ca1.id, score: 15 },
      reqCtx,
    );
    expect(result.assessment.totalScore).toBe(15);
  });

  // =======================================================================
  // Sign-off clear + audit
  // =======================================================================

  it("re-scoring a signed-off Assessment clears sign-off and records it in audit", async () => {
    const f = await fullFixture("signoff");
    const created = await service.createScore(
      ctx(f.schoolId, f.teacherId),
      { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: f.ca1.id, score: 10 },
      reqCtx,
    );
    // Manually sign off the materialized Assessment row.
    await withTenant(f.schoolId, (db) =>
      db.assessment.update({
        where: { id: created.assessment.id },
        data: { subjectSignedOffAt: new Date("2026-06-03"), subjectSignedOffBy: f.teacherId },
      }),
    );

    const reScored = await service.createScore(
      ctx(f.schoolId, f.teacherId),
      { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: f.ca1.id, score: 12 },
      reqCtx,
    );
    expect(reScored.assessment.subjectSignedOffAt).toBeNull();
    expect(reScored.assessment.subjectSignedOffBy).toBeNull();

    const unlockAudit = await withTenant(f.schoolId, (db) =>
      db.auditLog.findFirst({
        where: { action: "assessment-score.create" },
        orderBy: { createdAt: "desc" },
        select: { metadata: true },
      }),
    );
    expect((unlockAudit?.metadata as { clearedSignOff?: boolean })?.clearedSignOff).toBe(true);
  });

  // =======================================================================
  // Cross-tenant + atomicity
  // =======================================================================

  it("cross-tenant: School A cannot read School B's assessment (404)", async () => {
    const a = await fullFixture("xtenant-a");
    const b = await fullFixture("xtenant-b");
    const bResult = await service.createScore(
      ctx(b.schoolId, b.teacherId),
      { studentId: b.studentId, subjectId: b.subjectId, termId: b.termId, componentId: b.ca1.id, score: 10 },
      reqCtx,
    );
    await expect(
      service.getById(ctx(a.schoolId, a.ownerId), bResult.assessment.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("same-tx atomicity: a materialization failure rolls back the score write (no orphan)", async () => {
    const f = await fullFixture("atomic");
    const spy = vi
      .spyOn(service as unknown as { materializeSummary: () => Promise<unknown> }, "materializeSummary")
      .mockRejectedValueOnce(new Error("boom"));

    await expect(
      service.createScore(
        ctx(f.schoolId, f.teacherId),
        { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: f.ca1.id, score: 10 },
        reqCtx,
      ),
    ).rejects.toThrow("boom");
    spy.mockRestore();

    const orphan = await withTenant(f.schoolId, (db) =>
      db.assessmentScore.findUnique({
        where: {
          schoolId_studentId_subjectId_termId_componentId: {
            schoolId: f.schoolId,
            studentId: f.studentId,
            subjectId: f.subjectId,
            termId: f.termId,
            componentId: f.ca1.id,
          },
        },
      }),
    );
    expect(orphan).toBeNull(); // the score was rolled back with the failed tx
  });

  // =======================================================================
  // Gradebook feed
  // =======================================================================

  it("GET feed returns one row per enrolled student with summary + scores", async () => {
    const f = await fullFixture("feed");
    await service.createScore(
      ctx(f.schoolId, f.teacherId),
      { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: f.ca1.id, score: 14 },
      reqCtx,
    );
    const feed = await service.getFeed(ctx(f.schoolId, f.teacherId), {
      termId: f.termId,
      classArmId: f.armId,
      subjectId: f.subjectId,
    });
    expect(feed.data).toHaveLength(1);
    expect(feed.data[0].student.id).toBe(f.studentId);
    expect(feed.data[0].assessment?.totalScore).toBe(14);
    expect(feed.data[0].scores).toHaveLength(1);
  });

  it("GET feed for a teacher's unassigned (arm, subject) → 404", async () => {
    const f = await fullFixture("feed-scope");
    const otherSubject = await makeSubject(f.schoolId, "feed-other");
    await expect(
      service.getFeed(ctx(f.schoolId, f.teacherId), {
        termId: f.termId,
        classArmId: f.armId,
        subjectId: otherSubject,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // =======================================================================
  // cp3 — bulk column save (atomic)
  // =======================================================================

  it("bulk: teacher saves a full column (multiple students × components) atomically", async () => {
    const f = await fullFixture("bulk-happy");
    const s2 = await enroll(f.schoolId, {
      classArmId: f.armId,
      termId: f.termId,
      academicYearId: f.yearId,
      suffix: "bulk-happy-2",
    });
    const rows = [...fullColumn(f), ...fullColumn(f, s2)];
    const feed = await service.bulkUpsertScores(
      ctx(f.schoolId, f.teacherId),
      { termId: f.termId, subjectId: f.subjectId, rows },
      reqCtx,
    );

    expect(feed.data).toHaveLength(2);
    const s1row = feed.data.find((r) => r.student.id === f.studentId)!;
    expect(s1row.assessment?.totalScore).toBe(80); // 15 + 15 + 50
    expect(s1row.scores).toHaveLength(3);

    const audit = await withTenant(f.schoolId, (db) =>
      db.auditLog.findFirst({
        where: { action: "assessment-score.create", entityType: "assessment_score" },
        orderBy: { createdAt: "desc" },
        select: { metadata: true },
      }),
    );
    expect((audit?.metadata as { count?: number; bulk?: boolean })?.count).toBe(6);
    expect((audit?.metadata as { bulk?: boolean })?.bulk).toBe(true);
  });

  it("bulk: one invalid score rejects the whole batch (no writes, no audit)", async () => {
    const f = await fullFixture("bulk-invalid");
    const rows = [
      { studentId: f.studentId, componentId: f.ca1.id, score: 10 },
      { studentId: f.studentId, componentId: f.exam.id, score: 75 }, // > 60-weight Exam
    ];
    await expect(
      service.bulkUpsertScores(ctx(f.schoolId, f.teacherId), { termId: f.termId, subjectId: f.subjectId, rows }, reqCtx),
    ).rejects.toBeInstanceOf(ValidationError);

    const count = await withTenant(f.schoolId, (db) =>
      db.assessmentScore.count({ where: { studentId: f.studentId } }),
    );
    expect(count).toBe(0);
    const audit = await withTenant(f.schoolId, (db) =>
      db.auditLog.findFirst({ where: { action: "assessment-score.create" } }),
    );
    expect(audit).toBeNull();
  });

  it("bulk: an out-of-scope row rejects the whole batch (404)", async () => {
    const f = await fullFixture("bulk-scope");
    const otherSubject = await makeSubject(f.schoolId, "bulk-scope-other");
    await expect(
      service.bulkUpsertScores(
        ctx(f.schoolId, f.teacherId),
        { termId: f.termId, subjectId: otherSubject, rows: [{ studentId: f.studentId, componentId: f.ca1.id, score: 10 }] },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("bulk: an unenrolled student rejects the whole batch", async () => {
    const f = await fullFixture("bulk-unenr");
    const unenrolled = await studentNoEnroll(f.schoolId, "bulk-unenr");
    await expect(
      service.bulkUpsertScores(
        ctx(f.schoolId, f.ownerId), // owner → isolate the enrollment gate from scope
        {
          termId: f.termId,
          subjectId: f.subjectId,
          rows: [
            { studentId: f.studentId, componentId: f.ca1.id, score: 10 },
            { studentId: unenrolled, componentId: f.ca1.id, score: 10 },
          ],
        },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    const count = await withTenant(f.schoolId, (db) =>
      db.assessmentScore.count({ where: { studentId: f.studentId } }),
    );
    expect(count).toBe(0);
  });

  it("bulk re-save clears prior sign-off and counts it in audit", async () => {
    const f = await fullFixture("bulk-clear");
    await service.bulkUpsertScores(
      ctx(f.schoolId, f.teacherId),
      { termId: f.termId, subjectId: f.subjectId, rows: fullColumn(f) },
      reqCtx,
    );
    await service.signOffColumn(
      ctx(f.schoolId, f.teacherId),
      { termId: f.termId, classArmId: f.armId, subjectId: f.subjectId },
      reqCtx,
    );

    await service.bulkUpsertScores(
      ctx(f.schoolId, f.teacherId),
      { termId: f.termId, subjectId: f.subjectId, rows: [{ studentId: f.studentId, componentId: f.ca1.id, score: 18 }] },
      reqCtx,
    );

    const a = await withTenant(f.schoolId, (db) =>
      db.assessment.findFirst({
        where: { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId },
        select: { subjectSignedOffAt: true },
      }),
    );
    expect(a?.subjectSignedOffAt).toBeNull();

    const audit = await withTenant(f.schoolId, (db) =>
      db.auditLog.findFirst({
        where: { action: "assessment-score.create", entityType: "assessment_score" },
        orderBy: { createdAt: "desc" },
        select: { metadata: true },
      }),
    );
    expect((audit?.metadata as { clearedSignOffCount?: number })?.clearedSignOffCount).toBe(1);
  });

  it("bulk: admin/owner unscoped save succeeds for any students", async () => {
    const f = await fullFixture("bulk-admin");
    const feed = await service.bulkUpsertScores(
      ctx(f.schoolId, f.ownerId),
      { termId: f.termId, subjectId: f.subjectId, rows: [{ studentId: f.studentId, componentId: f.ca1.id, score: 12 }] },
      reqCtx,
    );
    expect(feed.data).toHaveLength(1);
  });

  it("bulk: a materialization failure rolls back ALL upserts (no orphans)", async () => {
    const f = await fullFixture("bulk-atomic");
    const spy = vi
      .spyOn(service as unknown as { materializeSummary: () => Promise<unknown> }, "materializeSummary")
      .mockRejectedValueOnce(new Error("boom"));
    await expect(
      service.bulkUpsertScores(
        ctx(f.schoolId, f.teacherId),
        {
          termId: f.termId,
          subjectId: f.subjectId,
          rows: [
            { studentId: f.studentId, componentId: f.ca1.id, score: 10 },
            { studentId: f.studentId, componentId: f.exam.id, score: 20 },
          ],
        },
        reqCtx,
      ),
    ).rejects.toThrow("boom");
    spy.mockRestore();
    const count = await withTenant(f.schoolId, (db) =>
      db.assessmentScore.count({ where: { studentId: f.studentId } }),
    );
    expect(count).toBe(0);
  });

  it("bulk: one scope call + one enrollment query regardless of batch size (N+1 guard)", async () => {
    const f = await fullFixture("bulk-n1");
    const s2 = await enroll(f.schoolId, {
      classArmId: f.armId,
      termId: f.termId,
      academicYearId: f.yearId,
      suffix: "bulk-n1-2",
    });
    const scopeSpy = vi.spyOn(
      service as unknown as { loadTeacherScope: () => Promise<unknown> },
      "loadTeacherScope",
    );
    const enrSpy = vi.spyOn(
      service as unknown as { loadEnrollmentsForTerm: () => Promise<unknown> },
      "loadEnrollmentsForTerm",
    );
    await service.bulkUpsertScores(
      ctx(f.schoolId, f.teacherId),
      {
        termId: f.termId,
        subjectId: f.subjectId,
        rows: [
          { studentId: f.studentId, componentId: f.ca1.id, score: 10 },
          { studentId: f.studentId, componentId: f.ca2.id, score: 10 },
          { studentId: s2, componentId: f.ca1.id, score: 10 },
          { studentId: s2, componentId: f.ca2.id, score: 10 },
        ],
      },
      reqCtx,
    );
    expect(scopeSpy).toHaveBeenCalledTimes(1);
    expect(enrSpy).toHaveBeenCalledTimes(1);
    scopeSpy.mockRestore();
    enrSpy.mockRestore();
  });

  // =======================================================================
  // cp3 — single sign-off
  // =======================================================================

  it("sign-off: a fully-scored column can be signed off", async () => {
    const f = await fullFixture("so-happy");
    await service.bulkUpsertScores(
      ctx(f.schoolId, f.teacherId),
      { termId: f.termId, subjectId: f.subjectId, rows: fullColumn(f) },
      reqCtx,
    );
    const a = await withTenant(f.schoolId, (db) =>
      db.assessment.findFirstOrThrow({
        where: { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId },
        select: { id: true },
      }),
    );
    const signed = await service.signOff(ctx(f.schoolId, f.teacherId), a.id, reqCtx);
    expect(signed.subjectSignedOffAt).not.toBeNull();
    expect(signed.subjectSignedOffBy).toBe(f.teacherId);
  });

  it("sign-off: rejects when the column is not fully scored", async () => {
    const f = await fullFixture("so-partial");
    const created = await service.createScore(
      ctx(f.schoolId, f.teacherId),
      { studentId: f.studentId, subjectId: f.subjectId, termId: f.termId, componentId: f.ca1.id, score: 15 },
      reqCtx,
    );
    await expect(
      service.signOff(ctx(f.schoolId, f.teacherId), created.assessment.id, reqCtx),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("sign-off: an out-of-scope teacher → 404", async () => {
    const f = await fullFixture("so-scope");
    await service.bulkUpsertScores(
      ctx(f.schoolId, f.ownerId),
      { termId: f.termId, subjectId: f.subjectId, rows: fullColumn(f) },
      reqCtx,
    );
    const a = await withTenant(f.schoolId, (db) =>
      db.assessment.findFirstOrThrow({ where: { studentId: f.studentId }, select: { id: true } }),
    );
    const otherTeacher = await grantSystemRole(f.schoolId, "so-scope-other", "teacher");
    await expect(service.signOff(ctx(f.schoolId, otherTeacher), a.id, reqCtx)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("sign-off: admin/owner unscoped can sign off", async () => {
    const f = await fullFixture("so-admin");
    await service.bulkUpsertScores(
      ctx(f.schoolId, f.ownerId),
      { termId: f.termId, subjectId: f.subjectId, rows: fullColumn(f) },
      reqCtx,
    );
    const a = await withTenant(f.schoolId, (db) =>
      db.assessment.findFirstOrThrow({ where: { studentId: f.studentId }, select: { id: true } }),
    );
    const signed = await service.signOff(ctx(f.schoolId, f.ownerId), a.id, reqCtx);
    expect(signed.subjectSignedOffAt).not.toBeNull();
  });

  // =======================================================================
  // cp3 — bulk column sign-off
  // =======================================================================

  it("bulk sign-off: a fully-scored column signs off every student", async () => {
    const f = await fullFixture("bso-happy");
    const s2 = await enroll(f.schoolId, {
      classArmId: f.armId,
      termId: f.termId,
      academicYearId: f.yearId,
      suffix: "bso-2",
    });
    await service.bulkUpsertScores(
      ctx(f.schoolId, f.teacherId),
      { termId: f.termId, subjectId: f.subjectId, rows: [...fullColumn(f), ...fullColumn(f, s2)] },
      reqCtx,
    );
    const result = await service.signOffColumn(
      ctx(f.schoolId, f.teacherId),
      { termId: f.termId, classArmId: f.armId, subjectId: f.subjectId },
      reqCtx,
    );
    expect(result).toHaveLength(2);
    expect(result.every((a) => a.subjectSignedOffAt !== null)).toBe(true);
  });

  it("bulk sign-off: rejects if any student is missing a component", async () => {
    const f = await fullFixture("bso-partial");
    const s2 = await enroll(f.schoolId, {
      classArmId: f.armId,
      termId: f.termId,
      academicYearId: f.yearId,
      suffix: "bso-p-2",
    });
    await service.bulkUpsertScores(
      ctx(f.schoolId, f.teacherId),
      {
        termId: f.termId,
        subjectId: f.subjectId,
        rows: [...fullColumn(f), { studentId: s2, componentId: f.ca1.id, score: 10 }], // s2 only CA1
      },
      reqCtx,
    );
    await expect(
      service.signOffColumn(
        ctx(f.schoolId, f.teacherId),
        { termId: f.termId, classArmId: f.armId, subjectId: f.subjectId },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("bulk sign-off: an out-of-scope teacher → 404", async () => {
    const f = await fullFixture("bso-scope");
    const otherSubject = await makeSubject(f.schoolId, "bso-scope-other");
    await expect(
      service.signOffColumn(
        ctx(f.schoolId, f.teacherId),
        { termId: f.termId, classArmId: f.armId, subjectId: otherSubject },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("bulk sign-off: cross-tenant cannot reach another school's column", async () => {
    const a = await fullFixture("bso-xa");
    const b = await fullFixture("bso-xb");
    // A's owner targets B's ids: under A's RLS no rows match → 0 touched, B untouched.
    const result = await service.signOffColumn(
      ctx(a.schoolId, a.ownerId),
      { termId: b.termId, classArmId: b.armId, subjectId: b.subjectId },
      reqCtx,
    );
    expect(result).toHaveLength(0);
  });
});
