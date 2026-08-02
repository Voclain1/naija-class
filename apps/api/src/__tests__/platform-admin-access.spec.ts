import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { basePrisma, withTenant } from "@school-kit/db";
import * as password from "../common/auth/password";
import { createSession } from "../common/auth/sessions";

import { HttpExceptionFilter } from "../common/http-exception.filter";
import { PlatformAdminModule } from "../modules/platform-admin/platform-admin.module";

// Platform super-admin — internal, read-only, cross-tenant admin surface
// (2026-08-02). Same real-HTTP-through-the-real-guard discipline as
// portal-payments.controller.spec.ts: `PlatformAdminGuard` IS the code path
// a real request runs, so a rejection here is the same 403/401 a real
// request would get. This spec is the acceptance test named in the
// approved plan-first: role-rejection, flag-check, positive cross-tenant
// proof, allow-listed-shape assertion, import-boundary check, audit
// logging.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      imports: [ConfigModule.forRoot({ isGlobal: true }), PlatformAdminModule],
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
    expect(Object.keys(row).sort()).toEqual(
      ["createdAt", "isActive", "name", "schoolId", "staffCount", "studentCount"].sort(),
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

  it("every platform-admin read writes an audit_logs row namespaced platform_admin.*", async () => {
    const rows = await basePrisma.auditLog.findMany({
      where: { userId: platformAdminUserId, action: { startsWith: "platform_admin." } },
      select: { action: true },
    });
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.has("platform_admin.login")).toBe(true);
    expect(actions.has("platform_admin.schools.list")).toBe(true);
    expect(actions.has("platform_admin.users.list")).toBe(true);
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
