import { Inject, Injectable } from "@nestjs/common";
import type { ThrottlerStorage, ThrottlerStorageRecord } from "@nestjs/throttler";
import type Redis from "ioredis";

import { REDIS_AUTH_CLIENT } from "./redis-auth.provider.js";

// Custom ThrottlerStorage backed by the auth Redis client.
// Uses INCR + EXPIRE per-key so TTL is set once on the first request in the
// window; subsequent requests in the same window do NOT reset the TTL.
// Key pattern: thr:<throttlerName>:<ip-or-user-key>
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(REDIS_AUTH_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number, // milliseconds (v6 contract)
    _limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `thr:${throttlerName}:${key}`;
    const ttlSeconds = Math.ceil(ttl / 1000);

    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.expire(redisKey, ttlSeconds);
    }

    const ttlRemaining = await this.redis.ttl(redisKey);
    return {
      totalHits: count,
      timeToExpire: Math.max(0, ttlRemaining),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
