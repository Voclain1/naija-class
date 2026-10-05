import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";

import { ClientIpThrottlerGuard } from "./common/auth/client-ip-throttler.guard";
import { RedisAuthModule } from "./common/auth/redis-auth.module";
import { RedisThrottlerStorage } from "./common/auth/redis-throttler-storage";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { HealthController } from "./health/health.controller";
import { CbtDeliveryModule } from "./modules/cbt-delivery/cbt-delivery.module";

// Online exams (CBT4) — the exam-day service (docs/modules/cbt.md D9, D10).
//
// The same image as the API, started with API_MODE=cbt-delivery
// (apps/api/fly-cbt.toml). It serves ONLY the two public delivery routes and
// the health check, so an exam-morning spike in a school's lab cannot slow
// fees, attendance or report cards on school-kit-api — and nothing else in the
// API is reachable at this address.
//
// Kept: the error filter (same response shape) and the per-client throttle
// on Redis (the same limits as the full API, which is what the load test
// measures). Not loaded: auth, queues, storage, email, AI — the delivery
// module needs none of them.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env"] }),
    RedisAuthModule,
    ThrottlerModule.forRootAsync({
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ name: "default", ttl: 60000, limit: 200 }],
        storage,
      }),
    }),
    CbtDeliveryModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
  ],
})
export class CbtDeliveryAppModule {}
