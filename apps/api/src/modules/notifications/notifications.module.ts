import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { NotificationPreferencesController } from "./notification-preferences.controller";
import { NotificationPreferencesService } from "./notification-preferences.service";

// Exports NotificationPreferencesService so GuardiansModule and
// FinanceModule can inject it for enforcement (getEnabledChannels) without
// depending on each other — see docs/modules/phase-4.md §8 D5.
@Module({
  imports: [AuthModule],
  controllers: [NotificationPreferencesController],
  providers: [NotificationPreferencesService],
  exports: [NotificationPreferencesService],
})
export class NotificationsModule {}
