import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { Global, Module, INestApplication } from "@nestjs/common";
import request from "supertest";

import { basePrisma } from "@school-kit/db";

import { REDIS_AUTH_CLIENT } from "../../common/auth/redis-auth.provider";
import { AuthModule } from "./auth.module";
import { HttpExceptionFilter } from "../../common/http-exception.filter";

// HTTP-level smoke spec — proves the controller + pipe + filter all wire up
// correctly, the response shape matches the spec, and error codes are
// surfaced as documented. Service-level invariants (atomicity, hash
// algorithm, audit redaction) are covered in auth.service.spec.ts.

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

describe("POST /auth/signup-owner (controller integration)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const phoneSuffix = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  const schoolIdsToCleanup = new Set<string>();
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MockRedisAuthModule, AuthModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  const validBody = (overrides: Record<string, unknown> = {}) => ({
    schoolName: "Controller Spec Academy",
    schoolSlug: `ctrl-${runId}`,
    ownerFirstName: "Ctrl",
    ownerLastName: "Tester",
    ownerEmail: `ctrl-${runId}@example.test`,
    ownerPhone: `+234810${phoneSuffix}`,
    password: "Correct-Horse-9",
    ndprConsent: true,
    ...overrides,
  });

  it("happy path — returns 201 with { user, school, token }", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/signup-owner")
      .send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.school).toBeDefined();
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.error).toBeUndefined();

    schoolIdsToCleanup.add(res.body.school.id);
  });

  it("missing ndprConsent — 400 VALIDATION_ERROR", async () => {
    const body = validBody({
      schoolSlug: `ctrl2-${runId}`,
      ownerEmail: `ctrl2-${runId}@example.test`,
      ownerPhone: `+234811${phoneSuffix}`,
      ndprConsent: false,
    });

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/signup-owner")
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.body.error?.details)).toContain("ndprConsent");
  });

  it("slug already taken — 409 SCHOOL_SLUG_TAKEN", async () => {
    const body = validBody({
      ownerEmail: `ctrl3-${runId}@example.test`,
      ownerPhone: `+234812${phoneSuffix}`,
    });
    // The slug `ctrl-${runId}` was claimed by the happy-path test above.
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/signup-owner")
      .send(body);

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("SCHOOL_SLUG_TAKEN");
  });

  it("weak password — 400 VALIDATION_ERROR with password in details", async () => {
    const body = validBody({
      schoolSlug: `ctrl4-${runId}`,
      ownerEmail: `ctrl4-${runId}@example.test`,
      ownerPhone: `+234813${phoneSuffix}`,
      password: "abcdefg",
    });

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/signup-owner")
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.body.error?.details)).toContain("password");
  });

  it("reserved slug — 400 VALIDATION_ERROR", async () => {
    const body = validBody({
      schoolSlug: "admin",
      ownerEmail: `ctrl5-${runId}@example.test`,
      ownerPhone: `+234814${phoneSuffix}`,
    });

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/signup-owner")
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.body.error?.details)).toContain("schoolSlug");
  });

  it("invalid slug format — 400 VALIDATION_ERROR", async () => {
    const body = validBody({
      schoolSlug: "-bad",
      ownerEmail: `ctrl6-${runId}@example.test`,
      ownerPhone: `+234815${phoneSuffix}`,
    });

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/signup-owner")
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
  });
});
