import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { EmailModule } from "../../../common/email/email.module";
import { TermiiModule } from "../../../common/termii/termii.module";
import { NotificationPreferencesModule } from "../notification-preferences.module";
import { GuardianMessagingConsentService } from "./guardian-messaging-consent.service";
import { MetaConnectionsService } from "./meta-connections.service";
import { PaidMessagingService } from "./paid-messaging.service";

@Module({
  imports: [ConfigModule, NotificationPreferencesModule, TermiiModule, EmailModule],
  providers: [GuardianMessagingConsentService, MetaConnectionsService, PaidMessagingService],
  exports: [GuardianMessagingConsentService, MetaConnectionsService, PaidMessagingService],
})
export class PaidMessagingModule {}
