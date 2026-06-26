import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { Global, Module, INestApplication } from "@nestjs/common";
import request from "supertest";
import * as crypto from "node:crypto";

import { basePrisma, withTenant } from "@school-kit/db";

import { REDIS_AUTH_CLIENT } from "../../common/auth/redis-auth.provider";
import { AuthModule } from "./auth.module";
import { HttpExceptionFilter } from "../../common/http-exception.filter";

const mockRedis = { incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) };
@Global()
@Module({
  providers: [{ provide: REDIS_AUTH_CLIENT, useValue: mockRedis }],
  exports: [REDIS_AUTH_CLIENT],
})
class MockRedisAuthModule {}

// Covers /auth/login (HTTP), /auth/logout, /auth/me, and AuthGuard behaviour
// against the real HTTP surface. Session-level invariants (token hashing,
// audit redaction, timing-safe failure) live in auth.service.spec.ts and
// auth.login.spec.ts; this suite proves the wiring.

describe("Auth session endpoints (Phase 0 Prompt 4)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const phoneSuffix = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  const schoolIdsToCleanup = new Set<string>();
  let app: INestApplication;

  // A signed-up account whose credentials each test reuses.
  const email = `sess-${runId}@example.test`;
  const password = "Correct-Horse-9";
  let schoolId: string;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MockRedisAuthModule, AuthModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const signupBody = {
      schoolName: "Session Spec Academy",
      schoolSlug: `sess-${runId}`,
      ownerFirstName: "Sess",
      ownerLastName: "Owner",
      ownerEmail: email,
      ownerPhone: `+234806${phoneSuffix}`,
      password,
      ndprConsent: true,
    };
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/signup-owner")
      .send(signupBody);
    expect(res.status).toBe(201);
    schoolId = res.body.school.id;
    userId = res.body.user.id;
    schoolIdsToCleanup.add(schoolId);
  });

  afterAll(async () => {
    await app.close();
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  async function loginAndGetToken(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(res.status).toBe(200);
    return res.body.token as string;
  }

  // -----------------------------------------------------------------------
  // POST /auth/login
  // -----------------------------------------------------------------------

  it("POST /auth/login — happy path returns 200 + { user, school, token }", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.user?.id).toBe(userId);
    expect(res.body.school?.id).toBe(schoolId);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("POST /auth/login — wrong password returns 401 INVALID_CREDENTIALS", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password: "definitely-wrong" });

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("INVALID_CREDENTIALS");
  });

  it("POST /auth/login — empty password returns 400 VALIDATION_ERROR", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password: "" });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
  });

  // -----------------------------------------------------------------------
  // AuthGuard
  // -----------------------------------------------------------------------

  it("AuthGuard — missing Authorization header → 401 MISSING_BEARER_TOKEN", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("MISSING_BEARER_TOKEN");
  });

  it("AuthGuard — Authorization header without scheme → 401 MISSING_BEARER_TOKEN", async () => {
    const token = await loginAndGetToken();
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", token); // raw token, no scheme
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("MISSING_BEARER_TOKEN");
  });

  it("AuthGuard — lowercase 'bearer' prefix is REJECTED (case-sensitive)", async () => {
    const token = await loginAndGetToken();
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("MISSING_BEARER_TOKEN");
  });

  it("AuthGuard — uppercase 'BEARER' prefix is REJECTED (case-sensitive)", async () => {
    const token = await loginAndGetToken();
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `BEARER ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("MISSING_BEARER_TOKEN");
  });

  it("AuthGuard — well-formed token that does not exist → 401 INVALID_SESSION", async () => {
    const bogus = crypto.randomBytes(32).toString("base64url");
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${bogus}`);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("INVALID_SESSION");
  });

  it("AuthGuard — expired session → 401 SESSION_EXPIRED", async () => {
    // Mint a real-shape session row with expires_at in the past so the
    // SECURITY DEFINER lookup returns it but the guard rejects.
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await withTenant(schoolId, (db) =>
      db.session.create({
        data: {
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() - 60_000),
        },
      }),
    );
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${rawToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("SESSION_EXPIRED");
  });

  it("AuthGuard — deactivated user → 401 USER_INACTIVE", async () => {
    const token = await loginAndGetToken();
    await withTenant(schoolId, (db) =>
      db.user.update({ where: { id: userId }, data: { isActive: false } }),
    );
    try {
      const res = await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe("USER_INACTIVE");
    } finally {
      await withTenant(schoolId, (db) =>
        db.user.update({ where: { id: userId }, data: { isActive: true } }),
      );
    }
  });

  // -----------------------------------------------------------------------
  // GET /auth/me
  // -----------------------------------------------------------------------

  it("GET /auth/me — happy path returns { user, school, roles, permissions }", async () => {
    const token = await loginAndGetToken();
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user?.id).toBe(userId);
    expect(res.body.school?.id).toBe(schoolId);
    expect(res.body.user.passwordHash).toBeUndefined();

    // Owner role grant → permissions: ["*"].
    expect(Array.isArray(res.body.roles)).toBe(true);
    expect(res.body.roles.some((r: { key: string }) => r.key === "owner")).toBe(true);
    expect(res.body.permissions).toEqual(["*"]);
  });

  // -----------------------------------------------------------------------
  // POST /auth/logout
  // -----------------------------------------------------------------------

  it("POST /auth/logout — happy path returns 204, deletes session row, writes audit row", async () => {
    const token = await loginAndGetToken();
    const sessionsBefore = await withTenant(schoolId, (db) =>
      db.session.count({ where: { userId } }),
    );

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const sessionsAfter = await withTenant(schoolId, (db) =>
      db.session.count({ where: { userId } }),
    );
    expect(sessionsAfter).toBe(sessionsBefore - 1);

    const auditRows = await withTenant(schoolId, (db) =>
      db.auditLog.findMany({
        where: { schoolId, action: "auth.logout", userId },
      }),
    );
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
  });

  it("POST /auth/logout — token is invalidated; subsequent /me returns 401 INVALID_SESSION", async () => {
    const token = await loginAndGetToken();
    const out = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(out.status).toBe(204);

    const me = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(401);
    expect(me.body.error?.code).toBe("INVALID_SESSION");
  });

  it("POST /auth/logout — second logout with same token → 401 INVALID_SESSION (guard rejects before service)", async () => {
    const token = await loginAndGetToken();
    const first = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(204);

    const second = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(second.status).toBe(401);
    expect(second.body.error?.code).toBe("INVALID_SESSION");
  });
});
