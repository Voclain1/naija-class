import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { PromotionsService } from "./promotions.service";

// Integration spec — real DB, real RLS, real audit. Same shape as
// enrollments.service.spec.ts.
//
// The cases that matter most are the REFUSALS. This module's whole reason for
// existing is that its predecessor enrolled students nobody had selected
// (docs/runbooks/carry-over-incident-2026-08-25.md), so the tests that prove a
// student CANNOT be moved are the ones to read first:
//   - "refuses a student with no source-term enrollment"
//   - "a second commit writes nothing"
//   - "will not graduate without an explicit confirmation"

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23499${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

interface Fixture {
  schoolId: string;
  authCtx: { sessionId: string; userId: string; schoolId: string };
  lastYearTermId: string;
  thisYearTerm1Id: string;
  thisYearTerm2Id: string;
  /** Level 1 arms A and B, level 2 arm A only (level 2 B is the gap). */
  level1Id: string;
  level2Id: string;
  arm1aId: string;
  arm1bId: string;
  arm2aId: string;
  topLevelArmId: string;
  studentIds: string[];
}

describe("PromotionsService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const service = new PromotionsService();
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // A school with two academic years, the ladder's first two levels wired as
  // 1A/1B → 2A (deliberately no 2B, so the arm-gap path is always covered),
  // and four students enrolled in last year's term: three in 1A, one in 1B.
  // A fifth student sits in the TOP level, for the graduation path.
  async function fixture(suffix: string): Promise<Fixture> {
    const signed = await authService.signupOwner(
      {
        schoolName: `Promo Spec ${suffix}`,
        schoolSlug: `promo-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `promo-${suffix}-${runId}@example.test`,
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
    const schoolId = signed.school.id;
    const userId = signed.user.id;

    return withTenant(schoolId, async (db) => {
      const lastYear = await db.academicYear.create({
        data: {
          schoolId,
          label: `2024/25-${suffix}`,
          startDate: new Date("2024-09-01"),
          endDate: new Date("2025-07-31"),
        },
      });
      const thisYear = await db.academicYear.create({
        data: {
          schoolId,
          label: `2025/26-${suffix}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
      });
      const lastYearTerm = await db.term.create({
        data: {
          schoolId,
          academicYearId: lastYear.id,
          sequence: 3,
          name: "Third Term",
          startDate: new Date("2025-04-20"),
          endDate: new Date("2025-07-31"),
        },
      });
      const thisYearTerm1 = await db.term.create({
        data: {
          schoolId,
          academicYearId: thisYear.id,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
          isCurrent: true,
        },
      });
      const thisYearTerm2 = await db.term.create({
        data: {
          schoolId,
          academicYearId: thisYear.id,
          sequence: 2,
          name: "Second Term",
          startDate: new Date("2026-01-10"),
          endDate: new Date("2026-04-05"),
        },
      });

      // signupOwner auto-seeds 14 ClassLevels in ladder order.
      const levels = await db.classLevel.findMany({
        where: { schoolId },
        orderBy: { orderIndex: "asc" },
      });
      const level1 = levels[0];
      const level2 = levels[1];
      const topLevel = levels[levels.length - 1];

      // signupOwner also seeds one "A" arm per level (school-defaults.ts), so
      // the fixture REUSES those and adds only the extra 1B. That is the real
      // shape of a school that opened a second stream in one class and not the
      // next — which is exactly the arm-gap case this module has to handle.
      const seededArm = (classLevelId: string) =>
        db.classArm.findFirstOrThrow({ where: { classLevelId } });

      const arm1a = await seededArm(level1.id);
      const arm2a = await seededArm(level2.id);
      const topArm = await seededArm(topLevel.id);
      const arm1b = await db.classArm.create({
        data: {
          schoolId,
          classLevelId: level1.id,
          name: `${level1.name}B`,
          code: `${level1.code}-b`,
        },
      });

      const studentIds: string[] = [];
      const placements = [arm1a.id, arm1a.id, arm1a.id, arm1b.id, topArm.id];
      for (let i = 0; i < placements.length; i++) {
        const student = await db.student.create({
          data: {
            schoolId,
            admissionNumber: `ADM/${suffix}/${i}-${runId}`,
            firstName: `Stu${i}`,
            lastName: "Pupil",
            dateOfBirth: new Date("2014-03-15"),
            gender: "FEMALE",
          },
          select: { id: true },
        });
        studentIds.push(student.id);
        await db.enrollment.create({
          data: {
            schoolId,
            studentId: student.id,
            termId: lastYearTerm.id,
            academicYearId: lastYear.id,
            classArmId: placements[i],
            status: "ENROLLED",
          },
        });
      }

      return {
        schoolId,
        authCtx: { sessionId: "sess-placeholder", userId, schoolId },
        lastYearTermId: lastYearTerm.id,
        thisYearTerm1Id: thisYearTerm1.id,
        thisYearTerm2Id: thisYearTerm2.id,
        level1Id: level1.id,
        level2Id: level2.id,
        arm1aId: arm1a.id,
        arm1bId: arm1b.id,
        arm2aId: arm2a.id,
        topLevelArmId: topArm.id,
        studentIds,
      };
    });
  }

  // -----------------------------------------------------------------------
  // preview
  // -----------------------------------------------------------------------

  describe("preview — year promotion", () => {
    it("proposes the next level's matching arm, and nothing else", async () => {
      const f = await fixture("prev-ok");
      const preview = await service.preview(f.authCtx, {
        sourceTermId: f.lastYearTermId,
        targetTermId: f.thisYearTerm1Id,
      });

      expect(preview.mode).toBe("YEAR_PROMOTION");
      // Five source enrollments in, five candidates out. This is the
      // structural guarantee: the list is the source term's roster, never
      // the school's student table.
      expect(preview.candidates).toHaveLength(5);
      expect(preview.counts.total).toBe(5);

      const in1a = preview.candidates.filter(
        (c) => c.sourceClassArmId === f.arm1aId,
      );
      expect(in1a).toHaveLength(3);
      for (const row of in1a) {
        expect(row.proposedAction).toBe("PROMOTE");
        expect(row.proposedClassArmId).toBe(f.arm2aId);
        expect(row.destinationClassLevelId).toBe(f.level2Id);
        expect(row.blockReason).toBeNull();
      }
    });

    it("reports one gap per source arm with no destination, not one per student", async () => {
      const f = await fixture("prev-gap");
      const preview = await service.preview(f.authCtx, {
        sourceTermId: f.lastYearTermId,
        targetTermId: f.thisYearTerm1Id,
      });

      // 1B has no matching 2B. One student is affected; one gap is reported.
      expect(preview.gaps).toHaveLength(1);
      const gap = preview.gaps[0];
      expect(gap.sourceClassArmId).toBe(f.arm1bId);
      expect(gap.studentCount).toBe(1);
      expect(gap.destinationClassLevelId).toBe(f.level2Id);
      expect(gap.suggestedArmCode).toMatch(/^[a-z0-9-]+$/);
      // The alternative the admin can pick instead of creating an arm.
      expect(gap.existingDestinationArms.map((a) => a.id)).toContain(f.arm2aId);

      const blocked = preview.candidates.find(
        (c) => c.sourceClassArmId === f.arm1bId,
      );
      expect(blocked?.blockReason).toBe("NO_DESTINATION_ARM");
      expect(blocked?.proposedAction).toBe("EXCLUDE");
    });

    it("proposes GRADUATE at the top of the ladder", async () => {
      const f = await fixture("prev-grad");
      const preview = await service.preview(f.authCtx, {
        sourceTermId: f.lastYearTermId,
        targetTermId: f.thisYearTerm1Id,
      });

      const leaver = preview.candidates.find(
        (c) => c.sourceClassArmId === f.topLevelArmId,
      );
      expect(leaver?.proposedAction).toBe("GRADUATE");
      expect(leaver?.blockReason).toBe("NO_DESTINATION_LEVEL");
      expect(leaver?.destinationClassLevelId).toBeNull();
      expect(preview.counts.graduate).toBe(1);
    });

    it("keeps everyone where they are in a same-year term roll", async () => {
      const f = await fixture("prev-roll");
      await service.commit(
        f.authCtx,
        {
          sourceTermId: f.lastYearTermId,
          targetTermId: f.thisYearTerm1Id,
          decisions: [
            {
              studentId: f.studentIds[0],
              action: "PROMOTE",
              classArmId: f.arm2aId,
            },
          ],
        },
        reqCtx,
      );

      const preview = await service.preview(f.authCtx, {
        sourceTermId: f.thisYearTerm1Id,
        targetTermId: f.thisYearTerm2Id,
      });

      expect(preview.mode).toBe("TERM_ROLL");
      expect(preview.candidates).toHaveLength(1);
      expect(preview.candidates[0].proposedAction).toBe("PROMOTE");
      // Same arm — a term roll is not a promotion.
      expect(preview.candidates[0].proposedClassArmId).toBe(f.arm2aId);
      expect(preview.candidates[0].sourceClassArmId).toBe(f.arm2aId);
    });

    it("refuses to roll backwards in time", async () => {
      const f = await fixture("prev-back");
      await expect(
        service.preview(f.authCtx, {
          sourceTermId: f.thisYearTerm1Id,
          targetTermId: f.lastYearTermId,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  // -----------------------------------------------------------------------
  // commit
  // -----------------------------------------------------------------------

  describe("commit", () => {
    it("enrols into the chosen arm, stamps promotedFromArmId, and closes out the source", async () => {
      const f = await fixture("commit-ok");
      const result = await service.commit(
        f.authCtx,
        {
          sourceTermId: f.lastYearTermId,
          targetTermId: f.thisYearTerm1Id,
          decisions: [
            {
              studentId: f.studentIds[0],
              action: "PROMOTE",
              classArmId: f.arm2aId,
            },
            {
              studentId: f.studentIds[1],
              action: "REPEAT",
              classArmId: f.arm1aId,
            },
            { studentId: f.studentIds[2], action: "EXCLUDE" },
          ],
        },
        reqCtx,
      );

      expect(result).toMatchObject({
        enrolled: 2,
        promoted: 1,
        repeated: 1,
        graduated: 0,
        skipped: 0,
        errors: [],
      });

      const rows = await withTenant(f.schoolId, (db) =>
        db.enrollment.findMany({
          where: { termId: f.thisYearTerm1Id },
          select: { studentId: true, classArmId: true, promotedFromArmId: true },
        }),
      );
      expect(rows).toHaveLength(2);
      const promotedRow = rows.find((r) => r.studentId === f.studentIds[0]);
      expect(promotedRow?.classArmId).toBe(f.arm2aId);
      expect(promotedRow?.promotedFromArmId).toBe(f.arm1aId);
      const repeatedRow = rows.find((r) => r.studentId === f.studentIds[1]);
      expect(repeatedRow?.classArmId).toBe(f.arm1aId);

      const sourceStatuses = await withTenant(f.schoolId, (db) =>
        db.enrollment.findMany({
          where: { termId: f.lastYearTermId },
          select: { studentId: true, status: true },
        }),
      );
      const statusOf = (id: string) =>
        sourceStatuses.find((r) => r.studentId === id)?.status;
      expect(statusOf(f.studentIds[0])).toBe("PROMOTED");
      expect(statusOf(f.studentIds[1])).toBe("REPEATED");
      // Excluded — untouched, still standing in last year's term.
      expect(statusOf(f.studentIds[2])).toBe("ENROLLED");
    });

    it("refuses a student with no source-term enrollment", async () => {
      // The defence against the August incident, expressed at the API rather
      // than in the browser: naming a student id is not enough to move them.
      const f = await fixture("commit-stranger");
      const stranger = await withTenant(f.schoolId, (db) =>
        db.student.create({
          data: {
            schoolId: f.schoolId,
            admissionNumber: `ADM/stranger-${runId}`,
            firstName: "Never",
            lastName: "Enrolled",
            dateOfBirth: new Date("2015-01-01"),
            gender: "MALE",
          },
          select: { id: true },
        }),
      );

      const result = await service.commit(
        f.authCtx,
        {
          sourceTermId: f.lastYearTermId,
          targetTermId: f.thisYearTerm1Id,
          decisions: [
            { studentId: stranger.id, action: "PROMOTE", classArmId: f.arm2aId },
          ],
        },
        reqCtx,
      );

      expect(result.enrolled).toBe(0);
      expect(result.errors).toEqual([
        { studentId: stranger.id, reason: "No enrollment in the source term." },
      ]);

      const rows = await withTenant(f.schoolId, (db) =>
        db.enrollment.count({ where: { termId: f.thisYearTerm1Id } }),
      );
      expect(rows).toBe(0);
    });

    it("a second commit writes nothing", async () => {
      const f = await fixture("commit-idem");
      const payload = {
        sourceTermId: f.lastYearTermId,
        targetTermId: f.thisYearTerm1Id,
        decisions: [
          {
            studentId: f.studentIds[0],
            action: "PROMOTE" as const,
            classArmId: f.arm2aId,
          },
        ],
      };

      const first = await service.commit(f.authCtx, payload, reqCtx);
      const second = await service.commit(f.authCtx, payload, reqCtx);

      expect(first.enrolled).toBe(1);
      expect(second.enrolled).toBe(0);
      expect(second.skipped).toBe(1);

      const count = await withTenant(f.schoolId, (db) =>
        db.enrollment.count({ where: { termId: f.thisYearTerm1Id } }),
      );
      expect(count).toBe(1);
    });

    it("will not graduate without an explicit confirmation", async () => {
      const f = await fixture("commit-grad-unconfirmed");
      await expect(
        service.commit(
          f.authCtx,
          {
            sourceTermId: f.lastYearTermId,
            targetTermId: f.thisYearTerm1Id,
            decisions: [{ studentId: f.studentIds[4], action: "GRADUATE" }],
          },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ValidationError);

      const student = await withTenant(f.schoolId, (db) =>
        db.student.findUniqueOrThrow({
          where: { id: f.studentIds[4] },
          select: { status: true },
        }),
      );
      expect(student.status).toBe("ACTIVE");
    });

    it("graduates the student record and the source enrollment together", async () => {
      const f = await fixture("commit-grad");
      const result = await service.commit(
        f.authCtx,
        {
          sourceTermId: f.lastYearTermId,
          targetTermId: f.thisYearTerm1Id,
          decisions: [{ studentId: f.studentIds[4], action: "GRADUATE" }],
          confirmGraduations: true,
        },
        reqCtx,
      );

      expect(result).toMatchObject({ graduated: 1, enrolled: 0 });

      const student = await withTenant(f.schoolId, (db) =>
        db.student.findUniqueOrThrow({
          where: { id: f.studentIds[4] },
          select: { status: true, graduatedAt: true },
        }),
      );
      expect(student.status).toBe("GRADUATED");
      expect(student.graduatedAt).not.toBeNull();

      const enrollment = await withTenant(f.schoolId, (db) =>
        db.enrollment.findFirstOrThrow({
          where: { termId: f.lastYearTermId, studentId: f.studentIds[4] },
          select: { status: true },
        }),
      );
      expect(enrollment.status).toBe("GRADUATED");
      // A graduating student gets no seat in the new year.
      const count = await withTenant(f.schoolId, (db) =>
        db.enrollment.count({ where: { termId: f.thisYearTerm1Id } }),
      );
      expect(count).toBe(0);
    });

    it("refuses a repeat into a different class level", async () => {
      const f = await fixture("commit-bad-repeat");
      const result = await service.commit(
        f.authCtx,
        {
          sourceTermId: f.lastYearTermId,
          targetTermId: f.thisYearTerm1Id,
          decisions: [
            {
              studentId: f.studentIds[0],
              action: "REPEAT",
              classArmId: f.arm2aId,
            },
          ],
        },
        reqCtx,
      );

      expect(result.enrolled).toBe(0);
      expect(result.errors[0].reason).toContain("same class level");
    });

    it("rejects the same student twice in one payload", async () => {
      const f = await fixture("commit-dupe");
      await expect(
        service.commit(
          f.authCtx,
          {
            sourceTermId: f.lastYearTermId,
            targetTermId: f.thisYearTerm1Id,
            decisions: [
              {
                studentId: f.studentIds[0],
                action: "PROMOTE",
                classArmId: f.arm2aId,
              },
              {
                studentId: f.studentIds[0],
                action: "REPEAT",
                classArmId: f.arm1aId,
              },
            ],
          },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("writes one audit row carrying the whole outcome", async () => {
      const f = await fixture("commit-audit");
      await service.commit(
        f.authCtx,
        {
          sourceTermId: f.lastYearTermId,
          targetTermId: f.thisYearTerm1Id,
          decisions: [
            {
              studentId: f.studentIds[0],
              action: "PROMOTE",
              classArmId: f.arm2aId,
            },
          ],
        },
        reqCtx,
      );

      const audit = await withTenant(f.schoolId, (db) =>
        db.auditLog.findFirst({
          where: { action: "promotion.commit", entityId: f.thisYearTerm1Id },
        }),
      );
      expect(audit).toBeTruthy();
      expect(audit?.metadata).toMatchObject({
        mode: "YEAR_PROMOTION",
        sourceTermId: f.lastYearTermId,
        targetTermId: f.thisYearTerm1Id,
        decisions: 1,
        enrolled: 1,
        promoted: 1,
      });
    });
  });
});
