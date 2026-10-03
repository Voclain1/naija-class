import { Module } from "@nestjs/common";

import { AiModule } from "../../common/ai/ai.module.js";
import { CurriculumModule } from "../curriculum/curriculum.module.js";
import { QuestionBankController } from "./question-bank.controller.js";
import { QuestionBankService } from "./question-bank.service.js";

// AiModule imported explicitly, as LessonPlansModule does: "who can call
// Claude" stays greppable.
@Module({
  imports: [AiModule, CurriculumModule],
  controllers: [QuestionBankController],
  providers: [QuestionBankService],
  exports: [QuestionBankService],
})
export class QuestionBankModule {}
