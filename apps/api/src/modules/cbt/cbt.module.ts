import { Module } from "@nestjs/common";

import { QuestionBankModule } from "../question-bank/question-bank.module.js";
import { CbtSittingsController } from "./cbt-sittings.controller.js";
import { CbtSittingsService } from "./cbt-sittings.service.js";

// Online exams (CBT) — staff side: scheduling sittings (docs/modules/cbt.md).
// The public delivery endpoints (CBT2) live in their own module so they can
// run alone as the exam service (D9).
@Module({
  imports: [QuestionBankModule],
  controllers: [CbtSittingsController],
  providers: [CbtSittingsService],
  exports: [CbtSittingsService],
})
export class CbtModule {}
