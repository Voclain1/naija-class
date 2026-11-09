import { BillingRunsController } from "./billing-runs.controller.js";
import { BillingRunsService } from "./billing-runs.service.js";
import { FeatureSwitchesModule } from "../../common/features/feature-switches.module.js";
import { AiModule } from "../../common/ai/ai.module.js";
import { Module } from "@nestjs/common";
import { PaystackModule } from "../../common/paystack/paystack.module.js";

import { StudentChargeService } from "../finance/student-charge.service.js";
import { InvoiceGenerationService } from "./invoice-generation.service.js";
import { InvoicesController } from "./invoices.controller.js";
import { PaymentLinkInvalidationService } from "./payment-link-invalidation.service.js";
import { PaymentLinksService } from "./payment-links.service.js";

@Module({
  imports: [PaystackModule, FeatureSwitchesModule, AiModule],
  controllers: [InvoicesController, BillingRunsController],
  // StudentChargeService is stateless; provided here too so invoices need not
  // import the finance module (which sends reminders and email).
  providers: [BillingRunsService, InvoiceGenerationService, PaymentLinksService, PaymentLinkInvalidationService, StudentChargeService],
  // BillingRunsService: the SchoolKit Assistant prepares (never approves) runs through it.
  exports: [InvoiceGenerationService, PaymentLinksService, PaymentLinkInvalidationService, BillingRunsService],
})
export class InvoicesModule {}
