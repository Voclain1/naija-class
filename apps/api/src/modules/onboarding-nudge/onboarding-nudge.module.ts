import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module.js";
import { OnboardingNudgeService } from "./onboarding-nudge.service.js";

// No controller — cron-only, same shape as SystemModule/PartitionService.
@Module({
  imports: [EmailModule],
  providers: [OnboardingNudgeService],
})
export class OnboardingNudgeModule {}
