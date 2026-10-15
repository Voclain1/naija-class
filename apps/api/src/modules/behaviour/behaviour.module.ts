import { Module } from "@nestjs/common";

import { TermiiModule } from "../../common/termii/termii.module.js";
import { AuthModule } from "../auth/auth.module";
import { NotificationDispatchModule } from "../notifications/notification-dispatch.module.js";
import { BehaviourController } from "./behaviour.controller";
import { BehaviourService } from "./behaviour.service";
import { DisciplineController } from "./discipline.controller.js";
import { DisciplineService } from "./discipline.service.js";
import { PortalDisciplineController } from "./portal-discipline.controller.js";

// Behaviour records (docs/modules/the-school-day.md Part C). Records,
// incidents and points stay internal (C14) and notify no one. The one thing
// that reaches a family is an APPROVED suspension or exclusion (Phase 9 /
// CP2.3, CP2-D4), which is why this module now imports the notification
// rail and Termii: DisciplineService is their only user here.
@Module({
  imports: [AuthModule, NotificationDispatchModule, TermiiModule],
  controllers: [BehaviourController, DisciplineController, PortalDisciplineController],
  providers: [BehaviourService, DisciplineService],
  exports: [BehaviourService],
})
export class BehaviourModule {}
