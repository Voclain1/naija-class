import { Module } from "@nestjs/common";
import { PaystackModule } from "../../common/paystack/paystack.module.js";

import { StudentChargeService } from "../finance/student-charge.service.js";
import { InvoiceGenerationService } from "./invoice-generation.service.js";
import { InvoicesController } from "./invoices.controller.js";
import { PaymentLinkInvalidationService } from "./payment-link-invalidation.service.js";
import { PaymentLinksService } from "./payment-links.service.js";

@Module({
  imports: [PaystackModule],
  controllers: [InvoicesController],
  // StudentChargeService is stateless; provided here too so invoices need not
  // import the finance module (which sends reminders and email).
  providers: [InvoiceGenerationService, PaymentLinksService, PaymentLinkInvalidationService, StudentChargeService],
  exports: [InvoiceGenerationService, PaymentLinksService, PaymentLinkInvalidationService],
})
export class InvoicesModule {}
