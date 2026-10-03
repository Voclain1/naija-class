import { Module } from "@nestjs/common";

import { StudentPortalController } from "./student-portal.controller";
import { LoginLockoutService } from "../../common/auth/login-lockout";
import { StudentPortalService } from "./student-portal.service";
import { ReleasedResultsService } from "../report-cards/released-results.service";
import { PortalInvoicesService } from "../portal-finance/portal-invoices.service";
import { ResultPinModule } from "../result-checker/result-pin.module";

@Module({
  // ResultPinModule — the one redemption path for result PINs (CP6b, §21.4).
  imports: [ResultPinModule],
  controllers: [StudentPortalController],
  // PortalInvoicesService is listed directly rather than by importing
  // PortalFinanceModule: that module is guardian-guarded at the controller,
  // and this module wants only the service. Same shape as ReleasedResultsService
  // above, which the guardian portal also provides separately.
  providers: [StudentPortalService, ReleasedResultsService, PortalInvoicesService, LoginLockoutService],
})
export class StudentPortalModule {}
