import { Module } from "@nestjs/common";

import { PortalStudentsController } from "./portal-students.controller";
import { PortalStudentsService } from "./portal-students.service";
import { StudentAccessService } from "./student-access.service";
import { LoginLockoutService } from "../../common/auth/login-lockout";
import { ReleasedResultsService } from "../report-cards/released-results.service";
import { ResultPinModule } from "../result-checker/result-pin.module";

@Module({
  imports: [ResultPinModule],
  controllers: [PortalStudentsController],
  providers: [PortalStudentsService, StudentAccessService, ReleasedResultsService, LoginLockoutService],
})
export class PortalStudentsModule {}
