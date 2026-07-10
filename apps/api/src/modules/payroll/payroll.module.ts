import { Module } from "@nestjs/common";

// StorageService is provided by the global StorageModule (registered in
// AppModule) — no need to import it here, same as ExpensesModule/PaymentsModule.

import { PayrollController } from "./payroll.controller.js";
import { PayrollService } from "./payroll.service.js";

@Module({
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
