import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);

  Logger.log(`School Kit API listening on http://localhost:${port}`, "Bootstrap");
}

void bootstrap();
