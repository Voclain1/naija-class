import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import {
  DEFAULT_CLASS_LEVELS,
  DEFAULT_GRADE_BOUNDARIES,
  DEFAULT_GRADING_COMPONENTS,
  DEFAULT_SUBJECTS,
  basePrisma,
  withTenant,
} from "@school-kit/db";
import { AuthService } from "../modules/auth/auth.service";
import * as password from "../common/auth/password";
import { createSession } from "../common/auth/sessions";

import { HttpExceptionFilter } from "../common/http-exception.filter";
import { PlatformAdminModule } from "../modules/platform-admin/platform-admin.module";
import { InvitationsModule } from "../modules/invitations/invitations.module";

// Platform super-admin — internal, read-only, cross-tenant admin surface
// (2026-08-02). Same real-HTTP-through-the-real-guard discipline as
// portal-payments.controller.spec.ts: `PlatformAdminGuard` IS the code path
// a real request runs, so a rejection here is the same 403/401 a real
// request would get. This spec is the acceptance test named in the
// approved plan-first: role-rejection, flag-check, positive cross-tenant
// proof, allow-listed-shape assertion, import-boundary check, audit
// logging.

// apps/api compiles under CommonJS (NestJS/webpack) — __dirname is a
// native CommonJS global here, unlike the workspace's ESM packages
// (see CLAUDE.md's "ESM module resolution" note, which is about
// packages/*, not apps/api itself).

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23486${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };

describe("Platform admin access (2026-08-02)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const schoolIdsToCleanup = new Set<string>();
  const userIdsForAuditCleanup = new Set<string>();
  let app: INestApplication;

  let schoolA: string;
  let schoolB: string;
  let platformAdminUserId: string;
  let platformAdminToken: string;
  let ownerAToken: string;
  let adminAToken: string;
  let teacherAToken: string;
  let bursarAToken: string;
  let nonAdminBToken: string; // second school, isPlatformAdmin=false explicitly

  const PLATFORM_ADMIN_PASSWORD = "Correct-Horse-Platform-9";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PlatformAdminModule, InvitationsModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const schoolRowA = await basePrisma.school.create({
      data: { name: `Platform Admin Spec A ${runId}`, slug: `platform-admin-a-${runId}`, status: "ACTIVE" },
      select: { id: true },
    });
    schoolA = schoolRowA.id;
    schoolIdsToCleanup.add(schoolA);

    const schoolRowB = await basePrisma.school.create({
      data: { name: `Platform Admin Spec B ${runId}`, slug: `platform-admin-b-${runId}`, status: "ACTIVE" },
      select: { id: true },
    });
    schoolB = schoolRowB.id;
    schoolIdsToCleanup.add(schoolB);

    await withTenant(schoolA, async (db) => {
      await db.student.create({
        data: {
          schoolId: schoolA,
          admissionNumber: `ADM-PA-${runId}`,
          firstName: "Student",
          lastName: `A-${runId}`,
          dateOfBirth: new Date("2015-01-01"),
          gender: "FEMALE",
        },
      });
    });

    async function makeStaff(
      schoolId: string,
      roleKey: string,
      suffix: string,
      extra: { isPlatformAdmin?: boolean; passwordHash?: string } = {},
    ) {
      return withTenant(schoolId, async (db) => {
        const u = await db.user.create({
          data: {
            schoolId,
            firstName: roleKey[0]!.toUpperCase() + roleKey.slice(1),
            lastName: `Staff-${suffix}`,
            email: `${roleKey}-${suffix}-${runId}@example.test`,
            phone: randomPhone(),
            passwordHash: extra.passwordHash ?? "argon2id$placeholder",
            isPlatformAdmin: extra.isPlatformAdmin ?? false,
          },
          select: { id: true },
        });
        const role = await db.role.findFirst({
          where: { schoolId: null, key: roleKey, isSystem: true },
          select: { id: true },
        });
        if (!role) throw new Error(`system role '${roleKey}' not seeded — run pnpm db:seed`);
        await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
        return u.id;
      });
    }

    const ownerAId = await makeStaff(schoolA, "owner", "a");
    const adminAId = await makeStaff(schoolA, "admin", "a");
    const teacherAId = await makeStaff(schoolA, "teacher", "a");
    const bursarAId = await makeStaff(schoolA, "bursar", "a");
    const nonAdminBId = await makeStaff(schoolB, "owner", "b", { isPlatformAdmin: false });

    const platformAdminHash = await password.hashPassword(PLATFORM_ADMIN_PASSWORD);
    platformAdminUserId = await makeStaff(schoolA, "owner", "platform-admin", {
      isPlatformAdmin: true,
      passwordHash: platformAdminHash,
    });
    userIdsForAuditCleanup.add(platformAdminUserId);

    ownerAToken = (await createSession(schoolA, ownerAId, reqCtx)).rawToken;
    adminAToken = (await createSession(schoolA, adminAId, reqCtx)).rawToken;
    teacherAToken = (await createSession(schoolA, teacherAId, reqCtx)).rawToken;
    bursarAToken = (await createSession(schoolA, bursarAId, reqCtx)).rawToken;
    nonAdminBToken = (await createSession(schoolB, nonAdminBId, reqCtx)).rawToken;
    platformAdminToken = (await createSession(schoolA, platformAdminUserId, reqCtx)).rawToken;
  });

  afterAll(async () => {
    await basePrisma.auditLog.deleteMany({
      where: { userId: { in: [...userIdsForAuditCleanup] } },
    });
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
    await basePrisma.$disconnect();
  });

  it.each([
    ["owner", () => ownerAToken],
    ["admin", () => adminAToken],
    ["teacher", () => teacherAToken],
    ["bursar", () => bursarAToken],
  ])(
    "%s's ordinary staff session gets a real 403 from PlatformAdminGuard (not 401)",
    async (_role, getToken) => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${getToken()}`);
      expect(res.status).toBe(403);
    },
  );

  it("a user with isPlatformAdmin=false is rejected even with the correct request shape", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/platform-admin/schools")
      .set("Authorization", `Bearer ${nonAdminBToken}`);
    expect(res.status).toBe(403);
  });

  it("no bearer token gets a 401 (unauthenticated, not just forbidden)", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/platform-admin/schools");
    expect(res.status).toBe(401);
  });

  it("POST /platform-admin/login succeeds for ANY valid staff credential (no new credential system) — the platform-admin flag is checked only by the guard on subsequent requests", async () => {
    // Mint a real password for ownerA specifically to exercise the login
    // endpoint itself (the sessions above were minted directly via
    // createSession, bypassing login).
    const loginHash = await password.hashPassword("Correct-Horse-Owner-9");
    const loginOwnerId = await withTenant(schoolA, async (db) => {
      const u = await db.user.create({
        data: {
          schoolId: schoolA,
          firstName: "Login",
          lastName: `Owner-${runId}`,
          email: `login-owner-${runId}@example.test`,
          phone: randomPhone(),
          passwordHash: loginHash,
        },
        select: { id: true },
      });
      const role = await db.role.findFirst({ where: { schoolId: null, key: "owner", isSystem: true }, select: { id: true } });
      if (!role) throw new Error("system role 'owner' not seeded — run pnpm db:seed");
      await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
      return u.id;
    });
    userIdsForAuditCleanup.add(loginOwnerId);

    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/platform-admin/login")
      .send({ email: `login-owner-${runId}@example.test`, password: "Correct-Horse-Owner-9" });
    expect(loginRes.status).toBe(200);
    expect(typeof loginRes.body.token).toBe("string");

    // The freshly-issued token authenticates (guard finds a real session)
    // but is still forbidden — this owner is not a platform admin.
    const dataRes = await request(app.getHttpServer())
      .get("/api/v1/platform-admin/schools")
      .set("Authorization", `Bearer ${loginRes.body.token}`);
    expect(dataRes.status).toBe(403);
  });

  it("wrong password on /platform-admin/login is rejected with INVALID_CREDENTIALS", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/platform-admin/login")
      .send({ email: `owner-a-${runId}-does-not-exist@example.test`, password: "whatever-12345" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("the designated platform admin can also authenticate via the real login endpoint", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/platform-admin/login")
      .send({
        email: `owner-platform-admin-${runId}@example.test`,
        password: PLATFORM_ADMIN_PASSWORD,
      });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");

    const dataRes = await request(app.getHttpServer())
      .get("/api/v1/platform-admin/schools")
      .set("Authorization", `Bearer ${res.body.token}`);
    expect(dataRes.status).toBe(200);
  });

  it("a real platform-admin session positively returns schools from BOTH seeded schools", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/platform-admin/schools")
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(200);
    const ids: string[] = res.body.map((r: { schoolId: string }) => r.schoolId);
    expect(ids).toContain(schoolA);
    expect(ids).toContain(schoolB);
  });

  it("school rows contain ONLY the allow-listed keys", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/platform-admin/schools")
      .set("Authorization", `Bearer ${platformAdminToken}`);
    const row = res.body.find((r: { schoolId: string }) => r.schoolId === schoolA);
    expect(row).toBeDefined();
    // This list is a deliberate allow-list, not a snapshot — it exists so that
    // widening this cross-tenant surface can never happen silently. Every
    // addition here should be a conscious decision recorded alongside the
    // migration that changed platform_admin_list_schools()'s return shape:
    //   - ownerInvite{Pending,ExpiresAt}  2026-08-07 (school provisioning)
    //   - earlyAccessGrantedAt            2026-08-09 (early-access marker;
    //     commercial status ABOUT the tenancy, in the same category as
    //     isActive/ownerInvitePending — not the school's own financial
    //     configuration, which stays out of scope per CLAUDE.md's inventory)
    //   - aiEnabled                       2026-08-14 (per-school AI kill
    //     switch; same category — platform status about the tenancy, set by
    //     the operator. Note what did NOT come with it: aiMonthlyTokenBudget
    //     is spend configuration and parentSummaryEnabled is the school's own
    //     opt-in, and neither is needed to answer "is AI on here")
    expect(Object.keys(row).sort()).toEqual(
      [
        "aiEnabled",
        "createdAt",
        "earlyAccessGrantedAt",
        "isActive",
        "name",
        "ownerInviteExpiresAt",
        "ownerInvitePending",
        "schoolId",
        "staffCount",
        "studentCount",
      ].sort(),
    );
    // Basic count sanity: schoolA has 1 student and >= 5 staff users seeded above.
    expect(row.studentCount).toBe(1);
    expect(row.staffCount).toBeGreaterThanOrEqual(5);
  });

  it("GET /platform-admin/users with no filter returns users across BOTH schools; with schoolId filters to one", async () => {
    const allRes = await request(app.getHttpServer())
      .get("/api/v1/platform-admin/users")
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(allRes.status).toBe(200);
    const allSchoolIds = new Set(allRes.body.map((r: { schoolId: string }) => r.schoolId));
    expect(allSchoolIds.has(schoolA)).toBe(true);
    expect(allSchoolIds.has(schoolB)).toBe(true);

    const filteredRes = await request(app.getHttpServer())
      .get(`/api/v1/platform-admin/users?schoolId=${schoolB}`)
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.length).toBeGreaterThan(0);
    for (const row of filteredRes.body) {
      expect(row.schoolId).toBe(schoolB);
    }
  });

  it("user rows contain ONLY the allow-listed keys — no email/phone/BVN/password fields", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/platform-admin/users?schoolId=${schoolA}`)
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.body.length).toBeGreaterThan(0);
    for (const row of res.body) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "createdAt",
          "firstName",
          "isActive",
          "lastLoginAt",
          "lastName",
          "roleNames",
          "schoolId",
          "userId",
        ].sort(),
      );
    }
  });

  describe("POST /platform-admin/schools — provisioning (2026-08-07)", () => {
    it("happy path: creates a School + owner Invitation, and the returned acceptUrl's token actually works against POST /invitations/:token/accept", async () => {
      const ownerEmail = `provisioned-owner-${runId}@example.test`;
      const res = await request(app.getHttpServer())
        .post("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ schoolName: `Provisioned School ${runId}`, ownerEmail });
      expect(res.status).toBe(201); // NestJS default for @Post() is 201 (no @HttpCode override here)
      expect(res.body.schoolId).toEqual(expect.any(String));
      expect(res.body.schoolSlug).toMatch(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/);
      expect(res.body.ownerEmail).toBe(ownerEmail);
      expect(typeof res.body.acceptUrl).toBe("string");
      schoolIdsToCleanup.add(res.body.schoolId);

      // The school shows as owner-invite-pending in the list read.
      const listRes = await request(app.getHttpServer())
        .get("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${platformAdminToken}`);
      const row = listRes.body.find((r: { schoolId: string }) => r.schoolId === res.body.schoolId);
      expect(row.ownerInvitePending).toBe(true);
      expect(typeof row.ownerInviteExpiresAt).toBe("string");

      // The acceptUrl's token is real and works, end to end, through the
      // unmodified generic invitations accept endpoint.
      const token = res.body.acceptUrl.split("/invitations/")[1];
      expect(token).toBeTruthy();

      const getRes = await request(app.getHttpServer()).get(`/api/v1/invitations/${token}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.roleKey).toBe("owner");
      expect(getRes.body.schoolName).toBe(`Provisioned School ${runId}`);
      // The platform admin's own User row lives in schoolA, not the new
      // school — the tenant-scoped inviter lookup correctly finds nothing
      // and falls back to the documented "An administrator" label.
      expect(getRes.body.invitedByName).toBe("An administrator");

      const acceptRes = await request(app.getHttpServer())
        .post(`/api/v1/invitations/${token}/accept`)
        .send({
          firstName: "New",
          lastName: "Owner",
          password: "Correct-Horse-NewOwner-9",
          ndprConsent: true,
        });
      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.school.id).toBe(res.body.schoolId);
      expect(acceptRes.body.school.status).toBe("ONBOARDING");
      expect(typeof acceptRes.body.token).toBe("string");
      userIdsForAuditCleanup.add(acceptRes.body.user.id);

      // Owner-invite-pending flips false once accepted.
      const listAfterRes = await request(app.getHttpServer())
        .get("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${platformAdminToken}`);
      const rowAfter = listAfterRes.body.find(
        (r: { schoolId: string }) => r.schoolId === res.body.schoolId,
      );
      expect(rowAfter.ownerInvitePending).toBe(false);
    });

    it("duplicate email — an existing User's email is rejected with 409 EMAIL_TAKEN", async () => {
      // ownerA (seeded in beforeAll) already has a real User row.
      const res = await request(app.getHttpServer())
        .post("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ schoolName: "Should Not Be Created", ownerEmail: `owner-a-${runId}@example.test` });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("EMAIL_TAKEN");
    });

    it("duplicate email — a pending owner invite from an earlier provisioning call is rejected with 409 INVITE_PENDING", async () => {
      const ownerEmail = `dup-pending-owner-${runId}@example.test`;
      const first = await request(app.getHttpServer())
        .post("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ schoolName: `Dup Pending First ${runId}`, ownerEmail });
      expect(first.status).toBe(201);
      schoolIdsToCleanup.add(first.body.schoolId);

      const second = await request(app.getHttpServer())
        .post("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ schoolName: `Dup Pending Second ${runId}`, ownerEmail });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("INVITE_PENDING");
    });

    it("slug collision — two schools whose names slugify identically get distinct slugs", async () => {
      const first = await request(app.getHttpServer())
        .post("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({
          schoolName: `Slug Collision ${runId}`,
          ownerEmail: `slug-collision-1-${runId}@example.test`,
        });
      expect(first.status).toBe(201);
      schoolIdsToCleanup.add(first.body.schoolId);

      const second = await request(app.getHttpServer())
        .post("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({
          // Same name -> same base slug -> must collide and retry.
          schoolName: `Slug Collision ${runId}`,
          ownerEmail: `slug-collision-2-${runId}@example.test`,
        });
      expect(second.status).toBe(201);
      schoolIdsToCleanup.add(second.body.schoolId);

      expect(second.body.schoolSlug).not.toBe(first.body.schoolSlug);
      expect(second.body.schoolSlug.startsWith(first.body.schoolSlug)).toBe(true);
    });

    // ---- Academic-structure seeding (2026-08-14) ----
    //
    // Regression cover for a real production defect: from this endpoint's
    // first ship (2026-08-07) until 2026-08-14 it created a School and an
    // Invitation and NOTHING else, because signupOwner's seeding block was
    // inline in signupOwner rather than a shared callable. Four schools
    // provisioned on 2026-08-08 were left with zero class levels, zero arms,
    // zero subjects and no grading scheme — an owner could accept the invite,
    // log in, and do nothing at all. One of those owners abandoned the school
    // and re-registered through self-serve signup instead.
    it("seeds the full academic structure — the gap that left four provisioned schools unusable", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({
          schoolName: `Seeded Provisioning ${runId}`,
          ownerEmail: `seeded-provisioning-${runId}@example.test`,
        });
      expect(res.status).toBe(201);
      schoolIdsToCleanup.add(res.body.schoolId);

      const seeded = await withTenant(res.body.schoolId, async (db) => ({
        levels: await db.classLevel.count(),
        arms: await db.classArm.count(),
        subjects: await db.subject.count(),
        schemes: await db.gradingScheme.count(),
        components: await db.gradingComponent.count(),
        boundaries: await db.gradeBoundary.count(),
      }));

      expect(seeded.levels).toBe(DEFAULT_CLASS_LEVELS.length);
      // One default arm per level — the specific thing whose absence blocks
      // every enrollment workflow in the product.
      expect(seeded.arms).toBe(DEFAULT_CLASS_LEVELS.length);
      expect(seeded.subjects).toBe(DEFAULT_SUBJECTS.length);
      expect(seeded.schemes).toBe(1);
      expect(seeded.components).toBe(DEFAULT_GRADING_COMPONENTS.length);
      expect(seeded.boundaries).toBe(DEFAULT_GRADE_BOUNDARIES.length);
    });

    // The test that actually prevents a recurrence. The bug was not "rows are
    // missing" — it was "two code paths that must agree were free to drift".
    // Asserting the two paths produce IDENTICAL structure fails if a future
    // change seeds one and not the other, whatever the seed contents become.
    it("produces structure identical to a self-serve signup (the drift this fix removes)", async () => {
      const provisioned = await request(app.getHttpServer())
        .post("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({
          schoolName: `Parity Provisioned ${runId}`,
          ownerEmail: `parity-provisioned-${runId}@example.test`,
        });
      expect(provisioned.status).toBe(201);
      schoolIdsToCleanup.add(provisioned.body.schoolId);

      // Constructed directly, not through DI — signupOwner touches neither
      // Redis nor email, and the class documents this exact usage.
      const signedUp = await new AuthService().signupOwner(
        {
          schoolName: `Parity Signup ${runId}`,
          ownerFirstName: "Parity",
          ownerLastName: "Owner",
          ownerEmail: `parity-signup-${runId}@example.test`,
          ownerPhone: randomPhone(),
          password: "Correct-Horse-Parity-9",
          ndprConsent: true,
        },
        { ipAddress: null, userAgent: null },
      );
      schoolIdsToCleanup.add(signedUp.school.id);
      userIdsForAuditCleanup.add(signedUp.user.id);

      const structureOf = (schoolId: string) =>
        withTenant(schoolId, async (db) => ({
          levels: (
            await db.classLevel.findMany({ select: { code: true }, orderBy: { code: "asc" } })
          ).map((r) => r.code),
          arms: (
            await db.classArm.findMany({ select: { code: true }, orderBy: { code: "asc" } })
          ).map((r) => r.code),
          subjects: (
            await db.subject.findMany({ select: { code: true }, orderBy: { code: "asc" } })
          ).map((r) => r.code),
          components: (
            await db.gradingComponent.findMany({ select: { key: true }, orderBy: { key: "asc" } })
          ).map((r) => r.key),
          boundaries: (
            await db.gradeBoundary.findMany({ select: { letter: true }, orderBy: { letter: "asc" } })
          ).map((r) => r.letter),
        }));

      expect(await structureOf(provisioned.body.schoolId)).toEqual(
        await structureOf(signedUp.school.id),
      );
    });
  });

  // ---- Early-access marker (2026-08-09) — the surface's second write ----
  //
  // Marker only: nothing in the platform reads earlyAccessGrantedAt to make a
  // decision. These tests cover the two things that CAN go wrong regardless —
  // an unguarded write on a cross-tenant surface, and a set/clear that doesn't
  // round-trip through platform_admin_list_schools().
  describe("PATCH /platform-admin/schools/:schoolId/early-access", () => {
    it("an ordinary staff session gets a 403, and no token gets a 401", async () => {
      const forbidden = await request(app.getHttpServer())
        .patch(`/api/v1/platform-admin/schools/${schoolA}/early-access`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ earlyAccess: true });
      expect(forbidden.status).toBe(403);

      const unauthorized = await request(app.getHttpServer())
        .patch(`/api/v1/platform-admin/schools/${schoolA}/early-access`)
        .send({ earlyAccess: true });
      expect(unauthorized.status).toBe(401);
    });

    it("sets then clears the marker, and the change round-trips through the schools list", async () => {
      const set = await request(app.getHttpServer())
        .patch(`/api/v1/platform-admin/schools/${schoolA}/early-access`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ earlyAccess: true });
      expect(set.status).toBe(200);
      expect(set.body.earlyAccessGrantedAt).not.toBeNull();

      const afterSet = await request(app.getHttpServer())
        .get("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${platformAdminToken}`);
      const rowSet = afterSet.body.find((r: { schoolId: string }) => r.schoolId === schoolA);
      expect(rowSet.earlyAccessGrantedAt).not.toBeNull();

      const clear = await request(app.getHttpServer())
        .patch(`/api/v1/platform-admin/schools/${schoolA}/early-access`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ earlyAccess: false });
      expect(clear.status).toBe(200);
      expect(clear.body.earlyAccessGrantedAt).toBeNull();

      const afterClear = await request(app.getHttpServer())
        .get("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${platformAdminToken}`);
      const rowClear = afterClear.body.find((r: { schoolId: string }) => r.schoolId === schoolA);
      expect(rowClear.earlyAccessGrantedAt).toBeNull();
    });

    it("an unknown schoolId is a 404, not a silent no-op", async () => {
      const res = await request(app.getHttpServer())
        .patch("/api/v1/platform-admin/schools/does-not-exist/early-access")
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ earlyAccess: true });
      expect(res.status).toBe(404);
    });
  });

  // The per-school AI kill switch. Structurally the twin of early-access
  // above, with one material difference: this flag is READ ON THE HOT PATH by
  // AiGenerationService.reserve(), so these tests assert the value actually
  // lands on the School row, not merely that the endpoint echoes it back.
  describe("PATCH /platform-admin/schools/:schoolId/ai (2026-08-14)", () => {
    it("an ordinary staff session gets a 403, and no token gets a 401", async () => {
      const forbidden = await request(app.getHttpServer())
        .patch(`/api/v1/platform-admin/schools/${schoolA}/ai`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ aiEnabled: false });
      expect(forbidden.status).toBe(403);

      const unauthorized = await request(app.getHttpServer())
        .patch(`/api/v1/platform-admin/schools/${schoolA}/ai`)
        .send({ aiEnabled: false });
      expect(unauthorized.status).toBe(401);

      // Neither rejected call may have moved the underlying row.
      const school = await basePrisma.school.findUnique({
        where: { id: schoolA },
        select: { aiEnabled: true },
      });
      expect(school?.aiEnabled).toBe(true);
    });

    it("disables then re-enables, and the value round-trips through both the School row and the schools list", async () => {
      const off = await request(app.getHttpServer())
        .patch(`/api/v1/platform-admin/schools/${schoolA}/ai`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ aiEnabled: false });
      expect(off.status).toBe(200);
      expect(off.body).toEqual({ schoolId: schoolA, aiEnabled: false });

      // The row itself, not just the response — this is the value the AI gate
      // reads.
      const rowAfterOff = await basePrisma.school.findUnique({
        where: { id: schoolA },
        select: { aiEnabled: true },
      });
      expect(rowAfterOff?.aiEnabled).toBe(false);

      const listAfterOff = await request(app.getHttpServer())
        .get("/api/v1/platform-admin/schools")
        .set("Authorization", `Bearer ${platformAdminToken}`);
      expect(
        listAfterOff.body.find((r: { schoolId: string }) => r.schoolId === schoolA).aiEnabled,
      ).toBe(false);
      // Scoped to the one school — the sibling tenant is untouched.
      expect(
        listAfterOff.body.find((r: { schoolId: string }) => r.schoolId === schoolB).aiEnabled,
      ).toBe(true);

      // Re-enabling is the whole point of this endpoint existing.
      const on = await request(app.getHttpServer())
        .patch(`/api/v1/platform-admin/schools/${schoolA}/ai`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ aiEnabled: true });
      expect(on.status).toBe(200);
      expect(on.body).toEqual({ schoolId: schoolA, aiEnabled: true });

      const rowAfterOn = await basePrisma.school.findUnique({
        where: { id: schoolA },
        select: { aiEnabled: true },
      });
      expect(rowAfterOn?.aiEnabled).toBe(true);
    });

    it("is idempotent — setting the value it already holds succeeds and still writes an audit row recording the re-assertion", async () => {
      const before = await basePrisma.auditLog.count({
        where: { action: "platform_admin.schools.set-ai-enabled", entityId: schoolB },
      });

      const first = await request(app.getHttpServer())
        .patch(`/api/v1/platform-admin/schools/${schoolB}/ai`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ aiEnabled: true });
      expect(first.body.aiEnabled).toBe(true);

      const after = await basePrisma.auditLog.count({
        where: { action: "platform_admin.schools.set-ai-enabled", entityId: schoolB },
      });
      expect(after).toBe(before + 1);

      // from === to distinguishes a re-assertion from a real transition.
      const row = await basePrisma.auditLog.findFirst({
        where: { action: "platform_admin.schools.set-ai-enabled", entityId: schoolB },
        orderBy: { createdAt: "desc" },
        select: { metadata: true, schoolId: true, entityType: true, userId: true },
      });
      expect(row?.metadata).toMatchObject({ field: "aiEnabled", from: true, to: true });
      // Cross-tenant surface convention: schoolId null, school identified by
      // entityId (see the service's comment for why).
      expect(row?.schoolId).toBeNull();
      expect(row?.entityType).toBe("school");
      expect(row?.userId).toBe(platformAdminUserId);
    });

    it("records the real transition in the audit metadata when the value does move", async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/platform-admin/schools/${schoolB}/ai`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ aiEnabled: false });

      const row = await basePrisma.auditLog.findFirst({
        where: { action: "platform_admin.schools.set-ai-enabled", entityId: schoolB },
        orderBy: { createdAt: "desc" },
        select: { metadata: true },
      });
      expect(row?.metadata).toMatchObject({ field: "aiEnabled", from: true, to: false });

      // Leave schoolB as we found it so test order stays irrelevant.
      await request(app.getHttpServer())
        .patch(`/api/v1/platform-admin/schools/${schoolB}/ai`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ aiEnabled: true });
    });

    it("rejects a non-boolean body — the Zod pipe, not a coerced truthy string", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/platform-admin/schools/${schoolA}/ai`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ aiEnabled: "yes" });
      expect(res.status).toBe(400);
    });

    it("an unknown schoolId is a 404, not a silent no-op", async () => {
      const res = await request(app.getHttpServer())
        .patch("/api/v1/platform-admin/schools/does-not-exist/ai")
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ aiEnabled: true });
      expect(res.status).toBe(404);
    });
  });

  it("every platform-admin read/write writes an audit_logs row namespaced platform_admin.*", async () => {
    const rows = await basePrisma.auditLog.findMany({
      where: { userId: platformAdminUserId, action: { startsWith: "platform_admin." } },
      select: { action: true },
    });
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.has("platform_admin.login")).toBe(true);
    expect(actions.has("platform_admin.schools.list")).toBe(true);
    expect(actions.has("platform_admin.users.list")).toBe(true);
    expect(actions.has("platform_admin.schools.create")).toBe(true);
    expect(actions.has("platform_admin.schools.set-early-access")).toBe(true);
    expect(actions.has("platform_admin.schools.set-ai-enabled")).toBe(true);
  });

  it("import-boundary: the platform-admin service never imports withTenant or references Invoice/Payment/Student Prisma delegates", () => {
    const servicePath = path.join(
      __dirname,
      "..",
      "modules",
      "platform-admin",
      "platform-admin.service.ts",
    );
    const source = fs.readFileSync(servicePath, "utf-8");
    expect(source).not.toMatch(/\bwithTenant\b/);
    expect(source).not.toMatch(/\.invoice\./i);
    expect(source).not.toMatch(/\.payment\./i);
    expect(source).not.toMatch(/\.student\./i);
  });
});
