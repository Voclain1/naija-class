import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import {
  HomeworkController,
  PortalHomeworkController,
  StudentHomeworkController,
} from "./homework.controller";
import { HomeworkService } from "./homework.service";

// Homework. Notably does NOT import any notifications module: posting sends no
// push (B9), because five subjects posting daily is five buzzes and a silenced
// app — which would take the absence alert down with it.
@Module({
  imports: [AuthModule],
  controllers: [HomeworkController, PortalHomeworkController, StudentHomeworkController],
  providers: [HomeworkService],
  exports: [HomeworkService],
})
export class HomeworkModule {}
