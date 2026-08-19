import { Module } from "@nestjs/common";

import { ExpoPushService } from "./expo-push.service.js";

// Exported rather than @Global: only the notification dispatch path sends
// push, and a global provider would invite a controller to send directly,
// bypassing the queue D38 requires and the PII rules D36 sets.
@Module({
  providers: [ExpoPushService],
  exports: [ExpoPushService],
})
export class PushModule {}
