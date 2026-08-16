import { Module } from "@nestjs/common";

import { PortalStudentsController } from "./portal-students.controller";
import { PortalStudentsService } from "./portal-students.service";
import { StudentAccessService } from "./student-access.service";
import { ReleasedResultsService } from "../report-cards/released-results.service";

@Module({
  controllers: [PortalStudentsController],
  providers: [PortalStudentsService, StudentAccessService, ReleasedResultsService],
})
export class PortalStudentsModule {}
