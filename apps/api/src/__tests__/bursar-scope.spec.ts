import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError } from "@school-kit/types";

import type { AuthContext } from "../common/auth/auth-context";
import { PermissionsGuard } from "../common/auth/permissions.guard";
import { AuthService } from "../modules/auth/auth.service";
import { BvnController } from "../modules/users/bvn.controller";
import { FinanceController } from "../modules/finance/finance.controller";
import { InvoicesController } from "../modules/invoices/invoices.controller";
import { RefundsController } from "../modules/payments/refunds.controller";
import { StudentsController } from "../modules/students/students.controller";
import { UsersService } from "../modules/users/users.service";

// Phase 3 / Slice 15 cp3 — the bursar-scope negative walk called for by
// phase-3.md's acceptance criteria #11/#12. Same harness shape as the
// sibling `permissions.guard.spec.ts` (real Postgres, real roles, real
// @Permissions metadata read off the ACTUAL controllers — not a
// FakeController) rather than a new Playwright/HTTP suite: this is the
// permanent, automated version of the manual HTTP walk done for CP2's gate
// (invite a bursar → accept → hit endpoints → check status codes), minus
// the network round-trip. `guard.canActivate()` IS the same code path
// `PermissionsGuard` runs in production; a rejection here is the same 403
// a real request would get.
//
// GET /users (the staff list) is the one exception: UsersController has no
// @Permissions/PermissionsGuard at all — it gates via
// `assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"])` inside
// UsersService itself (a Phase 0 controller, out of scope for the guard
// retrofit — see permissions-coverage.spec.ts's intro comment). So that
// check calls the service directly, exactly like
// users.service.spec.ts's "user without owner/admin grant" test.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23485${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

// ctx.getClass() is only a fallback target for Reflector.getAllAndOverride —
// every @Permissions decorator in this codebase is method-level, so no
// controller here actually attaches class-level metadata. Passing the real
// controller class (rather than an arbitrary object) keeps this test's
// ExecutionContext shape honest even though the guard never reads metadata
// off it in practice.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(handler: (...args: any[]) => unknown, controllerClass: any, user: AuthContext | undefined): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe("Bursar-scope negative walk (Phase 3 slice 15 cp3)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const usersService = new UsersService();
  const guard = new PermissionsGuard(new Reflector());
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  async function createSchoolWithOwner(suffix: string) {
    const signed = await authService.signupOwner(
      {
        schoolName: `Bursar Scope ${suffix}`,
        schoolSlug: `bs-${suffix}-${runId}`,
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
    return { schoolId: signed.school.id };
  }

  async function createBursar(schoolId: string, suffix: string): Promise<AuthContext> {
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: {
          schoolId,
          firstName: "Betty",
          lastName: "Bursar",
          email: `bursar-${suffix}-${runId}@example.test`,
          phone: randomPhone(),
          passwordHash: "argon2id$placeholder",
        },
        select: { id: true },
      });
      const role = await db.role.findFirst({
        where: { schoolId: null, key: "bursar", isSystem: true },
        select: { id: true },
      });
      if (!role) throw new Error("system role 'bursar' not seeded — run pnpm db:seed");
      await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
      return { sessionId: "sess", userId: u.id, schoolId } as AuthContext;
    });
  }

  it("bursar CANNOT refund a payment (POST /refunds — payment.refund is admin+owner only)", async () => {
    const { schoolId } = await createSchoolWithOwner("refund");
    const bursar = await createBursar(schoolId, "refund");
    await expect(
      guard.canActivate(makeCtx(RefundsController.prototype.create, RefundsController, bursar)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("bursar CANNOT reveal another staff member's BVN (GET /users/:id/bvn/reveal — staff-bvn.reveal is admin+owner only)", async () => {
    const { schoolId } = await createSchoolWithOwner("bvn");
    const bursar = await createBursar(schoolId, "bvn");
    await expect(
      guard.canActivate(makeCtx(BvnController.prototype.revealBvnForStaff, BvnController, bursar)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("bursar CANNOT read the student roster (GET /students — student.read is not a finance permission)", async () => {
    const { schoolId } = await createSchoolWithOwner("students");
    const bursar = await createBursar(schoolId, "students");
    await expect(
      guard.canActivate(makeCtx(StudentsController.prototype.list, StudentsController, bursar)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("bursar CANNOT list staff (GET /users — service-level owner|admin gate, no @Permissions on this Phase 0 controller)", async () => {
    const { schoolId } = await createSchoolWithOwner("stafflist");
    const bursar = await createBursar(schoolId, "stafflist");
    await expect(usersService.listUsers(bursar)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // Positive control: bursar isn't denied everything — the exclusions above
  // are specific, not a byproduct of a broken/empty role grant.
  it("bursar CAN reach finance surfaces (finance.dashboard.read, invoice.read) — the exclusions above are specific, not blanket", async () => {
    const { schoolId } = await createSchoolWithOwner("positive");
    const bursar = await createBursar(schoolId, "positive");
    await expect(
      guard.canActivate(makeCtx(FinanceController.prototype.getDashboard, FinanceController, bursar)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeCtx(InvoicesController.prototype.list, InvoicesController, bursar)),
    ).resolves.toBe(true);
  });
});
