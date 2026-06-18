import "reflect-metadata";
// Sentry must initialise before NestFactory.create — same constraint as main.ts.
import { initSentry } from "./observability/sentry";
initSentry();

import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { RenderWorkerModule } from "./render-worker.module";

async function bootstrap() {
  // NestFactory.create (not createApplicationContext) because the render worker
  // needs an HTTP listener for Fly's auto_start_machines to detect inbound
  // traffic and wake a stopped machine. WorkerHealthController provides the
  // sole HTTP surface (GET /health).
  const app = await NestFactory.create(RenderWorkerModule, {
    logger: ["error", "warn", "log"],
  });

  // Fly sends SIGTERM on scale-to-zero and during rolling deploys.
  // Shutdown hooks let BullMQ drain the active render job before the process
  // exits; without this a mid-render SIGTERM leaves the job in an ambiguous
  // state and pdfStatus stays PENDING indefinitely.
  app.enableShutdownHooks();

  const port = Number(process.env.RENDER_WORKER_PORT ?? 4001);
  await app.listen(port);

  Logger.log(`School Kit Render Worker listening on port ${port}`, "Bootstrap");
}

void bootstrap();
