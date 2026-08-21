import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AcademicCalendarController } from "./academic-calendar.controller.js";
import { AcademicCalendarService } from "./academic-calendar.service.js";

// Imports AuthModule so the controller's @UseGuards(AuthGuard) resolves via
// DI. Exports the service because SchoolsModule's onboarding step 5 calls
// createInTransaction() inside its own transaction — the wizard path and the
// recovery path share one implementation deliberately (see the service's
// header).
@Module({
  imports: [AuthModule],
  controllers: [AcademicCalendarController],
  providers: [AcademicCalendarService],
  exports: [AcademicCalendarService],
})
export class AcademicCalendarModule {}
