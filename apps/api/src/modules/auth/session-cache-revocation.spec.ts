import * as crypto from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import type Redis from "ioredis";

import { basePrisma, withTenant } from "@school-kit/db";

import { HttpExceptionFilter } from "../../common/http-exception.filter";
import { RedisAuthModule } from "../../common/auth/redis-auth.module";
import { REDIS_AUTH_CLIENT } from "../../common/auth/redis-auth.provider";
import { createSession } from "../../common/auth/sessions";
import { TeacherProfilesModule } from "../teacher-profiles/teacher-profiles.module";

// Real Redis + real Postgres integration spec — deliberately does NOT mock
// REDIS_AUTH_CLIENT (unlike every other controller-integration spec in this
// codebase — see their own "get always misses" comments). The whole point
// here is to prove the session cache (session-cache.ts, added 2026-07-31 to
// close the #4 production-stall investigation in docs/deferred.md) genuinely
// caches a resolved session AND that every real revocation path — logout,
// password-reset's "kill all sessions", and user deactivation — clears that
// cache entry immediately, not "eventually, once the 30s TTL expires." A
// revoked session that keeps authenticating from a stale cache for up to 30s
// would be a real security regression, so this is the one spec in the suite
// that must exercise the actual cache, not a stand-in.
//
// TeacherProfilesModule pulls in AuthModule internally (see its own
// teacher-profiles.module.ts), so importing it alone gives us signup/login/
// logout/me/reset-password AND the teacher-profile create/delete routes
// needed for the deactivation test.

describe("Session cache — revocation correctness (2026-07-31)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let phoneCounter = 0;
  function randomPhone(): string {
    phoneCounter += 1;
    const random = Math.floor(Math.random() * 1_000_000_00)
      .toString()
      .padStart(8, "0");
    return `+23498${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
  }

  const schoolIdsToCleanup = new Set<string>();
  let app: INestApplication;
  let redis: Redis;
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const password = "Correct-Horse-9";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        RedisAuthModule,
        TeacherProfilesModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    redis = moduleRef.get(REDIS_AUTH_CLIENT);
  });

  afterAll(async () => {
    await app.close();
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  async function signupOwner(suffix: string) {
    const email = `revoke-${suffix}-${runId}@example.test`;
    const res = await request(app.getHttpServer()).post("/api/v1/auth/signup-owner").send({
      schoolName: `Revocation Spec ${suffix}`,
      schoolSlug: `revoke-${suffix}-${runId}`,
      ownerFirstName: "Rev",
      ownerLastName: "Owner",
      ownerEmail: email,
      ownerPhone: randomPhone(),
      password,
      ndprConsent: true,
    });
    expect(res.status).toBe(201);
    schoolIdsToCleanup.add(res.body.school.id);
    return { schoolId: res.body.school.id as string, userId: res.body.user.id as string, email };
  }

  function cacheKeyFor(rawToken: string): string {
    return `session:${crypto.createHash("sha256").update(rawToken).digest("hex")}`;
  }

  it("logout invalidates the cache immediately — a cached session cannot outlive an explicit logout", async () => {
    const { email } = await signupOwner("logout");

    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(login.status).toBe(200);
    const token = login.body.token as string;

    // Warm the cache.
    const warm = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(warm.status).toBe(200);

    // Confirm it's actually cached — not just "would have worked from DB too".
    expect(await redis.get(cacheKeyFor(token))).not.toBeNull();

    const logout = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(logout.status).toBe(204);

    // The cache entry itself must be gone, not just the DB row.
    expect(await redis.get(cacheKeyFor(token))).toBeNull();

    // Same token must be rejected IMMEDIATELY — not "eventually, once the
    // 30s TTL expires".
    const retry = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(retry.status).toBe(401);
    expect(retry.body.error?.code).toBe("INVALID_SESSION");
  });

  it("password reset's 'kill all sessions' invalidates the cache immediately", async () => {
    const { schoolId, userId, email } = await signupOwner("reset");

    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(login.status).toBe(200);
    const token = login.body.token as string;

    const warm = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(warm.status).toBe(200);
    expect(await redis.get(cacheKeyFor(token))).not.toBeNull();

    // Mint a real reset token the same shape AuthService.forgotPassword
    // would (see auth.password-reset.spec.ts's identical pattern).
    const rawResetToken = crypto.randomBytes(32).toString("base64url");
    const resetTokenHash = crypto.createHash("sha256").update(rawResetToken).digest("hex");
    await withTenant(schoolId, (db) =>
      db.passwordResetToken.create({
        data: {
          schoolId,
          userId,
          tokenHash: resetTokenHash,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      }),
    );

    const reset = await request(app.getHttpServer())
      .post("/api/v1/auth/reset-password")
      .send({ token: rawResetToken, password: "New-Correct-Horse-9" });
    expect(reset.status).toBe(200);

    // Cache entry gone immediately after the reset — not just the DB row.
    expect(await redis.get(cacheKeyFor(token))).toBeNull();

    const retry = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(retry.status).toBe(401);
    expect(retry.body.error?.code).toBe("INVALID_SESSION");
  });

  it("deactivating a user (teacher-profile delete) invalidates the cache immediately — USER_INACTIVE, not a stale-valid 200", async () => {
    const { schoolId, email: ownerEmail } = await signupOwner("deactivate");

    // Create a teacher user directly (same pattern as
    // teacher-profiles.service.spec.ts's makeTeacher helper) — no need to
    // go through the invite/accept flow for this test.
    const teacherRole = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key: "teacher", isSystem: true },
      select: { id: true },
    });
    const teacherUserId = await withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: {
          schoolId,
          email: `revoke-deactivate-teacher-${runId}@example.test`,
          firstName: "Tessy",
          lastName: "Teacher",
        },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: user.id, roleId: teacherRole.id } });
      return user.id;
    });

    // Admin (owner) creates the teacher profile — required before delete()
    // will accept the id.
    const ownerLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: ownerEmail, password });
    expect(ownerLogin.status).toBe(200);
    const ownerToken = ownerLogin.body.token as string;

    const createProfile = await request(app.getHttpServer())
      .post("/api/v1/teacher-profiles")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ userId: teacherUserId, staffNumber: `REV-${runId}` });
    expect(createProfile.status).toBe(201);
    const profileId = createProfile.body.id as string;

    // Mint a real session for the teacher directly (bypasses needing a real
    // password for this user — same shortcut auth.session.spec.ts's
    // "expired session" test uses).
    const { rawToken: teacherToken } = await createSession(schoolId, teacherUserId, reqCtx);

    const warm = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${teacherToken}`);
    expect(warm.status).toBe(200);
    expect(await redis.get(cacheKeyFor(teacherToken))).not.toBeNull();

    const deactivate = await request(app.getHttpServer())
      .delete(`/api/v1/teacher-profiles/${profileId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(deactivate.status).toBe(204);

    // Cache entry gone immediately — the session ROW itself is deliberately
    // NOT deleted by this path (see TeacherProfilesService.delete's own
    // comment), only its cached "is active" answer.
    expect(await redis.get(cacheKeyFor(teacherToken))).toBeNull();

    const retry = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${teacherToken}`);
    expect(retry.status).toBe(401);
    expect(retry.body.error?.code).toBe("USER_INACTIVE");
  });

  it("a cache HIT actually resolves the request correctly (not just 'does not crash') — repeated calls with the same token return the same identity", async () => {
    const { email, userId } = await signupOwner("hit");
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password });
    const token = login.body.token as string;

    // First call: DB path, populates cache.
    const first = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(first.body.user?.id).toBe(userId);

    // Second call: must be served from cache (same key now present) and
    // return the identical, correct identity — not a cache-shape bug
    // silently returning the wrong user/school.
    expect(await redis.get(cacheKeyFor(token))).not.toBeNull();
    const second = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(second.status).toBe(200);
    expect(second.body.user?.id).toBe(userId);
  });
});
