import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ClassSubjectsController } from "./class-subjects.controller";
import { ClassSubjectsService } from "./class-subjects.service";

@Module({
  imports: [AuthModule],
  controllers: [ClassSubjectsController],
  providers: [ClassSubjectsService],
  exports: [ClassSubjectsService],
})
export class ClassSubjectsModule {}
