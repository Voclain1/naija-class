import { Module } from "@nestjs/common";

import { StudentPortalController } from "./student-portal.controller";
import { StudentPortalService } from "./student-portal.service";
import { ReleasedResultsService } from "../report-cards/released-results.service";
import { PortalInvoicesService } from "../portal-finance/portal-invoices.service";

@Module({
  controllers: [StudentPortalController],
  // PortalInvoicesService is listed directly rather than by importing
  // PortalFinanceModule: that module is guardian-guarded at the controller,
  // and this module wants only the service. Same shape as ReleasedResultsService
  // above, which the guardian portal also provides separately.
  providers: [StudentPortalService, ReleasedResultsService, PortalInvoicesService],
})
export class StudentPortalModule {}
