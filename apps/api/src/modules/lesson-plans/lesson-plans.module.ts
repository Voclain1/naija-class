import { Module } from "@nestjs/common";

import { AiModule } from "../../common/ai/ai.module.js";
import { CurriculumModule } from "../curriculum/curriculum.module.js";
import { LessonPlansController } from "./lesson-plans.controller.js";
import { LessonPlansService } from "./lesson-plans.service.js";

// AiModule is imported explicitly rather than being @Global(): "who can call
// Claude" stays greppable, which matters for a surface governed by cost and
// PII hard rules.
@Module({
  imports: [AiModule, CurriculumModule],
  controllers: [LessonPlansController],
  providers: [LessonPlansService],
  exports: [LessonPlansService],
})
export class LessonPlansModule {}
