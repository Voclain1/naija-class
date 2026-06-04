import { Module } from "@nestjs/common";

import { AssessmentModule } from "../assessment/assessment.module";
import { AuthModule } from "../auth/auth.module";
import { ReportCardsController } from "./report-card.controller";
import { ReportCardService } from "./report-card.service";

@Module({
  // AuthModule exports AuthGuard; AssessmentModule exports AggregationService
  // (the build pass composes the slice-4 full aggregation in-tx via
  // aggregateArmInTx).
  imports: [AuthModule, AssessmentModule],
  controllers: [ReportCardsController],
  providers: [ReportCardService],
  exports: [ReportCardService],
})
export class ReportCardsModule {}
