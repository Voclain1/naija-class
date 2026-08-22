import { Module } from "@nestjs/common";
import { PaystackModule } from "../../common/paystack/paystack.module.js";

import { InvoiceGenerationService } from "./invoice-generation.service.js";
import { InvoicesController } from "./invoices.controller.js";
import { PaymentLinksService } from "./payment-links.service.js";

@Module({
  imports: [PaystackModule],
  controllers: [InvoicesController],
  providers: [InvoiceGenerationService, PaymentLinksService],
  exports: [InvoiceGenerationService, PaymentLinksService],
})
export class InvoicesModule {}
