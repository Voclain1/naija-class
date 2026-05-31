import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, NotFoundError, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { TeacherAssignmentsService } from "./teacher-assignments.service";

// Integration spec — real DB, real RLS, real audit. Mirrors the slice-9
// EnrollmentsService / slice-10 TeacherProfilesService shape. Depends on the
// minimal `teacher` system role seeded by slice 10's migration (without it,
// makeTeacher's role grant — and the service's assertUserIsTeacher — have
// nothing to point at).
//
// cp1 scope: ADMIN CRUD only. The teacher-scope filter (a teacher seeing only
// their own arms) is cp2 and is NOT exercised here.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23499${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

const FAKE_ID = "00000000-0000-4000-8000-000000000000";

interface SchoolFixture {
  schoolId: string;
  ownerId: string;
  ownerCtx: { sessionId: string; userId: string; schoolId: string };
  teacherId: string;
  classArmId: string;
  subjectId: string;
  academicYearId: string;
  termId: string;
}

describe("TeacherAssignmentsService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const service = new TeacherAssignmentsService();
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // Create a user in this school and grant the system `teacher` role. The role
  // lookup uses basePrisma because `roles` has no RLS (system roles are shared
  // across tenants, school_id IS NULL). Mirrors the slice-10 spec's helper.
  async function makeTeacher(schoolId: string, suffix: string): Promise<string> {
    const teacherRole = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key: "teacher", isSystem: true },
      select: { id: true },
    });
    return withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: {
          schoolId,
          email: `ta-teacher-${suffix}-${runId}@example.test`,
          firstName: "Tunde",
          lastName: `Teacher-${suffix}`,
        },
        select: { id: true },
      });
      await db.userRole.create({
        data: { userId: user.id, roleId: teacherRole.id },
      });
      return user.id;
    });
  }

  // Create a regular (non-teacher) user for the not-a-teacher validation case.
  async function makeNonTeacher(
    schoolId: string,
    suffix: string,
  ): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: {
          schoolId,
          email: `ta-plain-${suffix}-${runId}@example.test`,
          firstName: "Plain",
          lastName: `User-${suffix}`,
        },
        select: { id: true },
      });
      return user.id;
    });
  }

  async function fixture(suffix: string): Promise<SchoolFixture> {
    const signed = await authService.signupOwner(
      {
        schoolName: `Assign Spec ${suffix}`,
        schoolSlug: `asg-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `asg-${suffix}-${runId}@example.test`,
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
    const teacherId = await makeTeacher(schoolId, suffix);

    return withTenant(schoolId, async (db) => {
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
        select: { id: true },
      });
      const subject = await db.subject.create({
        data: { schoolId, name: `Maths ${suffix}`, code: `math-${suffix}-${runId}` },
        select: { id: true },
      });
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `2025/26-${suffix}`,
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
        },
        select: { id: true },
      });
      return {
        schoolId,
        ownerId: signed.user.id,
        ownerCtx: {
          sessionId: "sess-placeholder",
          userId: signed.user.id,
          schoolId,
        },
        teacherId,
        classArmId: arm.id,
        subjectId: subject.id,
        academicYearId: year.id,
        termId: term.id,
      };
    });
  }

  function base(f: SchoolFixture) {
    return {
      teacherId: f.teacherId,
      classArmId: f.classArmId,
      subjectId: f.subjectId,
      academicYearId: f.academicYearId,
    };
  }

  // -----------------------------------------------------------------------
  // create — happy paths
  // -----------------------------------------------------------------------
  describe("create (happy path)", () => {
    it("creates a whole-year assignment (termId null) and writes audit", async () => {
      const f = await fixture("create-ok");
      const result = await service.create(f.ownerCtx, base(f), reqCtx);

      expect(result).toMatchObject({
        teacherId: f.teacherId,
        classArmId: f.classArmId,
        subjectId: f.subjectId,
        academicYearId: f.academicYearId,
        termId: null,
        isActive: true,
      });

      const audit = await withTenant(f.schoolId, (db) =>
        db.auditLog.findFirst({
          where: { action: "teacher-assignment.create", entityId: result.id },
        }),
      );
      expect(audit).toBeTruthy();
      const meta = audit?.metadata as Record<string, unknown>;
      expect(meta).toMatchObject({
        teacherId: f.teacherId,
        classArmId: f.classArmId,
        subjectId: f.subjectId,
        academicYearId: f.academicYearId,
        termId: null,
      });
    });

    it("creates a term-specific assignment when termId belongs to the year", async () => {
      const f = await fixture("create-term");
      const result = await service.create(
        f.ownerCtx,
        { ...base(f), termId: f.termId },
        reqCtx,
      );
      expect(result.termId).toBe(f.termId);
    });
  });

  // -----------------------------------------------------------------------
  // create — validation
  // -----------------------------------------------------------------------
  describe("create (validation)", () => {
    it("rejects an unknown teacherId (ValidationError not_found)", async () => {
      const f = await fixture("v-teacher-nf");
      await expect(
        service.create(f.ownerCtx, { ...base(f), teacherId: FAKE_ID }, reqCtx),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects a user that does not hold the teacher role", async () => {
      const f = await fixture("v-not-teacher");
      const plain = await makeNonTeacher(f.schoolId, "v-not-teacher");
      await expect(
        service.create(f.ownerCtx, { ...base(f), teacherId: plain }, reqCtx),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects unknown classArmId / subjectId / academicYearId with NotFoundError", async () => {
      const f = await fixture("v-fk-nf");
      await expect(
        service.create(f.ownerCtx, { ...base(f), classArmId: FAKE_ID }, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        service.create(f.ownerCtx, { ...base(f), subjectId: FAKE_ID }, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        service.create(
          f.ownerCtx,
          { ...base(f), academicYearId: FAKE_ID },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rejects a termId that belongs to a different year (TERM_YEAR_MISMATCH)", async () => {
      const f = await fixture("v-term-mismatch");
      // A second year + its own term — the term is valid but not in f.academicYearId.
      const otherTermId = await withTenant(f.schoolId, async (db) => {
        const otherYear = await db.academicYear.create({
          data: {
            schoolId: f.schoolId,
            label: `2026/27-v-term-mismatch`,
            startDate: new Date("2026-09-01"),
            endDate: new Date("2027-07-31"),
          },
          select: { id: true },
        });
        const otherTerm = await db.term.create({
          data: {
            schoolId: f.schoolId,
            academicYearId: otherYear.id,
            sequence: 1,
            name: "First Term",
            startDate: new Date("2026-09-01"),
            endDate: new Date("2026-12-15"),
          },
          select: { id: true },
        });
        return otherTerm.id;
      });

      await expect(
        service.create(
          f.ownerCtx,
          { ...base(f), termId: otherTermId },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "TERM_YEAR_MISMATCH" });
    });
  });

  // -----------------------------------------------------------------------
  // duplicate guard + co-teaching
  // -----------------------------------------------------------------------
  describe("duplicate + co-teaching", () => {
    it("rejects the same teacher assigned twice (whole-year / null term) — the NULL-term gap the DB unique misses", async () => {
      const f = await fixture("dup-null");
      await service.create(f.ownerCtx, base(f), reqCtx);
      await expect(
        service.create(f.ownerCtx, base(f), reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("rejects the same teacher assigned twice (term-specific)", async () => {
      const f = await fixture("dup-term");
      await service.create(f.ownerCtx, { ...base(f), termId: f.termId }, reqCtx);
      await expect(
        service.create(f.ownerCtx, { ...base(f), termId: f.termId }, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("ALLOWS co-teaching: a different teacher on the same arm+subject+year", async () => {
      const f = await fixture("co-teach");
      const second = await makeTeacher(f.schoolId, "co-teach-2");
      await service.create(f.ownerCtx, base(f), reqCtx);
      const result = await service.create(
        f.ownerCtx,
        { ...base(f), teacherId: second },
        reqCtx,
      );
      expect(result.teacherId).toBe(second);
    });

    it("allows re-assigning after the prior assignment is deactivated", async () => {
      const f = await fixture("dup-after-deactivate");
      const first = await service.create(f.ownerCtx, base(f), reqCtx);
      await service.update(f.ownerCtx, first.id, { isActive: false }, reqCtx);
      // Same tuple, but the prior is inactive — pre-check is scoped to active.
      const again = await service.create(f.ownerCtx, base(f), reqCtx);
      expect(again.id).not.toBe(first.id);
      expect(again.isActive).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // update + delete
  // -----------------------------------------------------------------------
  describe("update (toggle isActive)", () => {
    it("deactivates and reactivates, writing audit each time", async () => {
      const f = await fixture("update");
      const created = await service.create(f.ownerCtx, base(f), reqCtx);

      const off = await service.update(
        f.ownerCtx,
        created.id,
        { isActive: false },
        reqCtx,
      );
      expect(off.isActive).toBe(false);

      const on = await service.update(
        f.ownerCtx,
        created.id,
        { isActive: true },
        reqCtx,
      );
      expect(on.isActive).toBe(true);

      const audits = await withTenant(f.schoolId, (db) =>
        db.auditLog.findMany({
          where: { action: "teacher-assignment.update", entityId: created.id },
        }),
      );
      expect(audits.length).toBe(2);
    });
  });

  describe("delete", () => {
    it("removes the row and writes audit", async () => {
      const f = await fixture("delete");
      const created = await service.create(f.ownerCtx, base(f), reqCtx);
      await service.delete(f.ownerCtx, created.id, reqCtx);

      const row = await withTenant(f.schoolId, (db) =>
        db.teacherAssignment.findUnique({ where: { id: created.id } }),
      );
      expect(row).toBeNull();

      const audit = await withTenant(f.schoolId, (db) =>
        db.auditLog.findFirst({
          where: { action: "teacher-assignment.delete", entityId: created.id },
        }),
      );
      expect(audit).toBeTruthy();
    });

    it("404s on an unknown id", async () => {
      const f = await fixture("delete-nf");
      await expect(
        service.delete(f.ownerCtx, FAKE_ID, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // list + cross-tenant isolation
  // -----------------------------------------------------------------------
  describe("list + cross-tenant", () => {
    it("lists a school's assignments and filters by teacherId", async () => {
      const f = await fixture("list");
      const created = await service.create(f.ownerCtx, base(f), reqCtx);
      const res = await service.list(f.ownerCtx, { teacherId: f.teacherId });
      expect(res.data.map((a) => a.id)).toContain(created.id);
    });

    it("a different school's owner cannot findById this school's assignment (NotFound via RLS)", async () => {
      const a = await fixture("xtenant-a");
      const b = await fixture("xtenant-b");
      const created = await service.create(a.ownerCtx, base(a), reqCtx);
      // b's owner queries a's assignment id — RLS hides it, service 404s.
      await expect(
        service.findById(b.ownerCtx, created.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
