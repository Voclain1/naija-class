import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { FeatureSwitchesService } from "./feature-switches.service";

// Not @Global(): like AiModule, an explicit import in each module that gates a
// feature makes "this module depends on a feature switch" visible.
@Module({
  providers: [
    {
      provide: FeatureSwitchesService,
      inject: [ConfigService],
      // A factory, so the optional clock parameter is not read by Nest's
      // reflection as a provider it must resolve.
      useFactory: (config: ConfigService) => new FeatureSwitchesService(config),
    },
  ],
  exports: [FeatureSwitchesService],
})
export class FeatureSwitchesModule {}
