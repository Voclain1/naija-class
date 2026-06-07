import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { AttendanceService } from "./attendance.service";

// Phase 2 / Slice 7 cp1 — daily-attendance integration spec. Real DB + RLS.
// Covers the roster derivation (enrolled-by-date, mid-term join/transfer),
// bulk mark (happy path, idempotent re-mark, roster mismatch, date windows),
// the form-teacher gate (form teacher ✓ / subject teacher 403 / other arm 404),
// cross-tenant isolation, and the term summary (rate math + EXCUSED-in-denom).

// The term lives in the past so in-term dates are also past-relative-to-today
// (the future-date guard uses the real clock). enrolledAt defaults to TERM_START
// so the default roster joins before any in-term date.
const TERM_START = new Date("2025-09-01");
const TERM_END = new Date("2025-12-15");
const D1 = "2025-10-01";
const D2 = "2025-10-02";
const D3 = "2025-10-03";
const D4 = "2025-10-06";
const D5 = "2025-10-07";
const FUTURE = "2099-01-01";
const OUTSIDE_TERM = "2026-03-01"; // past (vs today) but in no term

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

describe("AttendanceService (cp1 — register, mark, summary)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const service = new AttendanceService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  // ---- fixtures ----------------------------------------------------------

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `Att ${suffix}`,
        schoolSlug: `att-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `att-${suffix}-${runId}@example.test`,
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
        data: { schoolId, label: `Y-${suffix}-${runId}`, startDate: TERM_START, endDate: TERM_END },
        select: { id: true },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: TERM_START, endDate: TERM_END, isCurrent: true },
        select: { id: true },
      });
      return { yearId: year.id, termId: term.id };
    });
  }

  async function enroll(
    schoolId: string,
    args: { armId: string; termId: string; yearId: string; suffix: string; lastName?: string; status?: "ENROLLED" | "TRANSFERRED" | "WITHDRAWN"; enrolledAt?: Date },
  ): Promise<{ studentId: string; admissionNumber: string }> {
    return withTenant(schoolId, async (db) => {
      const admissionNumber = `ADM-${args.suffix}-${runId}`;
      const student = await db.student.create({
        data: {
          schoolId,
          admissionNumber,
          firstName: "Stu",
          lastName: args.lastName ?? `P-${args.suffix}`,
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
          enrolledAt: args.enrolledAt ?? TERM_START,
        },
      });
      return { studentId: student.id, admissionNumber };
    });
  }

  async function assignSubject(
    schoolId: string,
    args: { teacherId: string; armId: string; subjectId: string; yearId: string },
  ): Promise<void> {
    await withTenant(schoolId, (db) =>
      db.teacherAssignment.create({
        data: {
          schoolId,
          teacherId: args.teacherId,
          classArmId: args.armId,
          subjectId: args.subjectId,
          academicYearId: args.yearId,
          isActive: true,
        },
      }),
    );
  }

  function auditRows(schoolId: string, action: string, entityId: string) {
    return withTenant(schoolId, (db) =>
      db.auditLog.findMany({ where: { action, entityId }, select: { metadata: true } }),
    );
  }
  function recordCount(schoolId: string, classArmId: string) {
    return withTenant(schoolId, (db) => db.attendanceRecord.count({ where: { classArmId } }));
  }

  // A school with a form-teacher'd arm, a year/term, and two enrolled students.
  async function seedArm(suffix: string) {
    const { schoolId, ownerId } = await makeSchool(suffix);
    const teacherId = await grantTeacher(schoolId, suffix);
    const armId = await makeArm(schoolId, suffix, teacherId); // teacher is the FORM teacher
    const { yearId, termId } = await makeYearTerm(schoolId, suffix);
    const a = await enroll(schoolId, { armId, termId, yearId, suffix: `${suffix}a`, lastName: "Adamu" });
    const b = await enroll(schoolId, { armId, termId, yearId, suffix: `${suffix}b`, lastName: "Bello" });
    return { schoolId, ownerId, teacherId, armId, yearId, termId, a, b };
  }

  // ---- register -----------------------------------------------------------

  it("register: lists enrolled students sorted, unmarked, with the resolved term", async () => {
    const { schoolId, ownerId, armId, termId, a, b } = await seedArm("reg");
    const res = await service.getRegister(ctx(schoolId, ownerId), { classArmId: armId, date: D1 });
    expect(res.termId).toBe(termId);
    expect(res.date).toBe(D1);
    expect(res.records.map((r) => r.studentId)).toEqual([a.studentId, b.studentId]); // Adamu before Bello
    expect(res.records.every((r) => r.status === null && r.markedBy === null)).toBe(true);
  });

  it("register: a student who joins AFTER the date is not on the register", async () => {
    const { schoolId, ownerId, armId, yearId, termId, a } = await seedArm("late");
    await enroll(schoolId, { armId, termId, yearId, suffix: "late-c", enrolledAt: new Date("2025-11-01") });
    const res = await service.getRegister(ctx(schoolId, ownerId), { classArmId: armId, date: D1 }); // 2025-10-01
    const ids = res.records.map((r) => r.studentId);
    expect(ids).toContain(a.studentId);
    expect(ids).toHaveLength(2); // the Nov joiner excluded; only the two TERM_START enrollees
  });

  it("register: a TRANSFERRED student drops off the current register", async () => {
    const { schoolId, ownerId, armId, yearId, termId } = await seedArm("xfer");
    const moved = await enroll(schoolId, { armId, termId, yearId, suffix: "xfer-c", status: "TRANSFERRED" });
    const res = await service.getRegister(ctx(schoolId, ownerId), { classArmId: armId, date: D1 });
    expect(res.records.map((r) => r.studentId)).not.toContain(moved.studentId);
  });

  // ---- mark ---------------------------------------------------------------

  it("mark: upserts the day and writes one audit row with the status tally", async () => {
    const { schoolId, ownerId, armId, a, b } = await seedArm("mark");
    const res = await service.markBulk(
      ctx(schoolId, ownerId),
      {
        classArmId: armId,
        date: D1,
        records: [
          { studentId: a.studentId, status: "PRESENT" },
          { studentId: b.studentId, status: "ABSENT", note: "Sick" },
        ],
      },
      reqCtx,
    );
    expect(res.count).toBe(2);
    expect(await recordCount(schoolId, armId)).toBe(2);
    const audits = await auditRows(schoolId, "attendance.mark", armId);
    expect(audits).toHaveLength(1);
    expect((audits[0].metadata as { byStatus: unknown }).byStatus).toEqual({ PRESENT: 1, ABSENT: 1, LATE: 0, EXCUSED: 0 });
  });

  it("mark: re-marking the same day updates in place (no duplicate row)", async () => {
    const { schoolId, ownerId, armId, a } = await seedArm("remark");
    await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, date: D1, records: [{ studentId: a.studentId, status: "ABSENT" }] }, reqCtx);
    await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, date: D1, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx);
    expect(await recordCount(schoolId, armId)).toBe(1);
    const res = await service.getRegister(ctx(schoolId, ownerId), { classArmId: armId, date: D1 });
    expect(res.records.find((r) => r.studentId === a.studentId)?.status).toBe("PRESENT");
  });

  it("mark: a future date is rejected (400)", async () => {
    const { schoolId, ownerId, armId, a } = await seedArm("future");
    await expect(
      service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, date: FUTURE, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("mark: a past in-term date is accepted (200)", async () => {
    const { schoolId, ownerId, armId, a } = await seedArm("past");
    const res = await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, date: D2, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx);
    expect(res.count).toBe(1);
  });

  it("mark: a date inside no term is rejected (400)", async () => {
    const { schoolId, ownerId, armId, a } = await seedArm("noterm");
    await expect(
      service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, date: OUTSIDE_TERM, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("mark: a student not on the register fails the whole batch with the invalid ids", async () => {
    const { schoolId, ownerId, armId, a } = await seedArm("badroster");
    let caught: unknown;
    try {
      await service.markBulk(
        ctx(schoolId, ownerId),
        { classArmId: armId, date: D1, records: [{ studentId: a.studentId, status: "PRESENT" }, { studentId: "not-enrolled", status: "PRESENT" }] },
        reqCtx,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError & { details?: { invalidStudentIds?: string[] } }).details?.invalidStudentIds).toEqual(["not-enrolled"]);
    expect(await recordCount(schoolId, armId)).toBe(0); // atomic: nothing written
  });

  // ---- form-teacher gate --------------------------------------------------

  it("gate: form teacher marks ✓, subject teacher of the arm → 403, form teacher of another arm → 404", async () => {
    const { schoolId, armId, yearId, teacherId, a } = await seedArm("gate");

    // Form teacher of the arm: allowed.
    const ok = await service.markBulk(ctx(schoolId, teacherId), { classArmId: armId, date: D1, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx);
    expect(ok.count).toBe(1);

    // Subject teacher of the SAME arm (teaches a subject, not the form teacher) → 403.
    const subjectTeacher = await grantTeacher(schoolId, "gate-sub");
    const subject = await makeSubject(schoolId, "gate-sub");
    await assignSubject(schoolId, { teacherId: subjectTeacher, armId, subjectId: subject, yearId });
    await expect(
      service.getRegister(ctx(schoolId, subjectTeacher), { classArmId: armId, date: D1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Form teacher of a DIFFERENT arm → the target arm is invisible → 404.
    const otherTeacher = await grantTeacher(schoolId, "gate-other");
    await makeArm(schoolId, "gate-other", otherTeacher); // they form-teach some OTHER arm
    await expect(
      service.getRegister(ctx(schoolId, otherTeacher), { classArmId: armId, date: D1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("gate: summary is form-teacher + owner/admin only — subject teacher denied (403)", async () => {
    const { schoolId, armId, yearId, termId } = await seedArm("sumgate");
    const subjectTeacher = await grantTeacher(schoolId, "sumgate-sub");
    const subject = await makeSubject(schoolId, "sumgate-sub");
    await assignSubject(schoolId, { teacherId: subjectTeacher, armId, subjectId: subject, yearId });
    await expect(
      service.getSummary(ctx(schoolId, subjectTeacher), { classArmId: armId, termId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ---- cross-tenant -------------------------------------------------------

  it("cross-tenant: a school cannot see another school's register (RLS isolates the roster)", async () => {
    const a1 = await seedArm("tenantA");
    const b1 = await makeSchool("tenantB");
    // School B's owner reads School A's arm on a date inside B's term: B has no
    // such arm/enrollments → the register is empty (A's students never surface).
    const { yearId, termId } = await makeYearTerm(b1.schoolId, "tenantB");
    void yearId;
    void termId;
    const res = await service.getRegister(ctx(b1.schoolId, b1.ownerId), { classArmId: a1.armId, date: D1 });
    expect(res.records).toHaveLength(0);
  });

  // ---- summary ------------------------------------------------------------

  it("summary: rate = (PRESENT + LATE) / daysMarked × 10000, arm days = distinct dates", async () => {
    const { schoolId, ownerId, armId, termId, a } = await seedArm("sum");
    // 4 PRESENT + 1 LATE over 5 distinct days → 5/5 attended → 10000.
    for (const d of [D1, D2, D3, D4]) {
      await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, date: d, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx);
    }
    await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, date: D5, records: [{ studentId: a.studentId, status: "LATE" }] }, reqCtx);

    const res = await service.getSummary(ctx(schoolId, ownerId), { classArmId: armId, termId });
    const row = res.summary.find((r) => r.studentId === a.studentId)!;
    expect(row.daysMarked).toBe(5);
    expect(row.presentCount).toBe(4);
    expect(row.lateCount).toBe(1);
    expect(row.attendanceRate).toBe(10000);
    expect(res.armSummary.totalDaysOperated).toBe(5);
  });

  it("summary: EXCUSED stays in the denominator — 1 EXCUSED of 5 days → 8000, not 10000", async () => {
    const { schoolId, ownerId, armId, termId, a } = await seedArm("excused");
    for (const d of [D1, D2, D3, D4]) {
      await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, date: d, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx);
    }
    await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, date: D5, records: [{ studentId: a.studentId, status: "EXCUSED" }] }, reqCtx);

    const res = await service.getSummary(ctx(schoolId, ownerId), { classArmId: armId, termId });
    const row = res.summary.find((r) => r.studentId === a.studentId)!;
    expect(row.excusedCount).toBe(1);
    expect(row.attendanceRate).toBe(8000);
  });
});
