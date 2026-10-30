import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module.js";
import { AuthModule } from "../auth/auth.module.js";
import {
  ActivationLinksController,
  PlatformActivationController,
} from "./activation.controller.js";
import { ActivationPlatformService } from "./activation-platform.service.js";
import { ActivationService } from "./activation.service.js";

// Getting started (docs/modules/activation.md): setup reminders and the
// platform admin's view of where each school is.
@Module({
  imports: [AuthModule, EmailModule],
  controllers: [ActivationLinksController, PlatformActivationController],
  providers: [ActivationService, ActivationPlatformService],
})
export class ActivationModule {}
