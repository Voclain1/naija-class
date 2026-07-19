import { Module } from "@nestjs/common";

import { PortalInvoicesController } from "./portal-invoices.controller";
import { PortalInvoicesService } from "./portal-invoices.service";

@Module({
  controllers: [PortalInvoicesController],
  providers: [PortalInvoicesService],
})
export class PortalFinanceModule {}
