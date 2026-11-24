import { Module } from "@nestjs/common";

import { AiModule } from "../../common/ai/ai.module";
import { EmailModule } from "../../common/email/email.module";
import { FeatureSwitchesModule } from "../../common/features/feature-switches.module";
import { PaystackModule } from "../../common/paystack/paystack.module";
import { AssistantVoiceCoreModule } from "../assistant-voice/assistant-voice-core.module";
import { PaymentsModule } from "../payments/payments.module";
import { MessagingWalletModule } from "../notifications/messaging/messaging-wallet.module";
import { PaidMessagingModule } from "../notifications/messaging/paid-messaging.module";
import { AssistantActivationService } from "./assistant-activation.service";
import { VoiceAdminService } from "./voice-admin.service";
import { PlatformAdminController } from "./platform-admin.controller";
import { PlatformAdminService } from "./platform-admin.service";

@Module({
  // AiModule: read-only here (AssistantActivationService asks whether AI is
  // configured). Nothing in this module calls a model.
  imports: [EmailModule, PaystackModule, FeatureSwitchesModule, AiModule, AssistantVoiceCoreModule, PaidMessagingModule, PaymentsModule, MessagingWalletModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, AssistantActivationService, VoiceAdminService],
})
export class PlatformAdminModule {}
