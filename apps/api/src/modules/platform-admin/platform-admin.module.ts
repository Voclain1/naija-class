import { Module } from "@nestjs/common";

import { AiModule } from "../../common/ai/ai.module";
import { EmailModule } from "../../common/email/email.module";
import { FeatureSwitchesModule } from "../../common/features/feature-switches.module";
import { PaystackModule } from "../../common/paystack/paystack.module";
import { AssistantActivationService } from "./assistant-activation.service";
import { PlatformAdminController } from "./platform-admin.controller";
import { PlatformAdminService } from "./platform-admin.service";

@Module({
  // AiModule: read-only here (AssistantActivationService asks whether AI is
  // configured). Nothing in this module calls a model.
  imports: [EmailModule, PaystackModule, FeatureSwitchesModule, AiModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, AssistantActivationService],
})
export class PlatformAdminModule {}
