import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { TeacherProfilesService } from "./teacher-profiles.service";

// Integration spec — real DB, real RLS, real audit. Mirrors the slice-9
// EnrollmentsService spec shape. Depends on the minimal `teacher` system
// role being seeded by slice 10's migration (without it, makeTeacher's role
// grant has nothing to point at).

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
  ownerId: string;
  ownerCtx: { sessionId: string; userId: string; schoolId: string };
}

describe("TeacherProfilesService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const service = new TeacherProfilesService();
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  async function fixture(suffix: string): Promise<SchoolFixture> {
    const signed = await authService.signupOwner(
      {
        schoolName: `Staff Spec ${suffix}`,
        schoolSlug: `staff-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `staff-${suffix}-${runId}@example.test`,
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
    return {
      schoolId: signed.school.id,
      ownerId: signed.user.id,
      ownerCtx: {
        sessionId: "sess-placeholder",
        userId: signed.user.id,
        schoolId: signed.school.id,
      },
    };
  }

  // Create a user in this school and grant the system `teacher` role. Returns
  // the user id. The role lookup uses basePrisma because `roles` has no RLS
  // (system roles are shared across tenants, school_id IS NULL).
  async function makeTeacher(schoolId: string, suffix: string): Promise<string> {
    const teacherRole = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key: "teacher", isSystem: true },
      select: { id: true },
    });
    return withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: {
          schoolId,
          email: `teacher-${suffix}-${runId}@example.test`,
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

  function teacherCtx(schoolId: string, userId: string) {
    return { sessionId: "sess-placeholder", userId, schoolId };
  }

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe("create", () => {
    it("creates a profile for a teacher-role user, embeds the user, writes audit", async () => {
      const f = await fixture("create-ok");
      const teacherId = await makeTeacher(f.schoolId, "create-ok");

      const result = await service.create(
        f.ownerCtx,
        { userId: teacherId, staffNumber: "STAFF/001", specialty: "Mathematics" },
        reqCtx,
      );

      expect(result).toMatchObject({
        userId: teacherId,
        staffNumber: "STAFF/001",
        specialty: "Mathematics",
        qualifications: null,
        nutNumber: null,
      });
      expect(result.user).toMatchObject({
        id: teacherId,
        firstName: "Tunde",
        isActive: true,
      });
      expect(result.joinedAt).toBeTruthy();

      const audit = await withTenant(f.schoolId, (db) =>
        db.auditLog.findFirst({
          where: { action: "teacher-profile.create", entityId: result.id },
        }),
      );
      expect(audit).toBeTruthy();
      expect(audit?.metadata).toMatchObject({
        profileUserId: teacherId,
        staffNumber: "STAFF/001",
      });
    });

    it("rejects a user that does not hold the teacher role (ValidationError not_a_teacher)", async () => {
      const f = await fixture("create-notteacher");
      // The owner is a user but holds the owner role, not teacher.
      await expect(
        service.create(
          f.ownerCtx,
          { userId: f.ownerId, staffNumber: "STAFF/X" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects a second profile for the same user (PROFILE_ALREADY_EXISTS)", async () => {
      const f = await fixture("create-dupuser");
      const teacherId = await makeTeacher(f.schoolId, "dupuser");
      await service.create(
        f.ownerCtx,
        { userId: teacherId, staffNumber: "STAFF/A" },
        reqCtx,
      );
      await expect(
        service.create(
          f.ownerCtx,
          { userId: teacherId, staffNumber: "STAFF/B" },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "PROFILE_ALREADY_EXISTS" });
    });

    it("rejects a duplicate staff number in the same school (STAFF_NUMBER_TAKEN)", async () => {
      const f = await fixture("create-dupstaff");
      const t1 = await makeTeacher(f.schoolId, "dupstaff1");
      const t2 = await makeTeacher(f.schoolId, "dupstaff2");
      await service.create(
        f.ownerCtx,
        { userId: t1, staffNumber: "SHARED/01" },
        reqCtx,
      );
      await expect(
        service.create(
          f.ownerCtx,
          { userId: t2, staffNumber: "SHARED/01" },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "STAFF_NUMBER_TAKEN" });
    });

    it("rejects a userId from another school (RLS returns null → not_found)", async () => {
      const a = await fixture("create-xs-a");
      const b = await fixture("create-xs-b");
      const teacherInB = await makeTeacher(b.schoolId, "xs-b");
      await expect(
        service.create(
          a.ownerCtx,
          { userId: teacherInB, staffNumber: "STAFF/XS" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  // -----------------------------------------------------------------------
  // findById + cross-tenant isolation
  // -----------------------------------------------------------------------
  describe("findById", () => {
    it("returns the profile by id; 404 for unknown id", async () => {
      const f = await fixture("find-ok");
      const teacherId = await makeTeacher(f.schoolId, "find-ok");
      const created = await service.create(
        f.ownerCtx,
        { userId: teacherId, staffNumber: "FIND/01" },
        reqCtx,
      );

      const found = await service.findById(f.ownerCtx, created.id);
      expect(found.id).toBe(created.id);

      await expect(
        service.findById(f.ownerCtx, "00000000-0000-4000-8000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("School B cannot read School A's profile (RLS → 404)", async () => {
      const a = await fixture("iso-a");
      const b = await fixture("iso-b");
      const teacherInA = await makeTeacher(a.schoolId, "iso-a");
      const profA = await service.create(
        a.ownerCtx,
        { userId: teacherInA, staffNumber: "ISO/01" },
        reqCtx,
      );
      await expect(
        service.findById(b.ownerCtx, profA.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // list — search + specialty filter + pagination
  // -----------------------------------------------------------------------
  describe("list", () => {
    it("filters by search (staff number or name) and by specialty", async () => {
      const f = await fixture("list-ok");
      const t1 = await makeTeacher(f.schoolId, "list-math");
      const t2 = await makeTeacher(f.schoolId, "list-eng");
      await service.create(
        f.ownerCtx,
        { userId: t1, staffNumber: "MATH/01", specialty: "Mathematics" },
        reqCtx,
      );
      await service.create(
        f.ownerCtx,
        { userId: t2, staffNumber: "ENG/01", specialty: "English Language" },
        reqCtx,
      );

      const all = await service.list(f.ownerCtx, {});
      expect(all.data.length).toBe(2);

      const byStaff = await service.list(f.ownerCtx, { search: "MATH" });
      expect(byStaff.data.map((p) => p.staffNumber)).toEqual(["MATH/01"]);

      const byName = await service.list(f.ownerCtx, { search: "list-eng" });
      expect(byName.data.map((p) => p.staffNumber)).toEqual(["ENG/01"]);

      const bySpecialty = await service.list(f.ownerCtx, { specialty: "english" });
      expect(bySpecialty.data.map((p) => p.staffNumber)).toEqual(["ENG/01"]);
    });

    it("paginates by cursor", async () => {
      const f = await fixture("list-page");
      for (let i = 0; i < 3; i++) {
        const t = await makeTeacher(f.schoolId, `page-${i}`);
        await service.create(
          f.ownerCtx,
          { userId: t, staffNumber: `PAGE/0${i}` },
          reqCtx,
        );
      }
      const first = await service.list(f.ownerCtx, { limit: 2 });
      expect(first.data.length).toBe(2);
      expect(first.meta.cursor).toBeTruthy();
      const second = await service.list(f.ownerCtx, {
        limit: 2,
        cursor: first.meta.cursor,
      });
      expect(second.data.length).toBe(1);
      expect(second.meta.cursor).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // update (admin)
  // -----------------------------------------------------------------------
  describe("update", () => {
    it("updates admin fields and writes audit (self:false)", async () => {
      const f = await fixture("update-ok");
      const teacherId = await makeTeacher(f.schoolId, "update-ok");
      const created = await service.create(
        f.ownerCtx,
        { userId: teacherId, staffNumber: "UPD/01" },
        reqCtx,
      );

      const updated = await service.update(
        f.ownerCtx,
        created.id,
        { specialty: "Physics", nutNumber: "NUT-123", staffNumber: "UPD/02" },
        reqCtx,
      );
      expect(updated).toMatchObject({
        specialty: "Physics",
        nutNumber: "NUT-123",
        staffNumber: "UPD/02",
      });

      const audit = await withTenant(f.schoolId, (db) =>
        db.auditLog.findFirst({
          where: { action: "teacher-profile.update", entityId: created.id },
        }),
      );
      expect(audit?.metadata).toMatchObject({ self: false });
    });

    it("rejects a staff number that collides with another profile (409)", async () => {
      const f = await fixture("update-collide");
      const t1 = await makeTeacher(f.schoolId, "collide1");
      const t2 = await makeTeacher(f.schoolId, "collide2");
      await service.create(
        f.ownerCtx,
        { userId: t1, staffNumber: "KEEP/01" },
        reqCtx,
      );
      const p2 = await service.create(
        f.ownerCtx,
        { userId: t2, staffNumber: "MOVE/01" },
        reqCtx,
      );
      await expect(
        service.update(f.ownerCtx, p2.id, { staffNumber: "KEEP/01" }, reqCtx),
      ).rejects.toMatchObject({ code: "STAFF_NUMBER_TAKEN" });
    });
  });

  // -----------------------------------------------------------------------
  // delete — soft via User.isActive; profile preserved
  // -----------------------------------------------------------------------
  describe("delete", () => {
    it("deactivates the user but preserves the profile row, writes audit", async () => {
      const f = await fixture("delete-ok");
      const teacherId = await makeTeacher(f.schoolId, "delete-ok");
      const created = await service.create(
        f.ownerCtx,
        { userId: teacherId, staffNumber: "DEL/01" },
        reqCtx,
      );

      await service.delete(f.ownerCtx, created.id, reqCtx);

      const { user, profile } = await withTenant(f.schoolId, async (db) => ({
        user: await db.user.findUnique({
          where: { id: teacherId },
          select: { isActive: true },
        }),
        profile: await db.teacherProfile.findUnique({
          where: { id: created.id },
          select: { id: true },
        }),
      }));
      expect(user?.isActive).toBe(false); // soft-deleted
      expect(profile?.id).toBe(created.id); // row preserved

      const audit = await withTenant(f.schoolId, (db) =>
        db.auditLog.findFirst({
          where: { action: "teacher-profile.delete", entityId: created.id },
        }),
      );
      expect(audit?.metadata).toMatchObject({ softDeleted: true });
    });
  });

  // -----------------------------------------------------------------------
  // self-service — getMine / updateMine
  // -----------------------------------------------------------------------
  describe("self-service (me)", () => {
    it("getMine returns the caller's own profile; 404 when none exists", async () => {
      const f = await fixture("me-get");
      const teacherId = await makeTeacher(f.schoolId, "me-get");

      // Before the admin creates one → 404.
      await expect(
        service.getMine(teacherCtx(f.schoolId, teacherId)),
      ).rejects.toBeInstanceOf(NotFoundError);

      const created = await service.create(
        f.ownerCtx,
        { userId: teacherId, staffNumber: "ME/01", specialty: "Biology" },
        reqCtx,
      );

      const mine = await service.getMine(teacherCtx(f.schoolId, teacherId));
      expect(mine.id).toBe(created.id);
      expect(mine.specialty).toBe("Biology");
    });

    it("updateMine edits the teacher's own bio fields and writes audit (self:true)", async () => {
      const f = await fixture("me-update");
      const teacherId = await makeTeacher(f.schoolId, "me-update");
      const created = await service.create(
        f.ownerCtx,
        { userId: teacherId, staffNumber: "ME/02", specialty: "Chemistry" },
        reqCtx,
      );

      const updated = await service.updateMine(
        teacherCtx(f.schoolId, teacherId),
        { specialty: "Further Maths", qualifications: "B.Sc Ed" },
        reqCtx,
      );
      expect(updated).toMatchObject({
        specialty: "Further Maths",
        qualifications: "B.Sc Ed",
        staffNumber: "ME/02", // unchanged — admin-only field untouched
      });

      const audit = await withTenant(f.schoolId, (db) =>
        db.auditLog.findFirst({
          where: { action: "teacher-profile.update", entityId: created.id },
        }),
      );
      expect(audit?.metadata).toMatchObject({ self: true });
    });
  });
});
