import { Module } from "@nestjs/common";

import { QuestionBankModule } from "../question-bank/question-bank.module.js";
import { ExamPapersController } from "./exam-papers.controller.js";
import { ExamPapersService } from "./exam-papers.service.js";

@Module({
  imports: [QuestionBankModule],
  controllers: [ExamPapersController],
  providers: [ExamPapersService],
})
export class ExamPapersModule {}
