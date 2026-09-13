import { Module } from "@nestjs/common";

import { PortalBankDetailsController } from "./portal-bank-details.controller";
import { PortalBankDetailsService } from "./portal-bank-details.service";
import { PortalInvoicesController } from "./portal-invoices.controller";
import { PortalInvoicesService } from "./portal-invoices.service";

@Module({
  controllers: [PortalInvoicesController, PortalBankDetailsController],
  providers: [PortalInvoicesService, PortalBankDetailsService],
})
export class PortalFinanceModule {}
