import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { PushModule } from "../../common/push/push.module";
import { PUSH_QUEUE } from "../../common/queue";
import { AuthModule } from "../auth/auth.module";
import { NotificationDispatchService } from "./notification-dispatch.service";
import { NotificationPreferencesController } from "./notification-preferences.controller";
import { NotificationPreferencesService } from "./notification-preferences.service";
import { PushProcessor } from "./push.processor";

// Exports NotificationPreferencesService so GuardiansModule and
// FinanceModule can inject it for enforcement (getEnabledChannels) without
// depending on each other — see docs/modules/phase-4.md §8 D5.
// Phase 6 / Slice 5 adds the push half: the dispatch service (which channel),
// the queue, and the processor (the actual send). It lives HERE rather than
// in a new module because the channel decision reads the very preferences
// this module already owns — a separate module would either duplicate that
// read or import this one for a single method.
@Module({
  imports: [AuthModule, PushModule, BullModule.registerQueue({ name: PUSH_QUEUE })],
  controllers: [NotificationPreferencesController],
  providers: [NotificationPreferencesService, NotificationDispatchService, PushProcessor],
  exports: [NotificationPreferencesService, NotificationDispatchService],
})
export class NotificationsModule {}
