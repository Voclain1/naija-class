import { Global, INestApplication, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { REDIS_AUTH_CLIENT } from "../common/auth/redis-auth.provider";
import { RedisThrottlerStorage } from "../common/auth/redis-throttler-storage";
import { HealthController } from "./health.controller";

// O-1 (2026-09-23) — the liveness endpoint must cost ZERO Redis commands.
//
// /api/v1/health is Fly's health-check target (apps/api/fly.toml's
// [[http_service.checks]], every 15s). Because ThrottlerGuard is registered
// globally as an APP_GUARD in app.module.ts, every one of those checks was
// running RedisThrottlerStorage.increment against the shared auth Redis
// client. Measured against production on 2026-09-23, three consecutive calls
// returned x-ratelimit-remaining 199, 198, 197 — i.e. real Redis work, done
// purely to rate-limit Fly's own health checker.
//
// This spec wires the SAME global-guard arrangement app.module.ts uses, so it
// exercises the real decision path rather than a simplified stand-in, and
// pins three things:
//   1. /health issues no Redis commands at all;
//   2. /health/db still does (it runs a real query — deliberately kept
//      throttled, and it is not on Fly's check path);
//   3. the liveness response shape is unchanged, so Fly's check and the
//      deploy smoke test keep passing.
//
// The Redis client is stubbed: the point here is call COUNTING, not Redis
// behaviour, so a stub is both sufficient and faster than a real connection.

const COMMAND = "schoolKitThrottlerIncrement";

// Covers every Redis method RedisThrottlerStorage might reach for: the
// INCR/EXPIRE/TTL trio it uses today, plus a defineCommand-registered script
// method. Counting all of them keeps this spec honest if the storage layer is
// ever reimplemented — the assertion is "zero Redis calls", by any route.
const mockRedis = {
  defineCommand: vi.fn(),
  [COMMAND]: vi.fn().mockResolvedValue([1, 60]),
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  ttl: vi.fn().mockResolvedValue(60),
};

function redisCallCount(): number {
  return (
    mockRedis[COMMAND].mock.calls.length +
    mockRedis.incr.mock.calls.length +
    mockRedis.expire.mock.calls.length +
    mockRedis.ttl.mock.calls.length
  );
}

@Global()
@Module({
  providers: [{ provide: REDIS_AUTH_CLIENT, useValue: mockRedis }, RedisThrottlerStorage],
  exports: [REDIS_AUTH_CLIENT, RedisThrottlerStorage],
})
class MockRedisAuthModule {}

describe("HealthController — liveness is exempt from Redis throttling", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MockRedisAuthModule,
        ThrottlerModule.forRootAsync({
          inject: [RedisThrottlerStorage],
          useFactory: (storage: RedisThrottlerStorage) => ({
            throttlers: [{ name: "default", ttl: 60000, limit: 200 }],
            storage,
          }),
        }),
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    mockRedis[COMMAND].mockClear();
    mockRedis.incr.mockClear();
    mockRedis.expire.mockClear();
    mockRedis.ttl.mockClear();
  });

  it("GET /api/v1/health makes ZERO Redis calls", async () => {
    await request(app.getHttpServer()).get("/api/v1/health").expect(200);

    expect(redisCallCount()).toBe(0);
  });

  it("stays at zero Redis calls across repeated checks (Fly polls every 15s)", async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer()).get("/api/v1/health").expect(200);
    }

    expect(redisCallCount()).toBe(0);
  });

  it("emits no x-ratelimit-* headers on liveness (the guard did not run)", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/health").expect(200);

    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeUndefined();
  });

  it("preserves the liveness response shape Fly and the smoke test rely on", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/health").expect(200);

    expect(res.body).toMatchObject({ status: "ok", service: "school-kit-api" });
    expect(typeof res.body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  it("does NOT leak the exemption to other routes — /health/db is still throttled", async () => {
    // checkDb() hits the database, which this unit-level module does not wire,
    // so the handler may fail; the guard runs BEFORE the handler, which is
    // exactly what is being asserted. Status is deliberately not pinned.
    await request(app.getHttpServer()).get("/api/v1/health/db");

    expect(redisCallCount()).toBeGreaterThan(0);
  });
});
