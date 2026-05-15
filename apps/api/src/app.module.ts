import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { HealthController } from "./health/health.controller";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { AuthModule } from "./modules/auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
