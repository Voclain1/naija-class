import * as crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { Global, Module, INestApplication } from "@nestjs/common";
import request from "supertest";

import { basePrisma, withTenant } from "@school-kit/db";

import { REDIS_AUTH_CLIENT } from "../../common/auth/redis-auth.provider";
import { AuthModule } from "../auth/auth.module";
import { HttpExceptionFilter } from "../../common/http-exception.filter";
import { InvitationsModule } from "./invitations.module";
import { UsersModule } from "../users/users.module";

// HTTP-level smoke spec. Proves controller routes are PUBLIC (no auth
// required), the response envelope matches the spec, and each error case
// returns the right HTTP status — especially 404 vs 410 discrimination,
// which only the GoneError plumbing test exercises end-to-end.

// Provides a mock Redis client globally so RateLimitByEmailGuard can be
// instantiated without a real Redis connection in the test environment.
// @Global() is required — it mirrors RedisAuthModule's real-app role and
// makes the token visible to AuthModule's own injector scope.
const mockRedis = { incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) };
@Global()
@Module({
  providers: [{ provide: REDIS_AUTH_CLIENT, useValue: mockRedis }],
  exports: [REDIS_AUTH_CLIENT],
})
class MockRedisAuthModule {}

describe("Invitations endpoints (controller integration)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const phoneSuffix = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  const schoolIdsToCleanup = new Set<string>();

  let app: INestApplication;
  let ownerToken: string;
  let ownerSchoolId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MockRedisAuthModule, AuthModule, UsersModule, InvitationsModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const signupRes = await request(app.getHttpServer())
      .post("/api/v1/auth/signup-owner")
      .send({
        schoolName: "Inv Ctrl Academy",
        schoolSlug: `invctrl-${runId}`,
        ownerFirstName: "Oti",
        ownerLastName: "Owner",
        ownerEmail: `invctrl-${runId}@example.test`,
        ownerPhone: `+234830${phoneSuffix}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      });
    expect(signupRes.status).toBe(201);
    ownerToken = signupRes.body.token;
    ownerSchoolId = signupRes.body.school.id;
    schoolIdsToCleanup.add(ownerSchoolId);

    await basePrisma.school.update({
      where: { id: ownerSchoolId },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
  });

  afterAll(async () => {
    await app.close();
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // Helper: create an invitation via the real POST /users/invite path and
  // return its raw token.
  async function createInvitation(email: string, names?: { firstName?: string; lastName?: string }) {
    const res = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email, ...names });
    expect(res.status).toBe(201);
    return { token: res.body.token as string, invitationId: res.body.invitation.id as string };
  }

  // -----------------------------------------------------------------------
  // GET /invitations/:token
  // -----------------------------------------------------------------------

  it("GET /invitations/:token — happy path returns 200 with public-safe DTO (no auth)", async () => {
    const { token } = await createInvitation(`ctrl-get-${runId}@example.test`, {
      firstName: "Ctrl",
      lastName: "GetIt",
    });

    const res = await request(app.getHttpServer()).get(`/api/v1/invitations/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.schoolName).toBe("Inv Ctrl Academy");
    expect(res.body.roleKey).toBe("admin");
    expect(res.body.firstName).toBe("Ctrl");
    expect(res.body.invitedByName).toBe("Oti Owner");
    // Public DTO must not include internal ids
    expect(res.body.schoolId).toBeUndefined();
    expect(res.body.invitationId).toBeUndefined();
    expect(res.body.tokenHash).toBeUndefined();
    expect(res.body.invitedBy).toBeUndefined();
  });

  it("GET /invitations/:token — bogus token returns 404 NOT_FOUND", async () => {
    const bogus = crypto.randomBytes(32).toString("base64url");
    const res = await request(app.getHttpServer()).get(`/api/v1/invitations/${bogus}`);

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("NOT_FOUND");
  });

  it("GET /invitations/:token — accepted token returns 410 INVITATION_ALREADY_ACCEPTED", async () => {
    const { token, invitationId } = await createInvitation(`ctrl-accepted-get-${runId}@example.test`);
    await withTenant(ownerSchoolId, (db) =>
      db.invitation.update({ where: { id: invitationId }, data: { acceptedAt: new Date() } }),
    );

    const res = await request(app.getHttpServer()).get(`/api/v1/invitations/${token}`);

    expect(res.status).toBe(410);
    expect(res.body.error?.code).toBe("INVITATION_ALREADY_ACCEPTED");
  });

  it("GET /invitations/:token — expired token returns 410 INVITATION_EXPIRED", async () => {
    const { token, invitationId } = await createInvitation(`ctrl-expired-get-${runId}@example.test`);
    await withTenant(ownerSchoolId, (db) =>
      db.invitation.update({
        where: { id: invitationId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      }),
    );

    const res = await request(app.getHttpServer()).get(`/api/v1/invitations/${token}`);

    expect(res.status).toBe(410);
    expect(res.body.error?.code).toBe("INVITATION_EXPIRED");
  });

  // -----------------------------------------------------------------------
  // POST /invitations/:token/accept
  // -----------------------------------------------------------------------

  it("POST /invitations/:token/accept — happy path returns 200 with { user, school, token }", async () => {
    const { token } = await createInvitation(`ctrl-acc-${runId}@example.test`);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/invitations/${token}/accept`)
      .send({
        firstName: "Ctrl",
        lastName: "Acc",
        password: "Strong-Pass-9",
        ndprConsent: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.user?.email).toBe(`ctrl-acc-${runId}@example.test`);
    expect(res.body.user?.firstName).toBe("Ctrl");
    expect(res.body.school?.id).toBe(ownerSchoolId);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("POST /invitations/:token/accept — missing ndprConsent returns 400 VALIDATION_ERROR", async () => {
    const { token } = await createInvitation(`ctrl-noconsent-${runId}@example.test`);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/invitations/${token}/accept`)
      .send({
        firstName: "Ctrl",
        lastName: "Acc",
        password: "Strong-Pass-9",
        ndprConsent: false,
      });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("POST /invitations/:token/accept — weak password returns 400 VALIDATION_ERROR", async () => {
    const { token } = await createInvitation(`ctrl-weak-${runId}@example.test`);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/invitations/${token}/accept`)
      .send({
        firstName: "Ctrl",
        lastName: "Acc",
        password: "short",
        ndprConsent: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("POST /invitations/:token/accept — bogus token returns 404", async () => {
    const bogus = crypto.randomBytes(32).toString("base64url");
    const res = await request(app.getHttpServer())
      .post(`/api/v1/invitations/${bogus}/accept`)
      .send({
        firstName: "Ctrl",
        lastName: "Acc",
        password: "Strong-Pass-9",
        ndprConsent: true,
      });

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("NOT_FOUND");
  });

  it("POST /invitations/:token/accept — re-use of accepted token returns 410", async () => {
    const { token } = await createInvitation(`ctrl-reuse-${runId}@example.test`);
    await request(app.getHttpServer())
      .post(`/api/v1/invitations/${token}/accept`)
      .send({
        firstName: "First",
        lastName: "Use",
        password: "Strong-Pass-9",
        ndprConsent: true,
      })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/invitations/${token}/accept`)
      .send({
        firstName: "Second",
        lastName: "Use",
        password: "Strong-Pass-9",
        ndprConsent: true,
      });

    expect(res.status).toBe(410);
    expect(res.body.error?.code).toBe("INVITATION_ALREADY_ACCEPTED");
  });
});
