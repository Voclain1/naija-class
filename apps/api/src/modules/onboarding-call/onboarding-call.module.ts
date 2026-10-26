import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { OnboardingCallController, PlatformOnboardingCallsController } from "./onboarding-call.controller.js";
import { OnboardingCallPlatformService } from "./onboarding-call-platform.service.js";
import { OnboardingCallService } from "./onboarding-call.service.js";

// Setup calls (docs/modules/onboarding-call.md).
@Module({
  imports: [AuthModule, EmailModule],
  controllers: [OnboardingCallController, PlatformOnboardingCallsController],
  providers: [OnboardingCallService, OnboardingCallPlatformService],
})
export class OnboardingCallModule {}
