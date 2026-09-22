import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { EnrollmentsService } from "./enrollments.service";

// Integration spec — real DB, real RLS, real audit. Mirrors the slice 1+
// existing-spec shape. The slice-9 cp1 plan calls out eight cases this
// spec must cover; see the inline labels.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23499${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

interface SchoolFixture {
  schoolId: string;
  userId: string;
  authCtx: { sessionId: string; userId: string; schoolId: string };
  termId: string;
  academicYearId: string;
  classArmId: string;
  studentIds: string[];
}

describe("EnrollmentsService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const service = new EnrollmentsService();
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // Build a school with: one academic year + one current term, one class
  // arm at the first auto-seeded ClassLevel, and `studentCount` students.
  // The slice-2 signup auto-seeds 14 ClassLevels, so we just pick the
  // first one.
  async function fixture(
    suffix: string,
    studentCount = 0,
  ): Promise<SchoolFixture> {
    const signed = await authService.signupOwner(
      {
        schoolName: `Enrol Spec ${suffix}`,
        schoolSlug: `enr-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `enrol-${suffix}-${runId}@example.test`,
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
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `2025/26-${suffix}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
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
      });
      const level = await db.classLevel.findFirstOrThrow({
        where: { schoolId },
        orderBy: { orderIndex: "asc" },
      });
      const arm = await db.classArm.create({
        data: {
          schoolId,
          classLevelId: level.id,
          name: `${level.name} A`,
          code: `${level.code}-a-${suffix}`,
        },
      });
      const studentIds: string[] = [];
      for (let i = 0; i < studentCount; i++) {
        const s = await db.student.create({
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
        studentIds.push(s.id);
      }
      return {
        schoolId,
        userId,
        authCtx: { sessionId: "sess-placeholder", userId, schoolId },
        termId: term.id,
        academicYearId: year.id,
        classArmId: arm.id,
        studentIds,
      };
    });
  }

  // -----------------------------------------------------------------------
  // D39 — move to another class, same term (POST /enrollments/:id/move)
  // -----------------------------------------------------------------------

  describe("move (D39)", () => {
    async function secondArm(f: SchoolFixture, sameLevel: boolean): Promise<string> {
      return withTenant(f.schoolId, async (db) => {
        const first = await db.classArm.findUniqueOrThrow({ where: { id: f.classArmId }, select: { classLevelId: true } });
        const level = sameLevel
          ? await db.classLevel.findUniqueOrThrow({ where: { id: first.classLevelId } })
          : await db.classLevel.findFirstOrThrow({ where: { schoolId: f.schoolId, id: { not: first.classLevelId } }, orderBy: { orderIndex: "asc" } });
        const arm = await db.classArm.create({
          data: { schoolId: f.schoolId, classLevelId: level.id, name: `${level.name} B`, code: `${level.code}-b-${runId}-${Math.random().toString(36).slice(2, 6)}` },
        });
        return arm.id;
      });
    }

    async function enrol(f: SchoolFixture, studentId: string): Promise<string> {
      const e = await service.create(f.authCtx, { studentId, termId: f.termId, classArmId: f.classArmId }, reqCtx);
      return e.id;
    }

    // One subject, three component marks, the per-subject assessment row,
    // and a DRAFT report card — the records a child has mid-term.
    async function giveRecords(f: SchoolFixture, studentId: string, cardStatus: "DRAFT" | "FORM_REVIEWED" = "DRAFT") {
      await withTenant(f.schoolId, async (db) => {
        const subject = await db.subject.create({
          data: { schoolId: f.schoolId, name: `Maths ${runId}`, code: `m-${runId}-${Math.random().toString(36).slice(2, 6)}` },
        });
        const components = await db.gradingComponent.findMany({ select: { id: true } });
        for (const c of components.slice(0, 3)) {
          await db.assessmentScore.create({
            data: { schoolId: f.schoolId, studentId, subjectId: subject.id, termId: f.termId, componentId: c.id, score: 10, enteredBy: f.userId },
          });
        }
        await db.assessment.create({
          data: {
            schoolId: f.schoolId, studentId, subjectId: subject.id, termId: f.termId, academicYearId: f.academicYearId,
            classArmId: f.classArmId, totalScore: 30, subjectPosition: 1, classPosition: 1, computedAt: new Date(), positionsComputedAt: new Date(),
          },
        });
        await db.reportCard.create({
          data: { schoolId: f.schoolId, studentId, termId: f.termId, academicYearId: f.academicYearId, classArmId: f.classArmId, status: cardStatus },
        });
      });
    }

    async function moveAudits(f: SchoolFixture, enrollmentId: string): Promise<number> {
      return withTenant(f.schoolId, (db) =>
        db.auditLog.count({ where: { action: "enrollment.move-class", entityId: enrollmentId } }),
      );
    }

    it("moves a child with no records on confirmation alone — no password needed", async () => {
      const f = await fixture("mv-plain", 1);
      const to = await secondArm(f, true);
      const id = await enrol(f, f.studentIds[0]!);

      const result = await service.move(f.authCtx, id, { classArmId: to }, reqCtx);

      expect(result.enrollment.classArmId).toBe(to);
      expect(result).toMatchObject({ assessmentsMoved: 0, reportCardDiscarded: false, invoiceNeedsReview: false });
      expect(await moveAudits(f, id)).toBe(1);
    });

    it("with records and no password: 409 MOVE_NEEDS_PASSWORD, saying what would change, and nothing moves", async () => {
      const f = await fixture("mv-nopw", 1);
      const to = await secondArm(f, true);
      const id = await enrol(f, f.studentIds[0]!);
      await giveRecords(f, f.studentIds[0]!);

      await expect(service.move(f.authCtx, id, { classArmId: to }, reqCtx)).rejects.toMatchObject({
        code: "MOVE_NEEDS_PASSWORD",
        details: { markCount: 3, hasReportCard: true },
      });
      const row = await withTenant(f.schoolId, (db) => db.enrollment.findUniqueOrThrow({ where: { id } }));
      expect(row.classArmId).toBe(f.classArmId);
      expect(await moveAudits(f, id)).toBe(0);
    });

    it("a WRONG password is 403 PASSWORD_INCORRECT (never 401), and nothing moves", async () => {
      const f = await fixture("mv-badpw", 1);
      const to = await secondArm(f, true);
      const id = await enrol(f, f.studentIds[0]!);
      await giveRecords(f, f.studentIds[0]!);

      const err = await service.move(f.authCtx, id, { classArmId: to, currentPassword: "not-it" }, reqCtx).catch((e) => e);
      expect(err).toMatchObject({ code: "PASSWORD_INCORRECT", httpStatus: 403 });
      const state = await withTenant(f.schoolId, async (db) => ({
        arm: (await db.enrollment.findUniqueOrThrow({ where: { id } })).classArmId,
        cards: await db.reportCard.count({ where: { studentId: f.studentIds[0]!, termId: f.termId } }),
      }));
      expect(state).toEqual({ arm: f.classArmId, cards: 1 });
    });

    it("the right password carries marks across, clears positions, discards the DRAFT card, and audits once", async () => {
      const f = await fixture("mv-ok", 1);
      const to = await secondArm(f, true);
      const student = f.studentIds[0]!;
      const id = await enrol(f, student);
      await giveRecords(f, student);

      const result = await service.move(f.authCtx, id, { classArmId: to, currentPassword: "Correct-Horse-9" }, reqCtx);

      expect(result).toMatchObject({ assessmentsMoved: 1, reportCardDiscarded: true, invoiceNeedsReview: false });
      const state = await withTenant(f.schoolId, async (db) => ({
        scores: await db.assessmentScore.count({ where: { studentId: student, termId: f.termId } }),
        assessment: await db.assessment.findFirstOrThrow({
          where: { studentId: student, termId: f.termId },
          select: { classArmId: true, totalScore: true, subjectPosition: true, classPosition: true },
        }),
        cards: await db.reportCard.count({ where: { studentId: student, termId: f.termId } }),
        audit: await db.auditLog.findFirstOrThrow({ where: { action: "enrollment.move-class", entityId: id }, select: { metadata: true } }),
      }));
      // Nothing a teacher entered is lost.
      expect(state.scores).toBe(3);
      expect(state.assessment).toEqual({ classArmId: to, totalScore: 30, subjectPosition: null, classPosition: null });
      expect(state.cards).toBe(0);
      expect(state.audit.metadata).toMatchObject({ fromArmId: f.classArmId, toArmId: to, passwordConfirmed: true, marksCarried: 3 });
      expect(await moveAudits(f, id)).toBe(1);
    });

    it("refuses when the report card is past DRAFT, even with the right password", async () => {
      const f = await fixture("mv-review", 1);
      const to = await secondArm(f, true);
      const id = await enrol(f, f.studentIds[0]!);
      await giveRecords(f, f.studentIds[0]!, "FORM_REVIEWED");

      await expect(
        service.move(f.authCtx, id, { classArmId: to, currentPassword: "Correct-Horse-9" }, reqCtx),
      ).rejects.toMatchObject({ code: "REPORT_CARD_IN_PROGRESS" });
    });

    it("flags the invoice for review when the class LEVEL changes, and never touches it", async () => {
      const f = await fixture("mv-level", 1);
      const to = await secondArm(f, false);
      const student = f.studentIds[0]!;
      const id = await enrol(f, student);
      const invoiceBefore = await withTenant(f.schoolId, (db) =>
        db.invoice.create({
          data: {
            schoolId: f.schoolId, studentId: student, termId: f.termId, academicYearId: f.academicYearId, classArmId: f.classArmId,
            status: "ISSUED", items: [], totalAmount: 5_000_00, totalDiscount: 0, totalDue: 5_000_00, issuedAt: new Date(), issuedBy: f.userId,
          },
        }),
      );

      const result = await service.move(f.authCtx, id, { classArmId: to }, reqCtx);

      expect(result.invoiceNeedsReview).toBe(true);
      const invoiceAfter = await withTenant(f.schoolId, (db) => db.invoice.findUniqueOrThrow({ where: { id: invoiceBefore.id } }));
      expect(invoiceAfter.totalDue).toBe(invoiceBefore.totalDue);
      expect(invoiceAfter.classArmId).toBe(f.classArmId);
    });

    it("refuses the same class and a withdrawn enrolment", async () => {
      const f = await fixture("mv-refuse", 1);
      const id = await enrol(f, f.studentIds[0]!);
      await expect(service.move(f.authCtx, id, { classArmId: f.classArmId }, reqCtx)).rejects.toMatchObject({ code: "SAME_CLASS_ARM" });

      const to = await secondArm(f, true);
      await service.update(f.authCtx, id, { status: "WITHDRAWN" }, reqCtx);
      await expect(service.move(f.authCtx, id, { classArmId: to }, reqCtx)).rejects.toMatchObject({ code: "ENROLLMENT_NOT_ACTIVE" });
    });

    it("a bare PATCH can no longer split a child's records across two classes", async () => {
      const f = await fixture("mv-patch", 1);
      const to = await secondArm(f, true);
      const id = await enrol(f, f.studentIds[0]!);

      // No records yet: PATCH still works as before.
      await service.update(f.authCtx, id, { classArmId: to }, reqCtx);
      await service.update(f.authCtx, id, { classArmId: f.classArmId }, reqCtx);

      await giveRecords(f, f.studentIds[0]!);
      await expect(service.update(f.authCtx, id, { classArmId: to }, reqCtx)).rejects.toMatchObject({
        code: "ENROLLMENT_HAS_TERM_RECORDS",
      });
      // A status-only PATCH is unaffected.
      await expect(service.update(f.authCtx, id, { notes: "checked" }, reqCtx)).resolves.toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Case 1 — happy paths for create, update (status flip), delete
  // -----------------------------------------------------------------------

  describe("create (happy path)", () => {
    it("creates an enrollment with status=ENROLLED and writes audit", async () => {
      const f = await fixture("create-ok", 1);
      const result = await service.create(
        f.authCtx,
        {
          studentId: f.studentIds[0],
          termId: f.termId,
          classArmId: f.classArmId,
        },
        reqCtx,
      );

      expect(result).toMatchObject({
        studentId: f.studentIds[0],
        termId: f.termId,
        academicYearId: f.academicYearId, // server-resolved from term
        classArmId: f.classArmId,
        status: "ENROLLED",
      });

      const audit = await withTenant(f.schoolId, (db) =>
        db.auditLog.findFirst({
          where: { action: "enrollment.create", entityId: result.id },
        }),
      );
      expect(audit).toBeTruthy();
      const meta = audit?.metadata as Record<string, unknown>;
      expect(meta).toMatchObject({
        studentId: f.studentIds[0],
        termId: f.termId,
        classArmId: f.classArmId,
        status: "ENROLLED",
      });
    });

    it("rejects an unknown studentId / termId / classArmId with NotFoundError", async () => {
      const f = await fixture("create-nf", 1);
      const fakeId = "00000000-0000-4000-8000-000000000000";
      await expect(
        service.create(
          f.authCtx,
          { studentId: fakeId, termId: f.termId, classArmId: f.classArmId },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        service.create(
          f.authCtx,
          { studentId: f.studentIds[0], termId: fakeId, classArmId: f.classArmId },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        service.create(
          f.authCtx,
          { studentId: f.studentIds[0], termId: f.termId, classArmId: fakeId },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("update (status flip)", () => {
    it("flips ENROLLED → WITHDRAWN and stamps withdrawnAt; flipping back clears it", async () => {
      const f = await fixture("update", 1);
      const enr = await service.create(
        f.authCtx,
        {
          studentId: f.studentIds[0],
          termId: f.termId,
          classArmId: f.classArmId,
        },
        reqCtx,
      );

      const withdrawn = await service.update(
        f.authCtx,
        enr.id,
        { status: "WITHDRAWN" },
        reqCtx,
      );
      expect(withdrawn.status).toBe("WITHDRAWN");
      expect(withdrawn.withdrawnAt).not.toBeNull();

      const back = await service.update(
        f.authCtx,
        enr.id,
        { status: "ENROLLED" },
        reqCtx,
      );
      expect(back.status).toBe("ENROLLED");
      expect(back.withdrawnAt).toBeNull();
    });
  });

  describe("delete", () => {
    it("removes the row and writes audit", async () => {
      const f = await fixture("delete", 1);
      const enr = await service.create(
        f.authCtx,
        {
          studentId: f.studentIds[0],
          termId: f.termId,
          classArmId: f.classArmId,
        },
        reqCtx,
      );
      await service.delete(f.authCtx, enr.id, reqCtx);
      const row = await withTenant(f.schoolId, (db) =>
        db.enrollment.findUnique({ where: { id: enr.id } }),
      );
      expect(row).toBeNull();
      const audit = await withTenant(f.schoolId, (db) =>
        db.auditLog.findFirst({
          where: { action: "enrollment.delete", entityId: enr.id },
        }),
      );
      expect(audit).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Case 2 — (schoolId, studentId, termId) collision → 409
  // -----------------------------------------------------------------------

  describe("(schoolId, studentId, termId) collision", () => {
    it("rejects a second enrollment for the same (student, term) with 409", async () => {
      const f = await fixture("dup", 1);
      await service.create(
        f.authCtx,
        {
          studentId: f.studentIds[0],
          termId: f.termId,
          classArmId: f.classArmId,
        },
        reqCtx,
      );
      await expect(
        service.create(
          f.authCtx,
          {
            studentId: f.studentIds[0],
            termId: f.termId,
            classArmId: f.classArmId,
          },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "ENROLLMENT_ALREADY_EXISTS" });
    });
  });

  // -----------------------------------------------------------------------
  // Case 3 — academicYearId denormalisation invariant.
  //
  // The API never accepts academicYearId; the server resolves it from
  // term.academicYearId at write time. After every write, the
  // enrollment row's academicYearId MUST equal its term's academicYearId.
  // Verified by reading both columns back and comparing.
  // -----------------------------------------------------------------------

  describe("academicYearId denormalisation", () => {
    it("create resolves academicYearId from term; row's value equals term's", async () => {
      const f = await fixture("denorm", 1);
      const created = await service.create(
        f.authCtx,
        {
          studentId: f.studentIds[0],
          termId: f.termId,
          classArmId: f.classArmId,
        },
        reqCtx,
      );
      expect(created.academicYearId).toBe(f.academicYearId);

      const fromDb = await withTenant(f.schoolId, (db) =>
        db.enrollment.findUnique({
          where: { id: created.id },
          include: { term: { select: { academicYearId: true } } },
        }),
      );
      expect(fromDb).not.toBeNull();
      expect(fromDb!.academicYearId).toBe(fromDb!.term.academicYearId);
    });

    it("bulkCreate resolves academicYearId from term; every row matches", async () => {
      const f = await fixture("denorm-bulk", 3);
      await service.bulkCreate(
        f.authCtx,
        {
          termId: f.termId,
          classArmId: f.classArmId,
          studentIds: f.studentIds,
        },
        reqCtx,
      );
      const rows = await withTenant(f.schoolId, (db) =>
        db.enrollment.findMany({
          where: { termId: f.termId },
          include: { term: { select: { academicYearId: true } } },
        }),
      );
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.academicYearId).toBe(row.term.academicYearId);
        expect(row.academicYearId).toBe(f.academicYearId);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Case 4 — bulk-create idempotency: re-running same studentIds skips.
  // -----------------------------------------------------------------------

  describe("bulkCreate idempotency", () => {
    it("re-running with the same payload skips already-enrolled rows", async () => {
      const f = await fixture("bulk-idem", 3);
      const first = await service.bulkCreate(
        f.authCtx,
        {
          termId: f.termId,
          classArmId: f.classArmId,
          studentIds: f.studentIds,
        },
        reqCtx,
      );
      expect(first).toMatchObject({ created: 3, skipped: 0, errors: [] });

      const second = await service.bulkCreate(
        f.authCtx,
        {
          termId: f.termId,
          classArmId: f.classArmId,
          studentIds: f.studentIds,
        },
        reqCtx,
      );
      expect(second).toMatchObject({ created: 0, skipped: 3, errors: [] });

      // No duplicates landed.
      const count = await withTenant(f.schoolId, (db) =>
        db.enrollment.count({ where: { termId: f.termId } }),
      );
      expect(count).toBe(3);
    });

    it("foreign studentIds land in `errors`, not as a thrown 409", async () => {
      const f = await fixture("bulk-fk", 2);
      const result = await service.bulkCreate(
        f.authCtx,
        {
          termId: f.termId,
          classArmId: f.classArmId,
          studentIds: [
            f.studentIds[0],
            "00000000-0000-4000-8000-000000000000",
            f.studentIds[1],
          ],
        },
        reqCtx,
      );
      expect(result.created).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        studentId: "00000000-0000-4000-8000-000000000000",
        reason: expect.stringContaining("not found"),
      });
    });
  });

  // -----------------------------------------------------------------------
  // Case 5 — cross-tenant RLS isolation.
  //
  // School A creates an enrollment. School B's authCtx must NOT be able
  // to read it (findById → 404 because RLS filters it out and the row
  // appears non-existent from B's perspective).
  // -----------------------------------------------------------------------

  describe("cross-tenant RLS isolation", () => {
    it("School B cannot read or update School A's enrollment", async () => {
      const a = await fixture("rls-a", 1);
      const b = await fixture("rls-b", 0);
      const aEnr = await service.create(
        a.authCtx,
        {
          studentId: a.studentIds[0],
          termId: a.termId,
          classArmId: a.classArmId,
        },
        reqCtx,
      );

      // School B sees nothing in its list.
      const bList = await service.list(b.authCtx, {});
      expect(bList.data).toHaveLength(0);

      // School B's findById on A's enrollment id returns NotFound.
      await expect(
        service.findById(b.authCtx, aEnr.id),
      ).rejects.toBeInstanceOf(NotFoundError);

      // School B's update on A's enrollment id also NotFound.
      await expect(
        service.update(b.authCtx, aEnr.id, { status: "WITHDRAWN" }, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // Case 6 — getCurrentEnrollmentForStudent join shape.
  // -----------------------------------------------------------------------

  describe("getCurrentEnrollmentForStudent", () => {
    it("returns the row for an enrolled student in the current term", async () => {
      const f = await fixture("current", 1);
      const enr = await service.create(
        f.authCtx,
        {
          studentId: f.studentIds[0],
          termId: f.termId,
          classArmId: f.classArmId,
        },
        reqCtx,
      );
      const current = await service.getCurrentEnrollmentForStudent(
        f.authCtx,
        f.studentIds[0],
      );
      expect(current).not.toBeNull();
      expect(current!.id).toBe(enr.id);
      expect(current!.classArm.id).toBe(f.classArmId);
      expect(current!.term.sequence).toBe(1);
    });

    it("returns null for a student with no current-term enrollment", async () => {
      const f = await fixture("current-empty", 1);
      const current = await service.getCurrentEnrollmentForStudent(
        f.authCtx,
        f.studentIds[0],
      );
      expect(current).toBeNull();
    });
  });
});

// Used by createForbiddenError tests further down (eslint-imported earlier).
void ConflictError;
