import { Module } from "@nestjs/common";

import { PaystackModule } from "../../common/paystack/paystack.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { PortalPaymentsController } from "./portal-payments.controller";
import { PortalPaymentsService } from "./portal-payments.service";

@Module({
  imports: [PaystackModule, PaymentsModule],
  controllers: [PortalPaymentsController],
  providers: [PortalPaymentsService],
})
export class PortalPaymentsModule {}
