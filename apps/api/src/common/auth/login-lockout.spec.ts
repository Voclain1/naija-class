import Redis from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

import {
  HARD_LOCK_SECONDS,
  LoginLockoutService,
  isHardLock,
  lockSecondsAfter,
  lockoutIdentity,
} from "./login-lockout";

// The schedule approved at the Phase 6 / Slice 3 review (docs/deferred.md),
// stated as a table so a change to it is a visible edit here.
describe("lockSecondsAfter — the approved schedule", () => {
  it.each([
    [1, 0],
    [5, 0],
    [6, 5],
    [7, 15],
    [8, 30],
    [9, 60],
    [10, 120],
    [11, 900],
    [40, 900],
  ])("after %i failures the next attempt waits %is", (failures, seconds) => {
    expect(lockSecondsAfter(failures)).toBe(seconds);
  });

  it("only the 15-minute lock is a hard lock", () => {
    expect([10, 11, 12].map(isHardLock)).toEqual([false, true, true]);
  });

  it("never raises the hard lock above 15 minutes — a script can lock a cohort, so it must stay short", () => {
    expect(HARD_LOCK_SECONDS).toBe(15 * 60);
  });
});

describe("lockoutIdentity", () => {
  it("normalises what was typed, so trivial variants share one count", () => {
    expect(lockoutIdentity("student", " Kings-College ", "ADM/001 ")).toBe(
      lockoutIdentity("student", "kings-college", "adm/001"),
    );
  });

  it("keeps students and guardians in separate namespaces", () => {
    expect(lockoutIdentity("student", "x")).not.toBe(lockoutIdentity("guardian", "x"));
  });
});

describe("LoginLockoutService — against real Redis", () => {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const service = new LoginLockoutService(redis);
  const run = Math.random().toString(36).slice(2, 8);
  afterAll(async () => {
    await redis.quit();
  });

  const fails = async (identity: string, n: number) => {
    for (let i = 0; i < n; i++) await service.recordFailure(identity);
  };

  it("lets five failures through, then refuses the next attempt with Retry-After", async () => {
    const id = `test:${run}:soft`;
    await fails(id, 5);
    await expect(service.check(id)).resolves.toBeUndefined();

    await fails(id, 1);
    await expect(service.check(id)).rejects.toMatchObject({
      code: "LOGIN_LOCKED",
      httpStatus: 429,
      details: { retryAfterSeconds: 5 },
    });
  });

  it("a hard lock slides: an attempt during it restarts the full 15 minutes", async () => {
    const id = `test:${run}:hard`;
    await fails(id, 11);
    // Pretend most of the lock has passed.
    await redis.expire(`login-lockout:lock:${id}`, 30);

    await expect(service.check(id)).rejects.toMatchObject({ details: { retryAfterSeconds: HARD_LOCK_SECONDS } });
    expect(await redis.ttl(`login-lockout:lock:${id}`)).toBeGreaterThan(HARD_LOCK_SECONDS - 5);
  });

  it("a soft lock does NOT slide — it simply runs out", async () => {
    const id = `test:${run}:noslide`;
    await fails(id, 7); // 15s lock
    await expect(service.check(id)).rejects.toMatchObject({ details: { retryAfterSeconds: 15 } });
    expect(await redis.ttl(`login-lockout:lock:${id}`)).toBeLessThanOrEqual(15);
  });

  it("clear forgets the failures and the lock", async () => {
    const id = `test:${run}:clear`;
    await fails(id, 11);
    await service.clear(id);
    await expect(service.check(id)).resolves.toBeUndefined();
    // And the count restarted: one more failure locks nothing.
    await fails(id, 1);
    await expect(service.check(id)).resolves.toBeUndefined();
  });

  it("the failure window expires 30 minutes after the most recent failure", async () => {
    const id = `test:${run}:window`;
    await fails(id, 1);
    const ttl = await redis.ttl(`login-lockout:fail:${id}`);
    expect(ttl).toBeGreaterThan(30 * 60 - 5);
    expect(ttl).toBeLessThanOrEqual(30 * 60);
  });
});
