import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module.js";
import { TermiiModule } from "../../common/termii/termii.module.js";
import { AuthModule } from "../auth/auth.module";
import { NotificationDispatchModule } from "../notifications/notification-dispatch.module";
import { GuardiansController } from "./guardians.controller";
import { GuardiansService } from "./guardians.service";

@Module({
  // EmailModule/TermiiModule/NotificationDispatchModule — Phase 4 / Slice 6: the
  // guardian-invite flow now actually sends email/SMS (gated by
  // NotificationPreferencesService.getEnabledChannels), not just a
  // console.log. See docs/deferred.md "Wire Resend for real invitation
  // email delivery".
  imports: [AuthModule, EmailModule, TermiiModule, NotificationDispatchModule],
  controllers: [GuardiansController],
  providers: [GuardiansService],
  exports: [GuardiansService],
})
export class GuardiansModule {}
