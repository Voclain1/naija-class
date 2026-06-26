import { Global, Module } from "@nestjs/common";

import { REDIS_AUTH_CLIENT, redisAuthProvider } from "./redis-auth.provider.js";
import { RedisThrottlerStorage } from "./redis-throttler-storage.js";

// Global module — exported providers are available to every feature module
// without explicit imports. Mirrors QueueModule's pattern.
@Global()
@Module({
  providers: [redisAuthProvider, RedisThrottlerStorage],
  exports: [REDIS_AUTH_CLIENT, RedisThrottlerStorage],
})
export class RedisAuthModule {}
