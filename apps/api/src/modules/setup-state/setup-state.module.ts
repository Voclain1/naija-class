import { Module } from "@nestjs/common";

import { SetupStateController } from "./setup-state.controller.js";
import { SetupStateService } from "./setup-state.service.js";

// No dependencies — SetupStateService reads counts directly under withTenant
// rather than composing other modules' services. Every count it needs is a
// single aggregate; routing them through nine service constructors would
// import most of the app for no gain in correctness.
@Module({
  controllers: [SetupStateController],
  providers: [SetupStateService],
})
export class SetupStateModule {}
