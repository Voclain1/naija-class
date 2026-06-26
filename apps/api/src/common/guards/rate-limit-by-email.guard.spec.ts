import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { RateLimitError } from "@school-kit/types";
import { RateLimitByEmailGuard } from "./rate-limit-by-email.guard.js";

const makeCtx = (email: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ body: { email } }),
    }),
  }) as unknown as ExecutionContext;

describe("RateLimitByEmailGuard", () => {
  let redis: { incr: ReturnType<typeof vi.fn>; expire: ReturnType<typeof vi.fn> };
  let guard: RateLimitByEmailGuard;

  beforeEach(() => {
    redis = { incr: vi.fn(), expire: vi.fn() };
    guard = new RateLimitByEmailGuard(redis as never);
  });

  it("passes when count is below the limit", async () => {
    redis.incr.mockResolvedValue(1);
    redis.expire.mockResolvedValue(1);
    await expect(guard.canActivate(makeCtx("user@example.com"))).resolves.toBe(true);
  });

  it("passes when count equals the limit exactly (not over)", async () => {
    redis.incr.mockResolvedValue(20);
    await expect(guard.canActivate(makeCtx("user@example.com"))).resolves.toBe(true);
  });

  it("throws RateLimitError when count exceeds the limit", async () => {
    redis.incr.mockResolvedValue(21);
    await expect(guard.canActivate(makeCtx("user@example.com"))).rejects.toThrow(RateLimitError);
  });

  it("throws RateLimitError with code RATE_LIMIT_EMAIL", async () => {
    redis.incr.mockResolvedValue(21);
    await expect(guard.canActivate(makeCtx("user@example.com"))).rejects.toMatchObject({
      code: "RATE_LIMIT_EMAIL",
    });
  });

  it("passes when body has no email field", async () => {
    await expect(guard.canActivate(makeCtx(undefined))).resolves.toBe(true);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it("passes when email is not a string", async () => {
    await expect(guard.canActivate(makeCtx(42))).resolves.toBe(true);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it("uses a lowercase-normalised key so casing doesn't circumvent the limit", async () => {
    redis.incr.mockResolvedValue(1);
    redis.expire.mockResolvedValue(1);
    await guard.canActivate(makeCtx("User@Example.COM"));
    expect(redis.incr).toHaveBeenCalledWith("rl:email:user@example.com");
  });

  it("sets TTL only on the first increment (count === 1)", async () => {
    redis.incr.mockResolvedValue(5);
    await guard.canActivate(makeCtx("user@example.com"));
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it("sets a 15-minute TTL on the first increment", async () => {
    redis.incr.mockResolvedValue(1);
    redis.expire.mockResolvedValue(1);
    await guard.canActivate(makeCtx("user@example.com"));
    expect(redis.expire).toHaveBeenCalledWith("rl:email:user@example.com", 15 * 60);
  });
});
