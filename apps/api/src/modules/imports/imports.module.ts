import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { IMPORTS_QUEUE } from "../../common/queue";
import { AuthModule } from "../auth/auth.module";
import { ImportsController } from "./imports.controller";
import { ImportsService } from "./imports.service";
import { ImportsValidateProcessor } from "./workers/validate.processor";

// ImportsModule — CSV import surface (slices 6, 7, 8).
//
// cp1 wired the queue + skeleton. cp2 adds the real controller, service,
// and a stub validate processor that flips the job to READY so the
// upload + mapping + GET surfaces close end-to-end today. cp3 replaces
// the stub's body with real validation/parsing/dedup logic — the queue
// wiring and the tenantWorker tenant-safety wrapper stay; only the body
// changes.
//
// The commit processor (slice 7) will land in this module too, registered
// here as another @Processor on IMPORTS_QUEUE.

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({
      name: IMPORTS_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        // Keep completed jobs for an hour for visibility, failed jobs
        // for 24h so the FailedJobEvent listener (cp3) has a window
        // to observe + write status=FAILED. Beyond that we rely on
        // ImportJob row state, not the BullMQ side.
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    }),
  ],
  controllers: [ImportsController],
  providers: [ImportsService, ImportsValidateProcessor],
  exports: [ImportsService],
})
export class ImportsModule {}
