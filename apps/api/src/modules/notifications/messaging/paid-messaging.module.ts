import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { TermiiModule } from "../../../common/termii/termii.module";
import { NotificationDispatchModule } from "../notification-dispatch.module";
import { GuardianMessagingConsentService } from "./guardian-messaging-consent.service";
import { MetaConnectionsService } from "./meta-connections.service";
import { PaidPaymentNotificationsService } from "./paid-payment-notifications.service";

@Module({
  imports: [ConfigModule, NotificationDispatchModule, TermiiModule],
  providers: [GuardianMessagingConsentService, MetaConnectionsService, PaidPaymentNotificationsService],
  exports: [GuardianMessagingConsentService, MetaConnectionsService, PaidPaymentNotificationsService],
})
export class PaidMessagingModule {}
