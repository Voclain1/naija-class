import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { BehaviourController } from "./behaviour.controller";
import { BehaviourService } from "./behaviour.service";

// Behaviour records (docs/modules/the-school-day.md Part C). No notifications
// module import: nothing here notifies anyone, because nothing here is sent
// anywhere — these records are internal (C14).
@Module({
  imports: [AuthModule],
  controllers: [BehaviourController],
  providers: [BehaviourService],
  exports: [BehaviourService],
})
export class BehaviourModule {}
