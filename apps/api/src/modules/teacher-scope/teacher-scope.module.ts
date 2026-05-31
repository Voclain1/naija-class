import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { TeacherScopeController } from "./teacher-scope.controller";
import { TeacherScopeService } from "./teacher-scope.service";

// Exports TeacherScopeService so later modules (e.g. a Phase 2 gradebook
// that must also scope to a teacher's arms) can reuse getMyScope /
// getTeacherScope rather than re-deriving the filter.
@Module({
  imports: [AuthModule],
  controllers: [TeacherScopeController],
  providers: [TeacherScopeService],
  exports: [TeacherScopeService],
})
export class TeacherScopeModule {}
