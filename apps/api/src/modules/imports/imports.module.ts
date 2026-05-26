import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { IMPORTS_QUEUE } from "../../common/queue";
import { AuthModule } from "../auth/auth.module";
import { ImportsController } from "./imports.controller";
import { ImportsService } from "./imports.service";

// ImportsModule — CSV import surface (slices 6, 7, 8).
//
// cp1 only registers the queue (so producers can inject Queue<...> in
// cp2) and the skeleton controller/service. The validate processor
// (cp3) is registered here as a Provider once written; the commit
// processor (slice 7) follows the same pattern.
//
// AuthModule is imported so the controller's @UseGuards(AuthGuard)
// resolves — same shape as every other feature module in Phase 1.

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
  providers: [ImportsService],
  exports: [ImportsService],
})
export class ImportsModule {}
