import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { TeacherProfilesController } from "./teacher-profiles.controller";
import { TeacherProfilesService } from "./teacher-profiles.service";

@Module({
  imports: [AuthModule],
  controllers: [TeacherProfilesController],
  providers: [TeacherProfilesService],
  exports: [TeacherProfilesService],
})
export class TeacherProfilesModule {}
