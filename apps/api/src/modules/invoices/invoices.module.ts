import { Module } from "@nestjs/common";
import { PaystackModule } from "../../common/paystack/paystack.module.js";

import { InvoiceGenerationService } from "./invoice-generation.service.js";
import { InvoicesController } from "./invoices.controller.js";
import { PaymentLinkInvalidationService } from "./payment-link-invalidation.service.js";
import { PaymentLinksService } from "./payment-links.service.js";

@Module({
  imports: [PaystackModule],
  controllers: [InvoicesController],
  providers: [InvoiceGenerationService, PaymentLinksService, PaymentLinkInvalidationService],
  exports: [InvoiceGenerationService, PaymentLinksService, PaymentLinkInvalidationService],
})
export class InvoicesModule {}
