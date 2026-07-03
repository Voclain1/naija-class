import "reflect-metadata";
// Sentry must initialise before NestFactory.create — its OpenTelemetry-based
// instrumentation patches import hooks, and the patching only catches code
// loaded after init runs. A blank SENTRY_DSN_API makes init a no-op.
import { initSentry } from "./observability/sentry";
initSentry();

import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  // rawBody: true makes req.rawBody (Buffer) available alongside the parsed
  // req.body. Required for Paystack webhook signature verification — Paystack
  // computes HMAC-SHA512 over the raw bytes before JSON parsing occurs.
  // NestJS 10 populates both; existing ZodValidationPipe / body-reading
  // middleware is unaffected.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix("api/v1");

  // CORS: the web app at :3001 calls this API at :4000, so the browser
  // issues a cross-origin preflight before any non-GET request. We allow
  // a single origin (not "*") because permissive CORS + bearer tokens
  // is a pattern attackers like. credentials: false because Phase 0 auth
  // is `Authorization: Bearer <token>` — no cookies cross this boundary,
  // so the browser does not need the Allow-Credentials handshake.
  // Override CORS_ORIGIN in prod to point at the real web origin.
  const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3001";
  app.enableCors({
    origin: [corsOrigin],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  });

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);

  Logger.log(`School Kit API listening on http://localhost:${port}`, "Bootstrap");
  Logger.log(`CORS enabled for origin ${corsOrigin}`, "Bootstrap");
}

void bootstrap();
