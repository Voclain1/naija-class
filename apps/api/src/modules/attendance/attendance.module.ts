import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AttendanceController } from "./attendance.controller";
import { AttendanceService } from "./attendance.service";

@Module({
  // AuthModule exports AuthGuard so the controller's @UseGuards(AuthGuard) can
  // resolve it via DI. getTeacherScope is a plain helper import (no provider).
  imports: [AuthModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
