import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { AuthService } from "../auth/auth.service.js";
import { EnrollmentsService } from "./enrollments.service.js";

// REPRODUCTION of the 2026-08-25 carry-over incident. Written during
// diagnosis, BEFORE any fix, so the root cause is demonstrated rather than
// only read off the source. Nothing here changes product behaviour.
//
// See docs/runbooks/carry-over-incident-2026-08-25.md for the full writeup.
//
// The defect itself lives in the WEB wizard
// (apps/web/src/app/(admin)/enrollments/bulk/page.tsx): its third candidate
// group, "admitted after term 1", is school-wide by design — a mid-year
// admission has no arm yet, so there is nothing to filter on — and its only
// real filter is `Student.admittedAt > sourceTerm.endDate`. Because
// `admittedAt` defaults to now(), a recently-onboarded school has EVERY
// student pass that filter, pre-ticked.
//
// That logic is React code and cannot be exercised here. What CAN be
// exercised, and what actually matters, is the consequence: given the
// studentIds array the wizard produces, does the API do what was reported?
// These two tests answer that against real Postgres.
//
// Both currently PASS, which is the point — the API is behaving exactly as
// designed. There is no server-side bug to fix; the server faithfully enrols
// whoever it is handed, and the second run's silent no-op is the documented
// idempotency contract meeting a term-scoped uniqueness rule.

const SOURCE_START = new Date("2025-09-01");
const SOURCE_END = new Date("2025-12-15");
const TARGET_START = new Date("2026-01-05");
const TARGET_END = new Date("2026-04-10");

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23492${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

describe("carry-over incident (2026-08-25) — reproduction", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const enrollments = new EnrollmentsService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // A school shaped like the pilot: two arms, a finished source term, a target
  // term, and students whose admittedAt is AFTER the source term ended —
  // which is simply what "@default(now()) on a school onboarded this year"
  // produces.
  // `tag` keeps each seed's owner email and slug unique — signupOwner is
  // globally unique on email, so two calls in one file collide otherwise.
  async function seed(tag: string) {
    const signed = await auth.signupOwner(
      {
        schoolName: `Carry ${tag} ${runId}`,
        schoolSlug: `carry-${tag}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `carry-${tag}-${runId}@example.test`,
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

    return withTenant(schoolId, async (db) => {
      const level = await db.classLevel.findFirstOrThrow({
        where: { schoolId },
        orderBy: { orderIndex: "asc" },
      });
      const armA = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "JSS1 A", code: `a-${tag}-${runId}` },
        select: { id: true, name: true },
      });
      const armB = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "JSS3 main", code: `b-${tag}-${runId}` },
        select: { id: true, name: true },
      });
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${tag}-${runId}`, startDate: SOURCE_START, endDate: TARGET_END },
        select: { id: true },
      });
      const source = await db.term.create({
        data: {
          schoolId, academicYearId: year.id, sequence: 1, name: "First Term",
          startDate: SOURCE_START, endDate: SOURCE_END, isCurrent: false,
        },
        select: { id: true },
      });
      const target = await db.term.create({
        data: {
          schoolId, academicYearId: year.id, sequence: 2, name: "Second Term",
          startDate: TARGET_START, endDate: TARGET_END, isCurrent: true,
        },
        select: { id: true },
      });

      // Six students, all admitted AFTER the source term ended. Three were in
      // arm A last term, three in arm B.
      const admittedAt = new Date("2026-01-02");
      const made: Array<{ id: string; arm: string }> = [];
      for (let i = 0; i < 6; i += 1) {
        const arm = i < 3 ? armA : armB;
        const student = await db.student.create({
          data: {
            schoolId,
            admissionNumber: `CARRY-${tag}-${i}-${runId}`,
            firstName: "Stu",
            lastName: `N${i}`,
            dateOfBirth: new Date("2013-05-10"),
            gender: "FEMALE",
            admittedAt,
          },
          select: { id: true },
        });
        await db.enrollment.create({
          data: {
            schoolId, studentId: student.id, termId: source.id,
            academicYearId: year.id, classArmId: arm.id,
            status: "ENROLLED", enrolledAt: SOURCE_START,
          },
        });
        made.push({ id: student.id, arm: arm.name });
      }

      return {
        schoolId, ownerId: signed.user.id, yearId: year.id,
        sourceTermId: source.id, targetTermId: target.id,
        armA, armB, students: made,
      };
    });
  }

  it("REPRODUCES symptom 1: the whole school lands in one arm", async () => {
    const s = await seed("one");

    // The precondition that makes the wizard's group (c) swallow the school:
    // every ACTIVE student was admitted after the source term ended. Asserted
    // rather than assumed, because it is the entire trigger.
    const students = await withTenant(s.schoolId, (db) =>
      db.student.findMany({ where: { status: "ACTIVE" }, select: { id: true, admittedAt: true } }),
    );
    expect(students).toHaveLength(6);
    for (const st of students) {
      expect(st.admittedAt.getTime()).toBeGreaterThan(SOURCE_END.getTime());
    }

    // What the wizard sends when the operator clicks "Carry over" on JSS3 main
    // and leaves the pre-ticked boxes alone: EVERY student, not just arm B's.
    const result = await enrollments.bulkCreate(
      ctx(s.schoolId, s.ownerId),
      {
        termId: s.targetTermId,
        classArmId: s.armB.id,
        studentIds: students.map((st) => st.id),
      },
      reqCtx,
    );

    expect(result.created).toBe(6);

    // All six now sit in JSS3 main for the target term — including the three
    // whose real placement is JSS1 A. This is the reported symptom, exactly.
    const rows = await withTenant(s.schoolId, (db) =>
      db.enrollment.findMany({
        where: { termId: s.targetTermId },
        select: { studentId: true, classArmId: true },
      }),
    );
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.classArmId))).toEqual(new Set([s.armB.id]));

    // And the SOURCE term is untouched — the three-and-three split survives,
    // which is what makes the correct placement recoverable from the database.
    const sourceRows = await withTenant(s.schoolId, (db) =>
      db.enrollment.findMany({
        where: { termId: s.sourceTermId },
        select: { classArmId: true },
      }),
    );
    expect(sourceRows.filter((r) => r.classArmId === s.armA.id)).toHaveLength(3);
    expect(sourceRows.filter((r) => r.classArmId === s.armB.id)).toHaveLength(3);
  });

  it("REPRODUCES symptom 2: the next arm's carry-over silently does nothing", async () => {
    const s = await seed("two");
    const students = await withTenant(s.schoolId, (db) =>
      db.student.findMany({ where: { status: "ACTIVE" }, select: { id: true } }),
    );

    // First run — everyone into JSS3 main, as above.
    await enrollments.bulkCreate(
      ctx(s.schoolId, s.ownerId),
      { termId: s.targetTermId, classArmId: s.armB.id, studentIds: students.map((x) => x.id) },
      reqCtx,
    );

    // Now the operator clicks "Carry over" on JSS1 A, whose button is still
    // showing (its own arm has no target-term rows), and confirms.
    const second = await enrollments.bulkCreate(
      ctx(s.schoolId, s.ownerId),
      {
        termId: s.targetTermId,
        classArmId: s.armA.id,
        studentIds: s.students.filter((x) => x.arm === "JSS1 A").map((x) => x.id),
      },
      reqCtx,
    );

    // Nothing created, everything skipped — because alreadyEnrolled is keyed on
    // (termId, studentId) with NO arm, and @@unique(schoolId, studentId,
    // termId) allows only one row per student per term. The operator sees a
    // confirmation and no change.
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(3);

    // The three JSS1 A students are still in JSS3 main.
    const stillWrong = await withTenant(s.schoolId, (db) =>
      db.enrollment.count({ where: { termId: s.targetTermId, classArmId: s.armB.id } }),
    );
    expect(stillWrong).toBe(6);
    const armARows = await withTenant(s.schoolId, (db) =>
      db.enrollment.count({ where: { termId: s.targetTermId, classArmId: s.armA.id } }),
    );
    expect(armARows).toBe(0);
  });
});
