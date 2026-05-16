import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
