import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { GradeBoundariesController, GradingSchemeController } from "./grading.controller";
import { GradingService } from "./grading.service";

@Module({
  // AuthModule exports AuthGuard so the controllers' @UseGuards(AuthGuard) can
  // resolve it via DI. Same pattern as AcademicYearsModule.
  imports: [AuthModule],
  controllers: [GradingSchemeController, GradeBoundariesController],
  providers: [GradingService],
  exports: [GradingService],
})
export class GradingModule {}
