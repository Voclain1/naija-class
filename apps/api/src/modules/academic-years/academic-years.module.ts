import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AcademicYearsController } from "./academic-years.controller";
import { AcademicYearsService } from "./academic-years.service";

@Module({
  // AuthModule exports AuthGuard so the controller's @UseGuards(AuthGuard)
  // can resolve it via DI. Same pattern as SchoolsModule / UsersModule.
  imports: [AuthModule],
  controllers: [AcademicYearsController],
  providers: [AcademicYearsService],
  exports: [AcademicYearsService],
})
export class AcademicYearsModule {}
