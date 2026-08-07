import { Controller, Get, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { RedisAuthModule } from "./common/auth/redis-auth.module";
import { QueueModule } from "./common/queue";
import { StorageModule } from "./common/storage";
import { ReportCardRenderModule } from "./modules/report-cards/render/report-card-render.module";
import { ReportCardsModule } from "./modules/report-cards/report-cards.module";

// Minimal health endpoint for Fly.io scale-to-zero.
// auto_start_machines fires when Fly detects inbound HTTP traffic. The API
// calls RENDER_WORKER_URL/health after enqueuing a render batch, waking this
// machine if it is currently stopped.
@Controller()
class WorkerHealthController {
  @Get("health")
  health(): { status: string } {
    return { status: "ok" };
  }
}

// RenderWorkerModule — root module for the school-kit-render-worker Fly app.
//
// Imports the minimum required for the BullMQ render processor:
//   QueueModule   — BullMQ + Redis connection (global)
//   StorageModule — R2/S3 client for PDF upload (global)
//   ReportCardsModule — ReportCardService (getRenderData) + REPORT_CARDS_QUEUE
//                       token that the processor consumes
//   ReportCardRenderModule — BrowserPool, RenderService, ReportCardRenderProcessor
//
// ReportCardsModule transitively imports AuthModule and AssessmentModule. Their
// controllers load but are never routed (main-render-worker sets no global
// prefix and these paths are never called). NestJS ignores unrouted controllers
// in an HTTP app; the transitive load adds ~20–30 MB RSS but is harmless.
//
// RedisAuthModule (2026-08-07 incident fix): AuthService has required
// REDIS_AUTH_CLIENT since #130 (session cache), but nothing in this module's
// tree ever provided it — AuthModule itself only imports EmailModule, and
// RedisAuthModule was previously wired solely by the main API's AppModule.
// That left every boot of this app crashing during Nest's dependency
// resolution (before the HTTP server or the BullMQ processor ever started),
// which the http_service health check surfaced as a permanent 502 and an
// endless restart loop. RedisAuthModule is @Global(), so importing it here
// once makes REDIS_AUTH_CLIENT available to the transitively-loaded
// AuthService too.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env"],
    }),
    RedisAuthModule,
    QueueModule,
    StorageModule,
    ReportCardsModule,
    ReportCardRenderModule,
  ],
  controllers: [WorkerHealthController],
})
export class RenderWorkerModule {}
