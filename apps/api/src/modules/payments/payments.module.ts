import { Module } from "@nestjs/common";

import { PaystackModule } from "../../common/paystack/paystack.module.js";
import { PaymentPlanService } from "./payment-plan.service.js";
import { PaymentPlansController } from "./payment-plans.controller.js";
import { PaystackController } from "./paystack.controller.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";

// StorageService is provided by the global StorageModule (registered in AppModule).
// PaystackService is provided by PaystackModule (imported below).
// No need to import StorageModule here — it is global.

@Module({
  imports: [PaystackModule],
  controllers: [PaymentsController, PaystackController, PaymentPlansController],
  providers: [PaymentsService, PaymentPlanService],
  exports: [PaymentsService, PaymentPlanService],
})
export class PaymentsModule {}
