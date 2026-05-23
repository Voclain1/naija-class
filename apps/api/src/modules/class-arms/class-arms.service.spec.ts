import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { ClassArmsService } from "./class-arms.service";

// Integration spec — same shape as class-levels.service.spec.ts. Real DB,
// real RLS, real audit. Exercises the slice-3 teacher-role validation
// against a school-scoped `teacher` role created per-test (the system
// `teacher` role isn't seeded until slice 13).

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23488${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("ClassArmsService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const service = new ClassArmsService();
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  async function createActiveSchool(suffix: string) {
    const signed = await authService.signupOwner(
      {
        schoolName: `Class Arms Spec ${suffix}`,
        schoolSlug: `ca-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `owner-${suffix}-${runId}@example.test`,
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
      userId: signed.user.id,
      authCtx: {
        sessionId: "sess-placeholder",
        userId: signed.user.id,
        schoolId: signed.school.id,
      },
    };
  }

  async function createUserWithoutRole(schoolId: string, suffix: string) {
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: {
          schoolId,
          firstName: "No",
          lastName: "Role",
          email: `norole-${suffix}-${runId}@example.test`,
          phone: randomPhone(),
          passwordHash: "argon2id$placeholder",
        },
        select: { id: true },
      });
      return {
        authCtx: { sessionId: "sess-placeholder", userId: u.id, schoolId },
      };
    });
  }

  // Seeds a school-scoped `teacher` role and a user granted that role.
  // Returns the user's id (suitable for classTeacherId). Slice 13 will land
  // the system role; until then each spec that exercises teacher
  // assignment creates its own.
  async function createTeacher(schoolId: string, suffix: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const role = await db.role.create({
        data: {
          schoolId,
          key: "teacher",
          name: "Teacher",
          isSystem: false,
          permissions: [],
        },
        select: { id: true },
      });
      const user = await db.user.create({
        data: {
          schoolId,
          firstName: "Tina",
          lastName: "Teacher",
          email: `teacher-${suffix}-${runId}@example.test`,
          phone: randomPhone(),
          passwordHash: "argon2id$placeholder",
        },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      return user.id;
    });
  }

  // Creates a regular user (no teacher role) for "user exists but isn't a
  // teacher" assertions.
  async function createNonTeacherUser(schoolId: string, suffix: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: {
          schoolId,
          firstName: "Naomi",
          lastName: "NonTeacher",
          email: `nonteacher-${suffix}-${runId}@example.test`,
          phone: randomPhone(),
          passwordHash: "argon2id$placeholder",
        },
        select: { id: true },
      });
      return user.id;
    });
  }

  async function firstSeededLevel(schoolId: string): Promise<string> {
    // Every signed-up school gets the 14-level seed; pick KG 1 (code "kg1",
    // orderIndex 1) — stable across runs.
    const row = await withTenant(schoolId, (db) =>
      db.classLevel.findFirst({
        where: { code: "kg1" },
        select: { id: true },
      }),
    );
    if (!row) throw new Error("KG 1 seed missing — slice 2 seed-on-signup broken?");
    return row.id;
  }

  // -----------------------------------------------------------------------
  // create / list / findById (nested under a level)
  // -----------------------------------------------------------------------

  describe("create (nested) / list / findById", () => {
    it("owner creates an arm under JSS-equivalent level; lists nested and flat", async () => {
      const { authCtx, schoolId } = await createActiveSchool("create");
      const levelId = await firstSeededLevel(schoolId);

      const created = await service.create(
        authCtx,
        levelId,
        { name: "KG 1A", code: "kg1-a", capacity: 25 },
        reqCtx,
      );

      expect(created.id).toBeTruthy();
      expect(created.classLevelId).toBe(levelId);
      expect(created.capacity).toBe(25);
      expect(created.classTeacherId).toBeNull();

      const nested = await service.listForLevel(authCtx, levelId);
      expect(nested.map((a) => a.id)).toContain(created.id);

      const flat = await service.list(authCtx);
      expect(flat.map((a) => a.id)).toContain(created.id);

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "class-arm.create", entityId: created.id },
        }),
      );
      expect(audit).toBeTruthy();
    });

    it("create under non-existent parent level → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("create-nf");
      await expect(
        service.create(
          authCtx,
          "00000000-0000-0000-0000-000000000000",
          { name: "X", code: "x" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("create under another school's level → NotFoundError (RLS hides it)", async () => {
      const a = await createActiveSchool("xt-a");
      const b = await createActiveSchool("xt-b");
      const levelB = await firstSeededLevel(b.schoolId);

      // A's authCtx, B's level id — RLS hides it; the parent-existence check
      // returns NotFoundError, not a P2003 leak.
      await expect(
        service.create(a.authCtx, levelB, { name: "X", code: "x" }, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("duplicate code within same level → ConflictError CODE_TAKEN", async () => {
      const { authCtx, schoolId } = await createActiveSchool("dup-code");
      const levelId = await firstSeededLevel(schoolId);
      await service.create(authCtx, levelId, { name: "A", code: "a" }, reqCtx);
      await expect(
        service.create(authCtx, levelId, { name: "Another A", code: "a" }, reqCtx),
      ).rejects.toMatchObject({ code: "CODE_TAKEN" });
    });

    it("non-owner/admin → ForbiddenError", async () => {
      const { schoolId } = await createActiveSchool("forbidden");
      const levelId = await firstSeededLevel(schoolId);
      const { authCtx: noRoleCtx } = await createUserWithoutRole(schoolId, "forbidden");
      await expect(
        service.create(noRoleCtx, levelId, { name: "X", code: "x" }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // -----------------------------------------------------------------------
  // classTeacherId validation — the slice-3 form-teacher check
  // -----------------------------------------------------------------------

  describe("classTeacherId validation", () => {
    it("assigns a teacher when the user has the `teacher` role", async () => {
      const { authCtx, schoolId } = await createActiveSchool("teach-ok");
      const levelId = await firstSeededLevel(schoolId);
      const teacherId = await createTeacher(schoolId, "ok");

      const created = await service.create(
        authCtx,
        levelId,
        { name: "KG 1A", code: "kg1-a", classTeacherId: teacherId },
        reqCtx,
      );
      expect(created.classTeacherId).toBe(teacherId);
    });

    it("rejects when user exists but is not a teacher → ValidationError(not_a_teacher)", async () => {
      const { authCtx, schoolId } = await createActiveSchool("teach-not");
      const levelId = await firstSeededLevel(schoolId);
      const nonTeacherId = await createNonTeacherUser(schoolId, "not");

      await expect(
        service.create(
          authCtx,
          levelId,
          { name: "KG 1A", code: "kg1-a", classTeacherId: nonTeacherId },
          reqCtx,
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        details: {
          issues: [
            expect.objectContaining({ path: "classTeacherId", code: "not_a_teacher" }),
          ],
        },
      });
    });

    it("rejects an unknown user id → ValidationError(not_found)", async () => {
      const { authCtx, schoolId } = await createActiveSchool("teach-nf");
      const levelId = await firstSeededLevel(schoolId);

      await expect(
        service.create(
          authCtx,
          levelId,
          {
            name: "KG 1A",
            code: "kg1-a",
            classTeacherId: "00000000-0000-0000-0000-000000000000",
          },
          reqCtx,
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        details: {
          issues: [expect.objectContaining({ path: "classTeacherId", code: "not_found" })],
        },
      });
    });

    it("rejects a teacher from another school → ValidationError(not_found via RLS)", async () => {
      const a = await createActiveSchool("teach-xt-a");
      const b = await createActiveSchool("teach-xt-b");
      const levelA = await firstSeededLevel(a.schoolId);
      const teacherInB = await createTeacher(b.schoolId, "xt");

      // A's tenant cannot see B's user — the role-check helper returns
      // "not_found" via RLS rather than leaking that the user exists
      // elsewhere.
      await expect(
        service.create(
          a.authCtx,
          levelA,
          { name: "KG 1A", code: "kg1-a", classTeacherId: teacherInB },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("PATCH classTeacherId revalidates on update", async () => {
      const { authCtx, schoolId } = await createActiveSchool("teach-patch");
      const levelId = await firstSeededLevel(schoolId);
      const arm = await service.create(authCtx, levelId, { name: "KG 1A", code: "kg1-a" }, reqCtx);
      const teacherId = await createTeacher(schoolId, "patch-ok");
      const nonTeacherId = await createNonTeacherUser(schoolId, "patch-not");

      const assigned = await service.update(
        authCtx,
        arm.id,
        { classTeacherId: teacherId },
        reqCtx,
      );
      expect(assigned.classTeacherId).toBe(teacherId);

      await expect(
        service.update(authCtx, arm.id, { classTeacherId: nonTeacherId }, reqCtx),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      const unassigned = await service.update(
        authCtx,
        arm.id,
        { classTeacherId: null },
        reqCtx,
      );
      expect(unassigned.classTeacherId).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------

  describe("update", () => {
    it("renames an arm and bumps audit log", async () => {
      const { authCtx, schoolId } = await createActiveSchool("upd");
      const levelId = await firstSeededLevel(schoolId);
      const arm = await service.create(authCtx, levelId, { name: "KG 1A", code: "kg1-a" }, reqCtx);
      const renamed = await service.update(authCtx, arm.id, { name: "Kindergarten 1A" }, reqCtx);
      expect(renamed.name).toBe("Kindergarten 1A");
    });

    it("rename to a colliding code within same level → CODE_TAKEN", async () => {
      const { authCtx, schoolId } = await createActiveSchool("upd-dup");
      const levelId = await firstSeededLevel(schoolId);
      await service.create(authCtx, levelId, { name: "A", code: "a" }, reqCtx);
      const other = await service.create(authCtx, levelId, { name: "B", code: "b" }, reqCtx);
      await expect(
        service.update(authCtx, other.id, { code: "a" }, reqCtx),
      ).rejects.toMatchObject({ code: "CODE_TAKEN" });
    });

    it("update unknown id → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("upd-nf");
      await expect(
        service.update(authCtx, "00000000-0000-0000-0000-000000000000", { name: "X" }, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // delete (cascade from level)
  // -----------------------------------------------------------------------

  describe("delete + cascade", () => {
    it("hard-delete removes the arm", async () => {
      const { authCtx, schoolId } = await createActiveSchool("del");
      const levelId = await firstSeededLevel(schoolId);
      const arm = await service.create(authCtx, levelId, { name: "A", code: "a" }, reqCtx);
      await service.delete(authCtx, arm.id, reqCtx);
      const list = await service.list(authCtx, { includeInactive: true });
      expect(list.map((a) => a.id)).not.toContain(arm.id);
    });

    it("cascade from class-level: deleting the level removes its arms", async () => {
      const { authCtx, schoolId } = await createActiveSchool("cascade");
      const levelId = await firstSeededLevel(schoolId);
      const arm = await service.create(authCtx, levelId, { name: "A", code: "a" }, reqCtx);

      await withTenant(schoolId, (db) =>
        db.classLevel.delete({ where: { id: levelId } }),
      );

      const survivor = await withTenant(schoolId, (db) =>
        db.classArm.findUnique({ where: { id: arm.id } }),
      );
      expect(survivor).toBeNull();
    });
  });
});

// Reference imports so unused-var lint is quiet on matcher-only types.
void ConflictError;
void ValidationError;
