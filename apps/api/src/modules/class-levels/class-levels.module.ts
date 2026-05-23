import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ClassLevelsController } from "./class-levels.controller";
import { ClassLevelsService } from "./class-levels.service";

@Module({
  // AuthModule exports AuthGuard for @UseGuards(AuthGuard). Same DI pattern
  // as AcademicYearsModule / SchoolsModule.
  imports: [AuthModule],
  controllers: [ClassLevelsController],
  providers: [ClassLevelsService],
  exports: [ClassLevelsService],
})
export class ClassLevelsModule {}
