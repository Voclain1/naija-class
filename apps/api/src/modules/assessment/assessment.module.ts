import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AggregationService } from "./aggregation.service";
import { AssessmentScoresController, AssessmentsController } from "./assessment.controller";
import { AssessmentService } from "./assessment.service";

@Module({
  // AuthModule exports AuthGuard so the controllers' @UseGuards(AuthGuard) can
  // resolve it via DI. Same pattern as GradingModule.
  imports: [AuthModule],
  controllers: [AssessmentScoresController, AssessmentsController],
  providers: [AssessmentService, AggregationService],
  exports: [AssessmentService, AggregationService],
})
export class AssessmentModule {}
