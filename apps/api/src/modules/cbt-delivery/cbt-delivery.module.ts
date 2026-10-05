import { Module } from "@nestjs/common";

import { CbtDeliveryController } from "./cbt-delivery.controller.js";
import { CbtDeliveryService } from "./cbt-delivery.service.js";

// Online exams (CBT2) — the public delivery endpoints (docs/modules/cbt.md D9).
// Imports nothing from the rest of the API on purpose, so it can run alone as
// the exam-day service (`API_MODE=cbt-delivery`, CBT4).
@Module({
  controllers: [CbtDeliveryController],
  providers: [CbtDeliveryService],
})
export class CbtDeliveryModule {}
