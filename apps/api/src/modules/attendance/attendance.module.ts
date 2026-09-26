import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { NotificationDispatchModule } from "../notifications/notification-dispatch.module";
import { AttendanceController } from "./attendance.controller";
import { AttendanceService } from "./attendance.service";

@Module({
  // AuthModule exports AuthGuard so the controller's @UseGuards(AuthGuard) can
  // resolve it via DI. getTeacherScope is a plain helper import (no provider).
  // NotificationDispatchModule, NOT NotificationsModule: the dispatch half
  // has the queue and no @Processor, so importing it here does not construct a
  // BullMQ Worker and does not require Redis at module instantiation. The same
  // split PaymentsModule needed.
  imports: [AuthModule, NotificationDispatchModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
