import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { IMPORTS_QUEUE } from "../../common/queue";
import { AuthModule } from "../auth/auth.module";
import { ImportsController } from "./imports.controller";
import { ImportsService } from "./imports.service";
import { ImportsProcessor } from "./workers/imports.processor";

// ImportsModule — CSV import surface (slices 6, 7, 8).
//
// ONE @Processor class on IMPORTS_QUEUE: ImportsProcessor. It dispatches
// by `job.name` to handleValidate (slice 6) or handleCommit (slice 7).
// @nestjs/bullmq spawns one BullMQ Worker per @Processor class — adding
// a second @Processor on the same queue would create competing Workers
// and load-balance jobs unpredictably across them. Job-name dispatch is
// the correct pattern for a single queue carrying multiple job kinds.
// Slice 8 (GUARDIANS / TEACHERS) adds more branches in the same
// dispatcher, not new @Processor classes.

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({
      name: IMPORTS_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        // Keep completed jobs for an hour for visibility, failed jobs
        // for 24h so the FailedJobEvent listener has a window to
        // observe + write status=FAILED. Beyond that we rely on
        // ImportJob row state, not the BullMQ side.
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    }),
  ],
  controllers: [ImportsController],
  providers: [ImportsService, ImportsProcessor],
  exports: [ImportsService],
})
export class ImportsModule {}
