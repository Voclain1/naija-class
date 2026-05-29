import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { EnrollmentsController } from "./enrollments.controller";
import { EnrollmentsService } from "./enrollments.service";

// Exports EnrollmentsService so StudentsModule can inject it for the
// slice-4 cascade extension (withdraw/graduate cascade to current
// enrollment) and the current-enrollment join on StudentsService
// list/findById.
@Module({
  imports: [AuthModule],
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
