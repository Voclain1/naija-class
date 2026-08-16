import { Module } from "@nestjs/common";

import { StudentPortalController } from "./student-portal.controller";
import { StudentPortalService } from "./student-portal.service";
import { ReleasedResultsService } from "../report-cards/released-results.service";

@Module({
  controllers: [StudentPortalController],
  providers: [StudentPortalService, ReleasedResultsService],
})
export class StudentPortalModule {}
