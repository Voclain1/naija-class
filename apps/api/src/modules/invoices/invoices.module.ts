import { Module } from "@nestjs/common";

import { InvoiceGenerationService } from "./invoice-generation.service.js";
import { InvoicesController } from "./invoices.controller.js";

@Module({
  controllers: [InvoicesController],
  providers: [InvoiceGenerationService],
  exports: [InvoiceGenerationService],
})
export class InvoicesModule {}
