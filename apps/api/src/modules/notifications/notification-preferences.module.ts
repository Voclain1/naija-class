import { Module } from "@nestjs/common";

import { NotificationPreferencesService } from "./notification-preferences.service";

@Module({
  providers: [NotificationPreferencesService],
  exports: [NotificationPreferencesService],
})
export class NotificationPreferencesModule {}
