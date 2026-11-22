import { Module } from "@nestjs/common";

import { OpenAiVoiceProvider } from "./openai-voice.provider.js";
import { VOICE_CONFIG, readVoiceConfig, type VoiceConfig } from "./voice.config.js";
import { VoiceLedger } from "./voice-ledger.js";
import { VOICE_PROVIDER, type VoiceProviderPort } from "./voice-provider.port.js";

// Voice configuration, the provider and the usage ledger, with nothing of the
// assistant attached: the platform admin imports this to report and control
// voice without pulling in the orchestration stack.
//
// The provider is null unless VOICE_PROVIDER names one AND its key is real:
// voice then reports PROVIDER_NOT_CONFIGURED and never fakes audio.
@Module({
  providers: [
    { provide: VOICE_CONFIG, useFactory: (): VoiceConfig => readVoiceConfig() },
    {
      provide: VOICE_PROVIDER,
      inject: [VOICE_CONFIG],
      useFactory: (config: VoiceConfig): VoiceProviderPort | null =>
        config.provider === "openai" && config.apiKey ? new OpenAiVoiceProvider(config.apiKey, config.apiBaseUrl) : null,
    },
    VoiceLedger,
  ],
  exports: [VOICE_CONFIG, VOICE_PROVIDER, VoiceLedger],
})
export class AssistantVoiceCoreModule {}
