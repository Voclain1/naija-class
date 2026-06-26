import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { RateLimitError } from "@school-kit/types";
import type { Request } from "express";
import type Redis from "ioredis";

import { REDIS_AUTH_CLIENT } from "../auth/redis-auth.provider.js";

// Per-email rate limit on POST /auth/login: 20 attempts per 15-minute window.
// Key pattern: rl:email:<normalised-email>
// On first increment, the key is given a 15-min TTL; subsequent increments
// within that window are free — the TTL is NOT reset on every call.
const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 20;

@Injectable()
export class RateLimitByEmailGuard implements CanActivate {
  constructor(@Inject(REDIS_AUTH_CLIENT) private readonly redis: Redis) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const body = req.body as Record<string, unknown>;
    const email = body?.email;
    if (typeof email !== "string" || !email) return true;

    const key = `rl:email:${email.toLowerCase().trim()}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, WINDOW_SECONDS);
    }

    if (count > MAX_ATTEMPTS) {
      throw new RateLimitError(
        "RATE_LIMIT_EMAIL",
        "Too many login attempts for this email. Please try again in 15 minutes.",
      );
    }

    return true;
  }
}
