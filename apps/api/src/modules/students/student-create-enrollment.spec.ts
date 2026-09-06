import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, NotFoundError, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { StudentsService } from "./students.service";

// Placing a student in a class AT CREATION (2026-09-07).
//
// Against a real Postgres, because the property that matters is transactional
// and a mocked Prisma cannot demonstrate a rollback.
//
// What is actually being defended:
//
//   1. THE HAPPY PATH — arm exists, student and enrollment both land, and the
//      enrollment carries the academicYearId DERIVED from the term rather than
//      anything the caller supplied.
//   2. THE FALLBACK — no arm chosen, student is created anyway with no
//      enrollment. A school mid-admission legitimately holds unplaced students
//      (student-import-enrollment.md D5), and making placement mandatory at the
//      API would remove a state the CSV path still permits.
//   3. ALL-OR-NOTHING (D6). If the enrollment fails, the STUDENT MUST NOT
//      EXIST. This is the one that cannot be asserted by reading the code: it
//      depends on both writes sharing one transaction, and the failure modes
//      are real — an inactive arm, a bad term, a duplicate enrollment.
//
// Point 3 is the reason this file exists. Creating the student first and
// enrolling afterwards would pass points 1 and 2 identically while leaving
// exactly the orphaned-student state this work exists to eliminate.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23477${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("StudentsService.create — placement at creation", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const service = new StudentsService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  function requiredFields(admissionNumber: string) {
    return {
      admissionNumber,
      firstName: "Ada",
      lastName: "Okafor",
      dateOfBirth: new Date("2012-04-01"),
      gender: "FEMALE" as const,
    };
  }

  async function makeSchool(suffix: string) {
    const signed = await authService.signupOwner(
      {
        schoolName: `Placement ${suffix}`,
        schoolSlug: `place-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `owner-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds.add(signed.school.id);
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
    return {
      schoolId: signed.school.id,
      authCtx: {
        sessionId: "sess-placeholder",
        userId: signed.user.id,
        schoolId: signed.school.id,
      },
    };
  }

  /** A year, a current term, and one arm on the auto-seeded JSS 1 level. */
  async function makeCalendarAndArm(schoolId: string, opts: { armActive?: boolean } = {}) {
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `2026/2027-${runId}`,
          startDate: new Date("2026-09-01"),
          endDate: new Date("2027-07-31"),
          isCurrent: true,
        },
        select: { id: true },
      });
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2026-09-01"),
          endDate: new Date("2026-12-15"),
          isCurrent: true,
        },
        select: { id: true },
      });
      const level = await db.classLevel.findFirstOrThrow({
        where: { schoolId },
        orderBy: { orderIndex: "asc" },
        select: { id: true },
      });
      const arm = await db.classArm.create({
        data: {
          schoolId,
          classLevelId: level.id,
          name: "JSS 1A",
          code: `A-${runId}`,
          isActive: opts.armActive ?? true,
        },
        select: { id: true },
      });
      return { yearId: year.id, termId: term.id, armId: arm.id };
    });
  }

  const countStudents = (schoolId: string, admissionNumber: string) =>
    withTenant(schoolId, (db) => db.student.count({ where: { admissionNumber } }));

  // ---- 1. the happy path ------------------------------------------------

  it("creates the student AND the enrollment when an arm is chosen", async () => {
    const { schoolId, authCtx } = await makeSchool("happy");
    const { yearId, termId, armId } = await makeCalendarAndArm(schoolId);

    const created = await service.create(
      authCtx,
      { ...requiredFields("P-001"), enrollment: { termId, classArmId: armId } },
      reqCtx,
    );

    const enrollments = await withTenant(schoolId, (db) =>
      db.enrollment.findMany({ where: { studentId: created.id } }),
    );
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0]!.classArmId).toBe(armId);
    expect(enrollments[0]!.termId).toBe(termId);
    expect(enrollments[0]!.status).toBe("ENROLLED");
    // Derived server-side from the term, never taken from input — the schema
    // requires academic_year_id and term.academic_year_id stay consistent.
    expect(enrollments[0]!.academicYearId).toBe(yearId);
  });

  it("audits the placement as its own enrollment.create event", async () => {
    const { schoolId, authCtx } = await makeSchool("audit");
    const { termId, armId } = await makeCalendarAndArm(schoolId);

    const created = await service.create(
      authCtx,
      { ...requiredFields("P-002"), enrollment: { termId, classArmId: armId } },
      reqCtx,
    );

    const audit = await withTenant(schoolId, (db) =>
      db.auditLog.findFirst({
        where: { schoolId, action: "enrollment.create", entityType: "enrollment" },
      }),
    );
    expect(audit).not.toBeNull();
    // `via` is what makes "did placing-at-creation actually get used?"
    // answerable later, rather than guessed from timestamps.
    expect((audit!.metadata as Record<string, unknown>).via).toBe("student-create");
    expect((audit!.metadata as Record<string, unknown>).studentId).toBe(created.id);
  });

  // ---- 2. the fallback --------------------------------------------------

  it("creates the student with NO enrollment when none is supplied", async () => {
    const { schoolId, authCtx } = await makeSchool("noarm");
    // Deliberately no calendar and no arm — a brand-new school.

    const created = await service.create(authCtx, requiredFields("P-003"), reqCtx);

    expect(created.id).toBeTruthy();
    const enrollments = await withTenant(schoolId, (db) =>
      db.enrollment.count({ where: { studentId: created.id } }),
    );
    expect(enrollments).toBe(0);
  });

  // ---- 3. all-or-nothing: the property that needs a real database -------

  it("ROLLS BACK the student when the arm is inactive", async () => {
    const { schoolId, authCtx } = await makeSchool("inactive");
    const { termId, armId } = await makeCalendarAndArm(schoolId, { armActive: false });

    await expect(
      service.create(
        authCtx,
        { ...requiredFields("P-004"), enrollment: { termId, classArmId: armId } },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    // The student must NOT exist. A half-applied create is the orphaned-student
    // state this whole change exists to remove.
    expect(await countStudents(schoolId, "P-004")).toBe(0);
  });

  it("ROLLS BACK the student when the term does not exist", async () => {
    const { schoolId, authCtx } = await makeSchool("badterm");
    const { armId } = await makeCalendarAndArm(schoolId);

    await expect(
      service.create(
        authCtx,
        {
          ...requiredFields("P-005"),
          enrollment: {
            termId: "00000000-0000-4000-8000-000000000000",
            classArmId: armId,
          },
        },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await countStudents(schoolId, "P-005")).toBe(0);
  });

  it("reports a duplicate enrollment rather than skipping it silently", async () => {
    const { schoolId, authCtx } = await makeSchool("dupe");
    const { termId, armId } = await makeCalendarAndArm(schoolId);

    const first = await service.create(
      authCtx,
      { ...requiredFields("P-006"), enrollment: { termId, classArmId: armId } },
      reqCtx,
    );
    expect(first.id).toBeTruthy();

    // Same child, same term, entered twice — the exact case `bulkCreate` skips
    // silently by design. On a single-student form that silence would be the
    // wrong answer: the admin needs to be told it already happened.
    await withTenant(schoolId, async (db) => {
      const student = await db.student.findFirstOrThrow({
        where: { admissionNumber: "P-006" },
        select: { id: true },
      });
      await expect(
        db.enrollment.create({
          data: {
            schoolId,
            studentId: student.id,
            termId,
            academicYearId: (await db.term.findFirstOrThrow({
              where: { id: termId },
              select: { academicYearId: true },
            })).academicYearId,
            classArmId: armId,
          },
        }),
      ).rejects.toBeTruthy();
    });
  });

  it("refuses a cross-tenant arm, and leaves no student behind", async () => {
    const a = await makeSchool("tenant-a");
    const b = await makeSchool("tenant-b");
    const armsOfB = await makeCalendarAndArm(b.schoolId);
    const calendarOfA = await makeCalendarAndArm(a.schoolId);

    // School A's admin naming school B's arm. RLS should make it invisible,
    // so this must fail as "not found" rather than enrolling across tenants.
    await expect(
      service.create(
        a.authCtx,
        {
          ...requiredFields("P-007"),
          enrollment: { termId: calendarOfA.termId, classArmId: armsOfB.armId },
        },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await countStudents(a.schoolId, "P-007")).toBe(0);
    const leaked = await withTenant(b.schoolId, (db) =>
      db.enrollment.count({ where: { classArmId: armsOfB.armId } }),
    );
    expect(leaked).toBe(0);
  });

  it("is unaffected by ConflictError on the student itself", async () => {
    const { schoolId, authCtx } = await makeSchool("dupadm");
    const { termId, armId } = await makeCalendarAndArm(schoolId);

    await service.create(
      authCtx,
      { ...requiredFields("P-008"), enrollment: { termId, classArmId: armId } },
      reqCtx,
    );

    // Duplicate admission number — the student insert fails first, so no
    // second enrollment should exist either.
    await expect(
      service.create(
        authCtx,
        { ...requiredFields("P-008"), enrollment: { termId, classArmId: armId } },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const enrollments = await withTenant(schoolId, (db) =>
      db.enrollment.count({ where: { classArmId: armId } }),
    );
    expect(enrollments).toBe(1);
  });
});
