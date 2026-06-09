import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { SubjectAttendanceController } from "./subject-attendance.controller";
import { SubjectAttendanceService } from "./subject-attendance.service";

@Module({
  // AuthModule exports AuthGuard so the controller's @UseGuards(AuthGuard) can
  // resolve it via DI. getTeacherScope + the attendance/shared helpers are plain
  // imports (no providers).
  imports: [AuthModule],
  controllers: [SubjectAttendanceController],
  providers: [SubjectAttendanceService],
  exports: [SubjectAttendanceService],
})
export class SubjectAttendanceModule {}
