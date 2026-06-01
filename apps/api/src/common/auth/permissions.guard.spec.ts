import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, UnauthorizedError } from "@school-kit/types";

import { AuthService } from "../../modules/auth/auth.service";
import type { AuthContext } from "./auth-context";
import { Permissions } from "./permissions.decorator";
import { PermissionsGuard } from "./permissions.guard";

// Integration spec — real DB, real RLS, real role rows (same harness shape as
// the service specs). The guard re-fetches permissions under withTenant, so it
// needs genuine users/roles, not mocks.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23489${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

// A throwaway controller whose decorated methods carry real @Permissions
// metadata for the Reflector to read.
class FakeController {
  @Permissions("student.read")
  read(): void {}

  @Permissions("student.create")
  create(): void {}

  @Permissions("academic-year.delete")
  ownerOnlyDelete(): void {}

  // Deliberately undecorated — exercises the fail-closed branch.
  undeclared(): void {}
}

function makeCtx(handler: () => void, user: AuthContext | undefined): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => FakeController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe("PermissionsGuard", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const guard = new PermissionsGuard(new Reflector());
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // Signs up a school; returns the owner authCtx.
  async function createSchoolWithOwner(suffix: string) {
    const signed = await authService.signupOwner(
      {
        schoolName: `Perm Guard ${suffix}`,
        schoolSlug: `pg-${suffix}-${runId}`,
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
      ownerAuthCtx: {
        sessionId: "sess",
        userId: signed.user.id,
        schoolId: signed.school.id,
      } as AuthContext,
    };
  }

  // Creates a user in the school and grants the named system role (or no role).
  async function createUser(
    schoolId: string,
    suffix: string,
    roleKey: "admin" | "teacher" | null,
  ): Promise<AuthContext> {
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: {
          schoolId,
          firstName: "Test",
          lastName: "User",
          email: `${suffix}-${runId}@example.test`,
          phone: randomPhone(),
          passwordHash: "argon2id$placeholder",
        },
        select: { id: true },
      });
      if (roleKey) {
        const role = await db.role.findFirst({
          where: { schoolId: null, key: roleKey, isSystem: true },
          select: { id: true },
        });
        if (!role) throw new Error(`system role ${roleKey} not seeded`);
        await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
      }
      return { sessionId: "sess", userId: u.id, schoolId } as AuthContext;
    });
  }

  it("owner (wildcard) is allowed everything, including owner-only deletes", async () => {
    const { ownerAuthCtx } = await createSchoolWithOwner("owner");
    await expect(
      guard.canActivate(makeCtx(FakeController.prototype.ownerOnlyDelete, ownerAuthCtx)),
    ).resolves.toBe(true);
  });

  it("admin is allowed a normal mutation", async () => {
    const { schoolId } = await createSchoolWithOwner("admin-allow");
    const admin = await createUser(schoolId, "admin-allow", "admin");
    await expect(
      guard.canActivate(makeCtx(FakeController.prototype.create, admin)),
    ).resolves.toBe(true);
  });

  it("admin is DENIED an owner-only delete (lacks academic-year.delete)", async () => {
    const { schoolId } = await createSchoolWithOwner("admin-deny");
    const admin = await createUser(schoolId, "admin-deny", "admin");
    await expect(
      guard.canActivate(makeCtx(FakeController.prototype.ownerOnlyDelete, admin)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("teacher is allowed student.read but DENIED student.create", async () => {
    const { schoolId } = await createSchoolWithOwner("teacher");
    const teacher = await createUser(schoolId, "teacher", "teacher");
    await expect(
      guard.canActivate(makeCtx(FakeController.prototype.read, teacher)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeCtx(FakeController.prototype.create, teacher)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a user with no role is denied", async () => {
    const { schoolId } = await createSchoolWithOwner("norole");
    const noRole = await createUser(schoolId, "norole", null);
    await expect(
      guard.canActivate(makeCtx(FakeController.prototype.read, noRole)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("fails closed when the handler declares no @Permissions", async () => {
    const { ownerAuthCtx } = await createSchoolWithOwner("noperms");
    await expect(
      guard.canActivate(makeCtx(FakeController.prototype.undeclared, ownerAuthCtx)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects an inactive user even with the right role", async () => {
    const { schoolId } = await createSchoolWithOwner("inactive");
    const admin = await createUser(schoolId, "inactive", "admin");
    // users is FORCE-RLS tenant-scoped — update under withTenant, not basePrisma.
    await withTenant(schoolId, (db) =>
      db.user.update({ where: { id: admin.userId }, data: { isActive: false } }),
    );
    await expect(
      guard.canActivate(makeCtx(FakeController.prototype.create, admin)),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects when req.user is absent (AuthGuard not run)", async () => {
    await expect(
      guard.canActivate(makeCtx(FakeController.prototype.read, undefined)),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
