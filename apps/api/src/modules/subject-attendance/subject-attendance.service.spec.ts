import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { SchoolsService } from "../schools/schools.service";
import { SubjectAttendanceService } from "./subject-attendance.service";

// Phase 2 / Slice 8 cp1 — subject-period attendance integration spec. Real DB +
// RLS. Covers: the opt-in 404 gate (off → all endpoints 404; toggle via
// PATCH /schools/me by owner AND admin), the subject-scope gate (assigned ✓ /
// wrong subject 403 / wrong arm 404 / form-teacher-no-subject 403), the
// period/subject unique key, bulk mark + audit, date windows, roster mismatch,
// cross-tenant isolation, and the by-period summary math (incl. EXCUSED-in-denom).

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
  return `+23494${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

describe("SubjectAttendanceService (cp1 — opt-in, scope, register, mark, summary)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const schools = new SchoolsService();
  const service = new SubjectAttendanceService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  // ---- fixtures ----------------------------------------------------------

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `Sub ${suffix}`,
        schoolSlug: `sub-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `sub-${suffix}-${runId}@example.test`,
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

  function enableFlag(schoolId: string) {
    return basePrisma.school.update({ where: { id: schoolId }, data: { subjectAttendanceEnabled: true } });
  }

  async function grantRole(schoolId: string, suffix: string, key: "teacher" | "admin"): Promise<string> {
    const role = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key, isSystem: true },
      select: { id: true },
    });
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: { schoolId, email: `${key}-${suffix}-${runId}@example.test`, firstName: "U", lastName: key },
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
        data: { schoolId, admissionNumber, firstName: "Stu", lastName: args.lastName ?? `P-${args.suffix}`, dateOfBirth: new Date("2013-05-10"), gender: "FEMALE" },
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

  async function assignSubject(schoolId: string, args: { teacherId: string; armId: string; subjectId: string; yearId: string }): Promise<void> {
    await withTenant(schoolId, (db) =>
      db.teacherAssignment.create({
        data: { schoolId, teacherId: args.teacherId, classArmId: args.armId, subjectId: args.subjectId, academicYearId: args.yearId, isActive: true },
      }),
    );
  }

  function auditRows(schoolId: string, action: string, entityId: string) {
    return withTenant(schoolId, (db) => db.auditLog.findMany({ where: { action, entityId }, select: { metadata: true } }));
  }
  function recordCount(schoolId: string, where: { classArmId?: string; studentId?: string; subjectId?: string }) {
    return withTenant(schoolId, (db) => db.subjectAttendanceRecord.count({ where }));
  }

  // A school with the flag ENABLED, an arm, year/term, a subject + a teacher
  // ASSIGNED that (arm, subject), and two enrolled students.
  async function seedArm(suffix: string) {
    const { schoolId, ownerId } = await makeSchool(suffix);
    await enableFlag(schoolId);
    const teacherId = await grantRole(schoolId, suffix, "teacher");
    const armId = await makeArm(schoolId, suffix);
    const { yearId, termId } = await makeYearTerm(schoolId, suffix);
    const subjectId = await makeSubject(schoolId, suffix);
    await assignSubject(schoolId, { teacherId, armId, subjectId, yearId });
    const a = await enroll(schoolId, { armId, termId, yearId, suffix: `${suffix}a`, lastName: "Adamu" });
    const b = await enroll(schoolId, { armId, termId, yearId, suffix: `${suffix}b`, lastName: "Bello" });
    return { schoolId, ownerId, teacherId, armId, subjectId, yearId, termId, a, b };
  }

  // ---- opt-in gate --------------------------------------------------------

  it("opt-in OFF: all three endpoints 404 — even for the owner", async () => {
    const { schoolId, ownerId } = await makeSchool("off");
    // NOT enabled. Build the minimum so the 404 fires on the FLAG, not later.
    const armId = await makeArm(schoolId, "off");
    const { termId } = await makeYearTerm(schoolId, "off");
    const subjectId = await makeSubject(schoolId, "off");

    await expect(service.getRegister(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: D1, period: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: D1, period: 1, records: [{ studentId: "x", status: "PRESENT" }] }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.getSummary(ctx(schoolId, ownerId), { classArmId: armId, subjectId, termId })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("opt-in OFF: teacher + admin also get 404 on the register", async () => {
    const { schoolId } = await makeSchool("off2");
    const armId = await makeArm(schoolId, "off2");
    await makeYearTerm(schoolId, "off2");
    const subjectId = await makeSubject(schoolId, "off2");
    const teacherId = await grantRole(schoolId, "off2", "teacher");
    const adminId = await grantRole(schoolId, "off2", "admin");
    for (const uid of [teacherId, adminId]) {
      await expect(service.getRegister(ctx(schoolId, uid), { classArmId: armId, subjectId, date: D1, period: 1 })).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("toggle: owner enables via PATCH /schools/me → endpoints become reachable", async () => {
    const { schoolId, ownerId } = await makeSchool("toggle-owner");
    const armId = await makeArm(schoolId, "toggle-owner");
    const { yearId, termId } = await makeYearTerm(schoolId, "toggle-owner");
    const a = await enroll(schoolId, { armId, termId, yearId, suffix: "toggle-owner-a" });
    const subjectId = await makeSubject(schoolId, "toggle-owner");

    // Disabled first.
    await expect(service.getRegister(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: D1, period: 1 })).rejects.toBeInstanceOf(NotFoundError);

    const updated = await schools.patchMe(ctx(schoolId, ownerId), { subjectAttendanceEnabled: true }, reqCtx);
    expect(updated.subjectAttendanceEnabled).toBe(true);

    // Owner now reaches the register (owner bypasses the subject-scope gate).
    const res = await service.getRegister(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: D1, period: 1 });
    expect(res.records.map((r) => r.studentId)).toEqual([a.studentId]);
  });

  it("toggle: admin enables via PATCH /schools/me (acceptance #9 — admin can toggle)", async () => {
    const { schoolId } = await makeSchool("toggle-admin");
    const adminId = await grantRole(schoolId, "toggle-admin", "admin");
    const updated = await schools.patchMe(ctx(schoolId, adminId), { subjectAttendanceEnabled: true }, reqCtx);
    expect(updated.subjectAttendanceEnabled).toBe(true);
    const reread = await basePrisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { subjectAttendanceEnabled: true } });
    expect(reread.subjectAttendanceEnabled).toBe(true);
  });

  // ---- scope gate ---------------------------------------------------------

  it("scope: owner/admin bypass; assigned subject teacher marks ✓", async () => {
    const { schoolId, ownerId, teacherId, armId, subjectId, a } = await seedArm("scope-ok");
    // owner bypass
    const byOwner = await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: D1, period: 1, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx);
    expect(byOwner.count).toBe(1);
    // assigned subject teacher
    const byTeacher = await service.markBulk(ctx(schoolId, teacherId), { classArmId: armId, subjectId, date: D2, period: 1, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx);
    expect(byTeacher.count).toBe(1);
  });

  it("scope: teacher of the arm but a DIFFERENT subject → 403", async () => {
    const { schoolId, armId, subjectId, yearId } = await seedArm("scope-othersub");
    const other = await grantRole(schoolId, "scope-othersub-o", "teacher");
    const otherSubject = await makeSubject(schoolId, "scope-othersub-o");
    await assignSubject(schoolId, { teacherId: other, armId, subjectId: otherSubject, yearId });
    // `other` teaches otherSubject in this arm, but not `subjectId`.
    await expect(service.getRegister(ctx(schoolId, other), { classArmId: armId, subjectId, date: D1, period: 1 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("scope: teacher of a DIFFERENT arm entirely → 404", async () => {
    const { schoolId, armId, subjectId, yearId } = await seedArm("scope-otherarm");
    const other = await grantRole(schoolId, "scope-otherarm-o", "teacher");
    const otherArm = await makeArm(schoolId, "scope-otherarm-o");
    const otherSubject = await makeSubject(schoolId, "scope-otherarm-o");
    await assignSubject(schoolId, { teacherId: other, armId: otherArm, subjectId: otherSubject, yearId });
    await expect(service.getRegister(ctx(schoolId, other), { classArmId: armId, subjectId, date: D1, period: 1 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("scope: form teacher of the arm WITHOUT a subject assignment → 403", async () => {
    const { schoolId, subjectId, yearId, termId } = await seedArm("scope-form");
    const formTeacher = await grantRole(schoolId, "scope-form-ft", "teacher");
    const formArm = await makeArm(schoolId, "scope-form-ft", formTeacher); // they FORM-teach this arm
    await enroll(schoolId, { armId: formArm, termId, yearId, suffix: "scope-form-s" });
    // They are the form teacher of formArm but hold no teacher_assignment for `subjectId` there.
    await expect(service.getRegister(ctx(schoolId, formTeacher), { classArmId: formArm, subjectId, date: D1, period: 1 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ---- mark ---------------------------------------------------------------

  it("mark: upserts the (subject, date, period) and writes one audit row with the tally", async () => {
    const { schoolId, ownerId, armId, subjectId, a, b } = await seedArm("mark");
    const res = await service.markBulk(
      ctx(schoolId, ownerId),
      { classArmId: armId, subjectId, date: D1, period: 2, records: [{ studentId: a.studentId, status: "PRESENT" }, { studentId: b.studentId, status: "ABSENT", note: "left" }] },
      reqCtx,
    );
    expect(res.count).toBe(2);
    expect(await recordCount(schoolId, { classArmId: armId })).toBe(2);
    const audits = await auditRows(schoolId, "subject-attendance.mark", armId);
    expect(audits).toHaveLength(1);
    const meta = audits[0].metadata as { subjectId: string; period: number; byStatus: unknown };
    expect(meta.subjectId).toBe(subjectId);
    expect(meta.period).toBe(2);
    expect(meta.byStatus).toEqual({ PRESENT: 1, ABSENT: 1, LATE: 0, EXCUSED: 0 });
  });

  it("mark: re-marking the same (subject, date, period) updates in place (no duplicate)", async () => {
    const { schoolId, ownerId, armId, subjectId, a } = await seedArm("remark");
    await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: D1, period: 1, records: [{ studentId: a.studentId, status: "ABSENT" }] }, reqCtx);
    await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: D1, period: 1, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx);
    expect(await recordCount(schoolId, { studentId: a.studentId })).toBe(1);
    const res = await service.getRegister(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: D1, period: 1 });
    expect(res.records.find((r) => r.studentId === a.studentId)?.status).toBe("PRESENT");
  });

  it("mark: different PERIODS on the same date are separate rows (period is in the unique key)", async () => {
    const { schoolId, ownerId, armId, subjectId, a } = await seedArm("periods");
    await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: D1, period: 1, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx);
    await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: D1, period: 2, records: [{ studentId: a.studentId, status: "ABSENT" }] }, reqCtx);
    expect(await recordCount(schoolId, { studentId: a.studentId })).toBe(2);
  });

  it("mark: different SUBJECTS at the same (date, period) are separate rows (subject is in the unique key)", async () => {
    const { schoolId, ownerId, armId, subjectId, yearId, a } = await seedArm("subjects");
    const subject2 = await makeSubject(schoolId, "subjects-2");
    void yearId;
    await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: D1, period: 1, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx);
    await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId: subject2, date: D1, period: 1, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx);
    expect(await recordCount(schoolId, { studentId: a.studentId })).toBe(2);
  });

  it("mark: a future date is rejected (400)", async () => {
    const { schoolId, ownerId, armId, subjectId, a } = await seedArm("future");
    await expect(service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: FUTURE, period: 1, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx)).rejects.toBeInstanceOf(ValidationError);
  });

  it("mark: a date inside no term is rejected (400)", async () => {
    const { schoolId, ownerId, armId, subjectId, a } = await seedArm("noterm");
    await expect(service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: OUTSIDE_TERM, period: 1, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx)).rejects.toBeInstanceOf(ValidationError);
  });

  it("mark: a past in-term date is accepted (200)", async () => {
    const { schoolId, ownerId, armId, subjectId, a } = await seedArm("past");
    const res = await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: D2, period: 1, records: [{ studentId: a.studentId, status: "PRESENT" }] }, reqCtx);
    expect(res.count).toBe(1);
  });

  it("mark: a student not on the register fails the whole batch (400) with the invalid ids", async () => {
    const { schoolId, ownerId, armId, subjectId, a } = await seedArm("badroster");
    let caught: unknown;
    try {
      await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: D1, period: 1, records: [{ studentId: a.studentId, status: "PRESENT" }, { studentId: "ghost", status: "PRESENT" }] }, reqCtx);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError & { details?: { invalidStudentIds?: string[] } }).details?.invalidStudentIds).toEqual(["ghost"]);
    expect(await recordCount(schoolId, { classArmId: armId })).toBe(0); // atomic
  });

  // ---- cross-tenant -------------------------------------------------------

  it("cross-tenant: school B cannot see school A's register (RLS isolates the roster)", async () => {
    const a1 = await seedArm("tenantA");
    const b1 = await makeSchool("tenantB");
    await enableFlag(b1.schoolId);
    await makeYearTerm(b1.schoolId, "tenantB");
    const res = await service.getRegister(ctx(b1.schoolId, b1.ownerId), { classArmId: a1.armId, subjectId: a1.subjectId, date: D1, period: 1 });
    expect(res.records).toHaveLength(0);
  });

  // ---- summary ------------------------------------------------------------

  it("summary: by-period — 5 days × 2 periods = 10 records, 8 PRESENT + 2 ABSENT → 8000", async () => {
    const { schoolId, ownerId, armId, subjectId, termId, a } = await seedArm("sum");
    // 10 (date, period) records: periods 1 & 2 across D1..D5. Make exactly 2 ABSENT.
    let made = 0;
    for (const d of [D1, D2, D3, D4, D5]) {
      for (const p of [1, 2]) {
        made += 1;
        const status = made <= 2 ? "ABSENT" : "PRESENT"; // first two ABSENT, rest PRESENT
        await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: d, period: p, records: [{ studentId: a.studentId, status }] }, reqCtx);
      }
    }
    const res = await service.getSummary(ctx(schoolId, ownerId), { classArmId: armId, subjectId, termId });
    const row = res.summary.find((r) => r.studentId === a.studentId)!;
    expect(row.periodsMarked).toBe(10);
    expect(row.presentCount).toBe(8);
    expect(row.absentCount).toBe(2);
    expect(row.attendanceRate).toBe(8000);
    expect(res.armSummary.totalDaysOperated).toBe(5);
    expect(res.armSummary.totalPeriodsOperated).toBe(10);
  });

  it("summary: EXCUSED stays in the denominator — 9 PRESENT + 1 EXCUSED of 10 → 9000", async () => {
    const { schoolId, ownerId, armId, subjectId, termId, a } = await seedArm("excused");
    let made = 0;
    for (const d of [D1, D2, D3, D4, D5]) {
      for (const p of [1, 2]) {
        made += 1;
        const status = made === 1 ? "EXCUSED" : "PRESENT";
        await service.markBulk(ctx(schoolId, ownerId), { classArmId: armId, subjectId, date: d, period: p, records: [{ studentId: a.studentId, status }] }, reqCtx);
      }
    }
    const res = await service.getSummary(ctx(schoolId, ownerId), { classArmId: armId, subjectId, termId });
    const row = res.summary.find((r) => r.studentId === a.studentId)!;
    expect(row.excusedCount).toBe(1);
    expect(row.presentCount).toBe(9);
    expect(row.attendanceRate).toBe(9000);
  });

  it("summary scope: subject teacher sees their subject's summary; another subject → 403", async () => {
    const { schoolId, teacherId, armId, subjectId, termId, yearId } = await seedArm("sumscope");
    // assigned subject ✓
    const ok = await service.getSummary(ctx(schoolId, teacherId), { classArmId: armId, subjectId, termId });
    expect(ok.subjectId).toBe(subjectId);
    // a subject they don't teach → 403 (in arm scope, wrong subject)
    const otherSubject = await makeSubject(schoolId, "sumscope-2");
    void yearId;
    await expect(service.getSummary(ctx(schoolId, teacherId), { classArmId: armId, subjectId: otherSubject, termId })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
