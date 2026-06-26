import type { FactoryProvider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

// Separate Redis client for auth-related keys (rate limiting + 2FA challenge
// tokens). Must NOT reuse BullMQ's connection — BullMQ's connection has
// maxRetriesPerRequest: null and custom error handling tuned for the job queue.
// Mixing concerns causes subtle failures when one side's connection drops.
export const REDIS_AUTH_CLIENT = "REDIS_AUTH_CLIENT" as const;

export const redisAuthProvider: FactoryProvider = {
  provide: REDIS_AUTH_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const url = config.get<string>("REDIS_URL") ?? "redis://localhost:6379";
    const parsed = new URL(url);
    return new Redis({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      db:
        parsed.pathname && parsed.pathname.length > 1
          ? Number(parsed.pathname.slice(1))
          : 0,
      maxRetriesPerRequest: null,
    });
  },
};
