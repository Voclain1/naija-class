import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { TeacherAssignmentsService } from "../teacher-assignments/teacher-assignments.service";
import { getTeacherScope } from "./teacher-scope.helper";
import { TeacherScopeService } from "./teacher-scope.service";

// Phase 1 / Slice 11 cp2 — the security test matrix. This is the load-bearing
// proof that the teacher-scope filter isolates WITHIN a school: a teacher sees
// only their assigned + homeroom arms, and out-of-scope / cross-tenant arms
// appear not to exist (404, not 403). Integration spec — real DB, real RLS,
// real role grants. Depends on the owner/admin/teacher system roles being
// seeded (every prior spec does too).

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23499${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

const FAKE_ARM_ID = "00000000-0000-4000-8000-000000000000";

function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess-placeholder", userId, schoolId };
}

describe("TeacherScope (cp2 security matrix)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const scopeService = new TeacherScopeService();
  const assignmentsService = new TeacherAssignmentsService();
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // --- fixture builders -------------------------------------------------

  async function makeSchool(suffix: string): Promise<string> {
    const signed = await authService.signupOwner(
      {
        schoolName: `Scope Spec ${suffix}`,
        schoolSlug: `scope-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `scope-${suffix}-${runId}@example.test`,
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
    return signed.school.id;
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

  // Create a class arm under the first seeded level, optionally with a
  // homeroom (form) teacher. Returns the arm id.
  async function makeArm(
    schoolId: string,
    suffix: string,
    classTeacherId?: string,
  ): Promise<string> {
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
          classTeacherId: classTeacherId ?? null,
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

  async function makeYear(
    schoolId: string,
    suffix: string,
    currentTerm = false,
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
          isCurrent: currentTerm,
        },
        select: { id: true },
      });
      return { yearId: year.id, termId: term.id };
    });
  }

  async function assign(
    schoolId: string,
    args: {
      teacherId: string;
      classArmId: string;
      subjectId: string;
      academicYearId: string;
      termId?: string | null;
    },
  ): Promise<void> {
    await withTenant(schoolId, (db) =>
      db.teacherAssignment.create({
        data: {
          schoolId,
          teacherId: args.teacherId,
          classArmId: args.classArmId,
          subjectId: args.subjectId,
          academicYearId: args.academicYearId,
          termId: args.termId ?? null,
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

  // =====================================================================
  // getTeacherScope — the helper (called directly inside withTenant)
  // =====================================================================

  it("scope: subject-assignments only → those arms, subjects-by-arm populated", async () => {
    const schoolId = await makeSchool("subj-only");
    const teacher = await grantSystemRole(schoolId, "subj-only", "teacher");
    const arm = await makeArm(schoolId, "x");
    const subject = await makeSubject(schoolId, "x");
    const { yearId } = await makeYear(schoolId, "x");
    await assign(schoolId, {
      teacherId: teacher,
      classArmId: arm,
      subjectId: subject,
      academicYearId: yearId,
    });

    const scope = await withTenant(schoolId, (db) => getTeacherScope(db, teacher));
    // Enriched shape: arms carry { id, name, code }.
    expect(scope.classArms.map((a) => a.id)).toEqual([arm]);
    expect(scope.classArms[0].name).toBeTruthy();
    expect(scope.classArms[0].code).toBeTruthy();
    const subs = scope.subjectsByArm.get(arm);
    expect(subs?.map((s) => s.id)).toEqual([subject]);
    expect(subs?.[0].name).toBeTruthy();
    expect(subs?.[0].code).toBeTruthy();
  });

  it("scope: homeroom only → that arm, NO subjects-by-arm entry", async () => {
    const schoolId = await makeSchool("home-only");
    const teacher = await grantSystemRole(schoolId, "home-only", "teacher");
    const arm = await makeArm(schoolId, "h", teacher); // homeroom

    const scope = await withTenant(schoolId, (db) => getTeacherScope(db, teacher));
    expect(scope.classArms.map((a) => a.id)).toEqual([arm]);
    expect(scope.classArms[0].name).toBeTruthy();
    expect(scope.classArms[0].code).toBeTruthy();
    expect(scope.subjectsByArm.has(arm)).toBe(false);
  });

  it("scope: subject + homeroom → union, deduped (overlapping arm appears once)", async () => {
    const schoolId = await makeSchool("both");
    const teacher = await grantSystemRole(schoolId, "both", "teacher");
    const subject = await makeSubject(schoolId, "b");
    const { yearId } = await makeYear(schoolId, "b");
    // armX: teacher is homeroom AND subject-assigned (must dedupe to one id).
    const armX = await makeArm(schoolId, "bx", teacher);
    // armY: subject-assigned only.
    const armY = await makeArm(schoolId, "by");
    await assign(schoolId, { teacherId: teacher, classArmId: armX, subjectId: subject, academicYearId: yearId });
    await assign(schoolId, { teacherId: teacher, classArmId: armY, subjectId: subject, academicYearId: yearId });

    const scope = await withTenant(schoolId, (db) => getTeacherScope(db, teacher));
    const armIds = scope.classArms.map((a) => a.id);
    expect([...armIds].sort()).toEqual([armX, armY].sort());
    // No duplicate armX (homeroom + subject-assignment for the same arm).
    expect(armIds.filter((a) => a === armX)).toHaveLength(1);
    // Arms carry display fields.
    expect(scope.classArms.every((a) => a.name && a.code)).toBe(true);
    expect(scope.subjectsByArm.get(armX)?.map((s) => s.id)).toEqual([subject]);
    expect(scope.subjectsByArm.get(armY)?.map((s) => s.id)).toEqual([subject]);
  });

  it("scope: neither assignment nor homeroom → empty arrays (not an error)", async () => {
    const schoolId = await makeSchool("neither");
    const teacher = await grantSystemRole(schoolId, "neither", "teacher");

    const scope = await withTenant(schoolId, (db) => getTeacherScope(db, teacher));
    expect(scope.classArms).toEqual([]);
    expect(scope.subjectsByArm.size).toBe(0);
  });

  it("scope: year filter restricts SUBJECT assignments to that academicYearId", async () => {
    const schoolId = await makeSchool("year-filter");
    const teacher = await grantSystemRole(schoolId, "year-filter", "teacher");
    const subject = await makeSubject(schoolId, "yf");
    const armA = await makeArm(schoolId, "yfa");
    const armB = await makeArm(schoolId, "yfb");
    const y1 = await makeYear(schoolId, "yf1");
    const y2 = await makeYear(schoolId, "yf2");
    await assign(schoolId, { teacherId: teacher, classArmId: armA, subjectId: subject, academicYearId: y1.yearId });
    await assign(schoolId, { teacherId: teacher, classArmId: armB, subjectId: subject, academicYearId: y2.yearId });

    const unfiltered = await withTenant(schoolId, (db) => getTeacherScope(db, teacher));
    expect([...unfiltered.classArms.map((a) => a.id)].sort()).toEqual(
      [armA, armB].sort(),
    );

    const y1Only = await withTenant(schoolId, (db) =>
      getTeacherScope(db, teacher, y1.yearId),
    );
    expect(y1Only.classArms.map((a) => a.id)).toEqual([armA]);
  });

  it("scope: cross-tenant returns empty (RLS hides another school's assignments/homeroom)", async () => {
    const schoolA = await makeSchool("xt-a");
    const teacherA = await grantSystemRole(schoolA, "xt-a", "teacher");
    const subjectA = await makeSubject(schoolA, "xt");
    const armA = await makeArm(schoolA, "xt", teacherA); // homeroom too
    const { yearId } = await makeYear(schoolA, "xt");
    await assign(schoolA, { teacherId: teacherA, classArmId: armA, subjectId: subjectA, academicYearId: yearId });

    const schoolB = await makeSchool("xt-b");
    // Resolve teacherA's scope while scoped to school B — RLS must hide
    // everything, even though teacherA has real assignments in school A.
    const scope = await withTenant(schoolB, (db) => getTeacherScope(db, teacherA));
    expect(scope.classArms).toEqual([]);
    expect(scope.subjectsByArm.size).toBe(0);
  });

  // =====================================================================
  // GET /teacher-scope/me — role gate
  // =====================================================================

  it("GET /teacher-scope/me as a teacher → 200 with own scope", async () => {
    const schoolId = await makeSchool("me-teacher");
    const teacher = await grantSystemRole(schoolId, "me-teacher", "teacher");
    const arm = await makeArm(schoolId, "m", teacher);

    const result = await scopeService.getMyScope(ctx(schoolId, teacher));
    // Enriched DTO: classArms carry { id, name, code }; subjectsByArm is a
    // plain Record (empty here — homeroom-only arm has no subjects).
    expect(result.classArms.map((a) => a.id)).toEqual([arm]);
    expect(result.classArms[0]).toMatchObject({ id: arm });
    expect(result.classArms[0].name).toBeTruthy();
    expect(result.classArms[0].code).toBeTruthy();
    expect(result.subjectsByArm).toEqual({});
    // No term marked current in this fixture → null (slice 3 cp1).
    expect(result.currentTerm).toBeNull();
  });

  it("GET /teacher-scope/me includes the school's current term (slice 3 cp1)", async () => {
    const schoolId = await makeSchool("me-curterm");
    const teacher = await grantSystemRole(schoolId, "me-curterm", "teacher");
    const { termId } = await makeYear(schoolId, "ct", true); // current term

    const result = await scopeService.getMyScope(ctx(schoolId, teacher));
    expect(result.currentTerm).toMatchObject({ id: termId, sequence: 1 });
    expect(result.currentTerm?.name).toBeTruthy();
  });

  it("GET /teacher-scope/me as an admin → 403 (admins use admin CRUD, not teacher endpoints)", async () => {
    const schoolId = await makeSchool("me-admin");
    const admin = await grantSystemRole(schoolId, "me-admin", "admin");

    await expect(
      scopeService.getMyScope(ctx(schoolId, admin)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // =====================================================================
  // GET /teacher-scope/me/arms/:armId/students — roster + scope enforcement
  // =====================================================================

  it("roster: in-scope arm → 200 with the arm's current-term students", async () => {
    const schoolId = await makeSchool("roster-ok");
    const teacher = await grantSystemRole(schoolId, "roster-ok", "teacher");
    const subject = await makeSubject(schoolId, "r");
    const arm = await makeArm(schoolId, "r");
    const { yearId, termId } = await makeYear(schoolId, "r", true); // current term
    await assign(schoolId, { teacherId: teacher, classArmId: arm, subjectId: subject, academicYearId: yearId });
    const studentId = await enroll(schoolId, { classArmId: arm, termId, academicYearId: yearId, suffix: "r" });

    const result = await scopeService.getMyArmRoster(ctx(schoolId, teacher), arm);
    expect(result.data.map((s) => s.id)).toContain(studentId);
    // PII-minimised: the trimmed roster row carries no medicalNotes/address.
    expect(result.data[0]).not.toHaveProperty("medicalNotes");
    expect(result.data[0]).not.toHaveProperty("address");
  });

  it("roster: out-of-scope arm (same tenant) → 404, NOT 403", async () => {
    const schoolId = await makeSchool("roster-oos");
    const teacher = await grantSystemRole(schoolId, "roster-oos", "teacher");
    // An arm the teacher is NOT assigned to and does NOT homeroom.
    const otherArm = await makeArm(schoolId, "oos");

    await expect(
      scopeService.getMyArmRoster(ctx(schoolId, teacher), otherArm),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("roster: arm in ANOTHER tenant → 404 (RLS makes it invisible)", async () => {
    const schoolA = await makeSchool("roster-xt-a");
    const teacherA = await grantSystemRole(schoolA, "roster-xt-a", "teacher");
    const schoolB = await makeSchool("roster-xt-b");
    const armB = await makeArm(schoolB, "xtb"); // arm lives in school B

    // teacherA (school A) asks for school B's arm — invisible → 404.
    await expect(
      scopeService.getMyArmRoster(ctx(schoolA, teacherA), armB),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("roster: unknown arm id → 404", async () => {
    const schoolId = await makeSchool("roster-nf");
    const teacher = await grantSystemRole(schoolId, "roster-nf", "teacher");
    await expect(
      scopeService.getMyArmRoster(ctx(schoolId, teacher), FAKE_ARM_ID),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // =====================================================================
  // Admin CRUD stays closed to teachers
  // =====================================================================

  it("teacher hitting admin CRUD (POST /teacher-assignments) → 403", async () => {
    const schoolId = await makeSchool("crud-403");
    const teacher = await grantSystemRole(schoolId, "crud-403", "teacher");
    const subject = await makeSubject(schoolId, "c");
    const arm = await makeArm(schoolId, "c");
    const { yearId } = await makeYear(schoolId, "c");

    // The role gate runs before any body validation — a teacher is rejected
    // outright with 403 regardless of the (otherwise valid) payload.
    await expect(
      assignmentsService.create(
        ctx(schoolId, teacher),
        {
          teacherId: teacher,
          classArmId: arm,
          subjectId: subject,
          academicYearId: yearId,
        },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
