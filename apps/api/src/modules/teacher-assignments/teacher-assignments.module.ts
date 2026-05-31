import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { TeacherAssignmentsController } from "./teacher-assignments.controller";
import { TeacherAssignmentsService } from "./teacher-assignments.service";

// Exports TeacherAssignmentsService so cp2's teacher-scope reads (and any
// later module that needs to resolve a teacher's assignments) can inject it.
@Module({
  imports: [AuthModule],
  controllers: [TeacherAssignmentsController],
  providers: [TeacherAssignmentsService],
  exports: [TeacherAssignmentsService],
})
export class TeacherAssignmentsModule {}
