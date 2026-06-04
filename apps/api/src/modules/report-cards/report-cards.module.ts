import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { REPORT_CARDS_QUEUE } from "../../common/queue";
import { AssessmentModule } from "../assessment/assessment.module";
import { AuthModule } from "../auth/auth.module";
import { ReportCardsController } from "./report-card.controller";
import { ReportCardService } from "./report-card.service";

@Module({
  // AuthModule exports AuthGuard; AssessmentModule exports AggregationService
  // (the build pass composes the slice-4 full aggregation in-tx via
  // aggregateArmInTx).
  //
  // BullModule.registerQueue(REPORT_CARDS_QUEUE) provides the Queue that
  // ReportCardService injects to enqueue per-card render jobs (cp2). The
  // consuming @Processor lives in ReportCardRenderModule; we re-export
  // BullModule so that module can resolve the same queue token. attempts: 2 —
  // a render failure is usually a transient Chromium/page issue worth one
  // retry; beyond that the failed-event listener writes pdfStatus=FAILED.
  imports: [
    AuthModule,
    AssessmentModule,
    BullModule.registerQueue({
      name: REPORT_CARDS_QUEUE,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    }),
  ],
  controllers: [ReportCardsController],
  providers: [ReportCardService],
  exports: [ReportCardService, BullModule],
})
export class ReportCardsModule {}
