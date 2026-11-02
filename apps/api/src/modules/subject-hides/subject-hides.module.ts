import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { SubjectHidesController } from "./subject-hides.controller";
import { SubjectHidesService } from "./subject-hides.service";

// Hidden subjects (2026-11-02, docs/modules/subjects-by-class.md).
@Module({
  imports: [AuthModule],
  controllers: [SubjectHidesController],
  providers: [SubjectHidesService],
})
export class SubjectHidesModule {}
