import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { AuthService } from "../auth/auth.service";
import { getTeacherScope } from "../teacher-scope/teacher-scope.helper";
import { AttendanceService } from "./attendance.service";

// Staff mobile CP2 — the claims the mobile register screens actually depend on,
// against real Postgres under RLS.
//
// This spec deliberately does NOT re-test the form-teacher gate, the date
// windows, the roster-mismatch rejection or cross-tenant isolation. Those are
// already covered by attendance.service.spec.ts (14/14) and re-asserting them
// here would be duplication that rots. What is tested here is only what CP2
// newly relies on:
//
//   Gate 0 — the "CP2 needs no server change" claim. The two reads the phone
//            makes must together supply everything the screens render, in one
//            round-trip each. If they do not, CP2's scope boundary is wrong
//            and that is a decision to take, not a field to quietly add.
//   Gate 4 — exactly one audit row per submit, and dirty-only submits leaving
//            untouched rows' provenance alone (the amend semantics the UI
//            promises when it says "saving again updates it").

const TERM_START = new Date("2025-09-01");
const TERM_END = new Date("2025-12-15");
const D1 = "2025-10-01";

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

describe("AttendanceService — staff mobile CP2 contract", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const service = new AttendanceService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  async function seed(suffix: string) {
    const signed = await auth.signupOwner(
      {
        schoolName: `Cp2 ${suffix}`,
        schoolSlug: `cp2-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `cp2-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    const schoolId = signed.school.id;
    schoolIds.add(schoolId);
    await basePrisma.school.update({
      where: { id: schoolId },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });

    const role = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key: "teacher", isSystem: true },
      select: { id: true },
    });

    return withTenant(schoolId, async (db) => {
      const teacher = await db.user.create({
        data: {
          schoolId,
          email: `cp2t-${suffix}-${runId}@example.test`,
          firstName: "Tina",
          lastName: "Teach",
        },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: teacher.id, roleId: role.id } });

      const level = await db.classLevel.findFirstOrThrow({
        where: { schoolId },
        orderBy: { orderIndex: "asc" },
      });
      // The teacher is the FORM teacher of this arm — the only principal the
      // mobile arm list is allowed to offer a register to.
      const arm = await db.classArm.create({
        data: {
          schoolId,
          classLevelId: level.id,
          name: `Arm ${suffix}`,
          code: `cp2-${suffix}-${runId}`,
          classTeacherId: teacher.id,
        },
        select: { id: true, name: true },
      });

      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${suffix}-${runId}`, startDate: TERM_START, endDate: TERM_END },
        select: { id: true },
      });
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: TERM_START,
          endDate: TERM_END,
          isCurrent: true,
        },
        select: { id: true },
      });

      const students: Array<{ id: string; admissionNumber: string }> = [];
      for (const [i, lastName] of ["Adamu", "Bello"].entries()) {
        const student = await db.student.create({
          data: {
            schoolId,
            admissionNumber: `CP2-${suffix}-${i}-${runId}`,
            firstName: "Stu",
            lastName,
            dateOfBirth: new Date("2013-05-10"),
            gender: "FEMALE",
          },
          select: { id: true, admissionNumber: true },
        });
        await db.enrollment.create({
          data: {
            schoolId,
            studentId: student.id,
            termId: term.id,
            academicYearId: year.id,
            classArmId: arm.id,
            status: "ENROLLED",
            enrolledAt: TERM_START,
          },
        });
        students.push(student);
      }

      return { schoolId, teacherId: teacher.id, arm, termId: term.id, students };
    });
  }

  // ---- Gate 0: the two reads supply the whole screen ----------------------

  it("teacher scope supplies the arm list the phone renders, in ONE call", async () => {
    const { schoolId, teacherId, arm } = await seed("scope");

    const scope = await withTenant(schoolId, (db) => getTeacherScope(db, teacherId));

    // The mobile arm list is formTeacherArmIds ∩ classArms — a subject teacher
    // must never be offered a register the service would 403.
    expect(scope.formTeacherArmIds).toContain(arm.id);
    const listed = scope.classArms.find((a) => a.id === arm.id);
    expect(listed).toBeDefined();
    // Everything the arm card draws, with no second request: the arm's own
    // name and the class level it sits under.
    expect(listed?.name).toBe(arm.name);
    expect(typeof listed?.classLevelName).toBe("string");
    expect(listed?.classLevelName.length).toBeGreaterThan(0);
  });

  it("the register supplies every field the row draws, and no admin-only PII", async () => {
    const { schoolId, teacherId, arm, termId, students } = await seed("fields");

    const res = await service.getRegister(ctx(schoolId, teacherId), {
      classArmId: arm.id,
      date: D1,
    });

    expect(res.termId).toBe(termId);
    expect(res.date).toBe(D1);
    expect(res.records).toHaveLength(2);

    const row = res.records[0];
    // What the row renders.
    expect(row.fullName).toContain("Adamu");
    expect(row.admissionNumber).toBe(students[0].admissionNumber);
    expect(row.status).toBeNull(); // unmarked → the screen says "Not marked yet"
    expect(row.markedAt).toBeNull(); // → no "last saved at" stamp
    expect(row.markedBy).toBeNull();

    // And what it must NOT carry. A register is a teacher surface; guardian
    // contact details, medical notes, address and DOB belong to the admin
    // student DTO and have no business travelling to a phone in a staffroom.
    for (const forbidden of [
      "dateOfBirth",
      "address",
      "phone",
      "email",
      "bloodGroup",
      "medicalNotes",
      "guardians",
      "photoUrl",
    ]) {
      expect(row).not.toHaveProperty(forbidden);
    }
  });

  // ---- Gate 4: audit exactness and amend semantics ------------------------

  it("writes EXACTLY ONE audit row per submit, not one per student", async () => {
    const { schoolId, teacherId, arm, students } = await seed("audit");

    await service.markBulk(
      ctx(schoolId, teacherId),
      {
        classArmId: arm.id,
        date: D1,
        records: [
          { studentId: students[0].id, status: "PRESENT" },
          { studentId: students[1].id, status: "ABSENT" },
        ],
      },
      reqCtx,
    );

    const audits = await withTenant(schoolId, (db) =>
      db.auditLog.findMany({ where: { entityId: arm.id }, select: { action: true } }),
    );
    expect(audits).toHaveLength(1);
  });

  it("a dirty-only re-submit updates the touched row and leaves the other's provenance alone", async () => {
    const { schoolId, teacherId, arm, students } = await seed("amend");

    await service.markBulk(
      ctx(schoolId, teacherId),
      {
        classArmId: arm.id,
        date: D1,
        records: [
          { studentId: students[0].id, status: "PRESENT" },
          { studentId: students[1].id, status: "PRESENT" },
        ],
      },
      reqCtx,
    );

    const first = await service.getRegister(ctx(schoolId, teacherId), {
      classArmId: arm.id,
      date: D1,
    });
    const untouchedBefore = first.records.find((r) => r.studentId === students[1].id);
    expect(untouchedBefore?.markedAt).not.toBeNull();

    // The phone sends ONLY the row the teacher changed — this is the property
    // the UI's dirty-row filter depends on. Re-sending the whole register would
    // restamp a student this teacher never looked at.
    await service.markBulk(
      ctx(schoolId, teacherId),
      {
        classArmId: arm.id,
        date: D1,
        records: [{ studentId: students[0].id, status: "ABSENT" }],
      },
      reqCtx,
    );

    const second = await service.getRegister(ctx(schoolId, teacherId), {
      classArmId: arm.id,
      date: D1,
    });
    const changed = second.records.find((r) => r.studentId === students[0].id);
    const untouchedAfter = second.records.find((r) => r.studentId === students[1].id);

    expect(changed?.status).toBe("ABSENT");
    expect(untouchedAfter?.status).toBe("PRESENT");
    expect(new Date(untouchedAfter?.markedAt as string).getTime()).toBe(
      new Date(untouchedBefore?.markedAt as string).getTime(),
    );

    // Amending is an upsert, not an append: still two records for the day.
    const count = await withTenant(schoolId, (db) =>
      db.attendanceRecord.count({ where: { classArmId: arm.id } }),
    );
    expect(count).toBe(2);

    // And a second audit row, so an amendment is never invisible.
    const audits = await withTenant(schoolId, (db) =>
      db.auditLog.count({ where: { entityId: arm.id } }),
    );
    expect(audits).toBe(2);
  });
});
